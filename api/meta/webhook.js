import {
  hasDmaKeyword,
  findMatchedKeyword,
  startDmaFlow,
  startDmaFlowFromComment,
  handlePostback
} from "../../lib/dma-flow.js";

import { supabase } from "../../lib/supabase.js";

import {
  eventsEnabled,
  logEvents,
  buildEvent,
  buildIncomingEvents,
  countRequestItems,
  messagingTriggerKey,
  parseInstagramError,
  ctxMetadata
} from "../../lib/events.js";

const VERIFY_TOKEN =
  process.env.META_VERIFY_TOKEN;

const INSTAGRAM_ACCOUNT_ID =
  process.env.INSTAGRAM_ACCOUNT_ID;

const COMMENT_REPLIES = [
  "Məlumat göndərildi 📥",
  "DM göndərildi 👀",
  "Ətraflı məlumat təqdim edildi ✨"
];

function getRandomCommentReply() {
  return COMMENT_REPLIES[
    Math.floor(
      Math.random() *
      COMMENT_REPLIES.length
    )
  ];
}

/* =========================================================
   PUBLIC COMMENT REPLY
========================================================= */

async function replyToComment(commentId) {
  const message =
    getRandomCommentReply();

  const response = await fetch(
    `https://graph.instagram.com/v26.0/${commentId}/replies`,
    {
      method: "POST",

      headers: {
        Authorization:
          `Bearer ${process.env.INSTAGRAM_ACCESS_TOKEN}`,

        "Content-Type":
          "application/json"
      },

      body: JSON.stringify({
        message
      })
    }
  );

  const data =
    await response.json();

  console.log(
    "COMMENT REPLY RESPONSE:",
    JSON.stringify(data)
  );

  if (!response.ok) {
    throw new Error(
      `Comment reply failed: ${JSON.stringify(data)}`
    );
  }

  return data;
}

/* =========================================================
   COMMENT DEDUPLICATION
========================================================= */

async function isCommentAlreadyProcessed(
  commentId
) {
  const {
    data,
    error
  } = await supabase
    .from(
      "processed_instagram_comments"
    )
    .select("comment_id")
    .eq(
      "comment_id",
      commentId
    )
    .maybeSingle();

  if (error) {
    throw error;
  }

  return Boolean(data);
}

async function markCommentProcessed(
  commentId,
  commenterId,
  commentText
) {
  const { error } = await supabase
    .from(
      "processed_instagram_comments"
    )
    .insert({
      comment_id:
        commentId,

      commenter_id:
        commenterId,

      comment_text:
        commentText
    });

  /*
    Eyni comment paralel request-də
    artıq insert olunubsa duplicate error-u
    ignore edirik.
  */

  if (
    error &&
    error.code !== "23505"
  ) {
    throw error;
  }
}

/* =========================================================
   EVENT TRACKING (Sprint 1A: measurement only)

   Bu funksiyalar heç vaxt throw etmir və EVENTS_ENABLED=true
   deyilsə heç nə etmir.
========================================================= */

async function captureIncomingEvents(
  body,
  requestId
) {
  if (!eventsEnabled()) {
    return;
  }

  try {
    await logEvents(
      buildIncomingEvents(
        body,
        {
          requestId,
          findMatchedKeyword,
          ownAccountId:
            INSTAGRAM_ACCOUNT_ID
        }
      )
    );

  } catch (error) {
    console.error(
      "EVENT_CAPTURE_FAILED:",
      error?.message
    );
  }
}

async function logPublicReplyEvent(
  commenterId,
  commentId,
  outcome,
  requestId
) {
  if (!eventsEnabled()) {
    return;
  }

  try {
    const ctx = {
      requestId,
      triggerKey: `cmt:${commentId}`,
      entryPoint: "comment"
    };

    const replyId = outcome.data?.id ?? null;

    await logEvents([
      outcome.ok
        ? buildEvent({
            userId: commenterId,
            type: "message_sent",
            channel: "comment",

            dedupeKey: replyId
              ? `sent:${replyId}`
              : null,

            metadata: {
              message_kind: "comment_public_reply",
              api_message_id: replyId,
              has_register_link: false,
              ...ctxMetadata(ctx)
            }
          })
        : buildEvent({
            userId: commenterId,
            type: "message_failed",
            channel: "comment",

            metadata: {
              message_kind: "comment_public_reply",
              ...parseInstagramError(outcome.error),
              ...ctxMetadata(ctx)
            }
          })
    ]);

  } catch (error) {
    console.error(
      "EVENT_CAPTURE_FAILED:",
      error?.message
    );
  }
}

async function logCommentFlowFailure(
  commenterId,
  commentId,
  error,
  requestId
) {
  if (!eventsEnabled()) {
    return;
  }

  try {
    await logEvents([
      buildEvent({
        userId: commenterId,
        type: "message_failed",
        channel: "comment",

        metadata: {
          message_kind: "comment_private_reply",
          stage: "before_send",
          ...parseInstagramError(error),

          ...ctxMetadata({
            requestId,
            triggerKey: `cmt:${commentId}`,
            entryPoint: "comment"
          })
        }
      })
    ]);

  } catch (captureError) {
    console.error(
      "EVENT_CAPTURE_FAILED:",
      captureError?.message
    );
  }
}

async function logWebhookAborted(
  item,
  error,
  requestId,
  remaining
) {
  if (
    !eventsEnabled() ||
    !item?.userId
  ) {
    return;
  }

  try {
    await logEvents([
      buildEvent({
        userId: item.userId,
        type: "webhook_aborted",

        metadata: {
          trigger_key: item.triggerKey ?? null,
          remaining_events: remaining,
          ...parseInstagramError(error),
          request_id: requestId
        }
      })
    ]);

  } catch (captureError) {
    console.error(
      "EVENT_CAPTURE_FAILED:",
      captureError?.message
    );
  }
}

/* =========================================================
   WEBHOOK
========================================================= */

export default async function handler(
  req,
  res
) {

  /* -------------------------------------------------------
     META VERIFICATION
  ------------------------------------------------------- */

  if (req.method === "GET") {
    const mode =
      req.query["hub.mode"];

    const token =
      req.query[
        "hub.verify_token"
      ];

    const challenge =
      req.query[
        "hub.challenge"
      ];

    if (
      mode === "subscribe" &&
      token === VERIFY_TOKEN
    ) {
      console.log(
        "META WEBHOOK VERIFIED"
      );

      return res
        .status(200)
        .send(challenge);
    }

    return res
      .status(403)
      .send(
        "Verification failed"
      );
  }

  if (req.method !== "POST") {
    return res
      .status(405)
      .send(
        "Method not allowed"
      );
  }

  const requestId =
    req.headers?.["x-vercel-id"] ?? null;

  let capturePromise = Promise.resolve();
  let totalItems = 0;
  let startedItems = 0;
  let currentItem = null;

  try {
    console.log(
      "META WEBHOOK EVENT:",
      JSON.stringify(req.body)
    );

    if (
      req.body.object !==
      "instagram"
    ) {
      return res
        .status(200)
        .send(
          "EVENT_RECEIVED"
        );
    }

    /*
      Gələn hadisələr axından ƏVVƏL başladılır, amma gözlənilmir:
      bot cavabının gecikməsinə təsir etmir. Cavab göndərilməzdən
      əvvəl tamamlanması təmin olunur. Axın xəta versə də
      ölçmə hadisələri qeyd olunur.
    */
    capturePromise =
      captureIncomingEvents(
        req.body,
        requestId
      );

    totalItems =
      countRequestItems(req.body);

    for (
      const entry of
      req.body.entry || []
    ) {

      /* =====================================================
         DM / POSTBACK / STORY REPLY
      ===================================================== */

      for (
        const event of
        entry.messaging || []
      ) {
        startedItems++;

        currentItem = {
          userId:
            event.sender?.id ?? null,

          triggerKey:
            messagingTriggerKey(event)
        };

        const senderId =
          event.sender?.id;

        if (!senderId) {
          continue;
        }

        /*
          Öz bot mesajlarımız
        */

        if (
          event.message?.is_echo
        ) {
          continue;
        }

        /* ---------------- BUTTON ---------------- */

        if (
          event.postback?.payload
        ) {
          console.log(
            "POSTBACK:",
            senderId,
            event.postback.payload
          );

          await handlePostback(
            senderId,
            event.postback.payload,
            {
              requestId,
              triggerKey:
                currentItem.triggerKey
            }
          );

          continue;
        }

        const text =
          event.message?.text || "";

        /* ---------------- STORY REPLY ---------------- */

        const isStoryReply =
          Boolean(
            event.message
              ?.reply_to
              ?.story
          );

        if (isStoryReply) {
          console.log(
            "STORY REPLY:",
            senderId,
            text
          );

          await startDmaFlow(
            senderId,
            text ||
              "Instagram Story Reply",
            {
              requestId,
              triggerKey:
                currentItem.triggerKey,
              entryPoint: "story_reply"
            }
          );

          continue;
        }

        /* ---------------- NORMAL DM ---------------- */

        if (!text) {
          continue;
        }

        console.log(
          "DM MESSAGE:",
          senderId,
          text
        );

        if (
          hasDmaKeyword(text)
        ) {
          await startDmaFlow(
            senderId,
            text,
            {
              requestId,
              triggerKey:
                currentItem.triggerKey,
              entryPoint: "dm"
            }
          );
        }
      }

      /* =====================================================
         COMMENTS
      ===================================================== */

      for (
        const change of
        entry.changes || []
      ) {
        startedItems++;

        if (
          change.field !==
          "comments"
        ) {
          continue;
        }

        const value =
          change.value || {};

        const commenterId =
          value.from?.id ||
          value.from?.user_id ||
          value.user_id;

        const commentId =
          value.id ||
          value.comment_id;

        const commentText =
          value.text ||
          value.message ||
          "";

        currentItem = {
          userId:
            commenterId ?? null,

          triggerKey: commentId
            ? `cmt:${commentId}`
            : null
        };

        console.log(
          "INSTAGRAM COMMENT:",
          JSON.stringify({
            commenterId,
            commentId,
            commentText
          })
        );

        if (
          !commenterId ||
          !commentId
        ) {
          console.log(
            "INVALID COMMENT EVENT:",
            JSON.stringify(value)
          );

          continue;
        }

        /* ---------------------------------------------------
           Öz comment/reply-larımızı ignore et
        --------------------------------------------------- */

        if (
          String(commenterId) ===
          String(
            INSTAGRAM_ACCOUNT_ID
          )
        ) {
          console.log(
            "IGNORING OWN COMMENT:",
            commentId
          );

          continue;
        }

        /* ---------------------------------------------------
           Eyni comment yalnız 1 dəfə
        --------------------------------------------------- */

        const alreadyProcessed =
          await isCommentAlreadyProcessed(
            commentId
          );

        if (alreadyProcessed) {
          console.log(
            "COMMENT ALREADY PROCESSED:",
            commentId
          );

          continue;
        }

        /*
          Əvvəl processed kimi qeyd edirik.
          Meta eyni event-i yenidən göndərsə,
          duplicate flow yaranmır.
        */

        await markCommentProcessed(
          commentId,
          commenterId,
          commentText
        );

        /* ---------------- PUBLIC REPLY ---------------- */

        const publicReply = {
          ok: false,
          data: null,
          error: null
        };

        try {
          publicReply.data =
            await replyToComment(
              commentId
            );

          publicReply.ok = true;
        } catch (error) {
          console.error(
            "PUBLIC COMMENT REPLY FAILED:",
            error
          );

          publicReply.error = error;
        }

        await logPublicReplyEvent(
          commenterId,
          commentId,
          publicReply,
          requestId
        );

        /* ---------------- PRIVATE COMMENT MESSAGE ---------------- */

        const commentFlowCtx = {
          requestId,
          triggerKey:
            `cmt:${commentId}`,
          entryPoint: "comment"
        };

        try {
          await startDmaFlowFromComment(
            commentId,
            commenterId,
            commentText ||
              "Instagram comment",
            commentFlowCtx
          );

        } catch (error) {
          console.error(
            "COMMENT PRIVATE REPLY ERROR:",
            error
          );

          // Göndəriş xətası dma-flow-da artıq qeyd olunub
          // (eventLogged), göndəriş uğurlu olubsa sonradan gələn xəta
          // (məsələn kontakt yenilənməsi) göndəriş xətası deyil.
          // Yalnız göndərmədən ƏVVƏLKI xətalar burada qeyd olunur.
          if (
            !error?.eventLogged &&
            !commentFlowCtx.sendSucceeded
          ) {
            await logCommentFlowFailure(
              commenterId,
              commentId,
              error,
              requestId
            );
          }
        }
      }
    }

    await capturePromise;

    return res
      .status(200)
      .send(
        "EVENT_RECEIVED"
      );

  } catch (error) {
    console.error(
      "Webhook error:",
      error
    );

    await logWebhookAborted(
      currentItem,
      error,
      requestId,
      Math.max(
        0,
        totalItems - startedItems
      )
    );

    await capturePromise;

    return res
      .status(200)
      .send(
        "EVENT_RECEIVED"
      );
  }
}
