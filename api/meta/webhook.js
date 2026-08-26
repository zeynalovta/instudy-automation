import {
  hasDmaKeyword,
  startDmaFlow,
  handlePostback
} from "../../lib/dma-flow.js";

import { supabase } from "../../lib/supabase.js";

const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;
const INSTAGRAM_ACCOUNT_ID = process.env.INSTAGRAM_ACCOUNT_ID;

const COMMENT_REPLIES = [
  "Məlumat göndərildi 📥",
  "DM göndərildi 👀",
  "Ətraflı məlumat təqdim edildi ✨"
];

function getRandomCommentReply() {
  return COMMENT_REPLIES[
    Math.floor(Math.random() * COMMENT_REPLIES.length)
  ];
}

/* =========================================================
   PUBLIC COMMENT REPLY
========================================================= */

async function replyToComment(commentId) {
  const message = getRandomCommentReply();

  const response = await fetch(
    `https://graph.instagram.com/v26.0/${commentId}/replies`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.INSTAGRAM_ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message
      })
    }
  );

  const data = await response.json();

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

async function isCommentAlreadyProcessed(commentId) {
  const { data, error } = await supabase
    .from("processed_instagram_comments")
    .select("comment_id")
    .eq("comment_id", commentId)
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
    .from("processed_instagram_comments")
    .insert({
      comment_id: commentId,
      commenter_id: commenterId,
      comment_text: commentText
    });

  // Eyni comment paralel request-də artıq insert olunubsa,
  // duplicate error-u ignore edirik.
  if (error && error.code !== "23505") {
    throw error;
  }
}

/* =========================================================
   WEBHOOK
========================================================= */

export default async function handler(req, res) {

  /* -------------------------------------------------------
     META VERIFICATION
  ------------------------------------------------------- */

  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (
      mode === "subscribe" &&
      token === VERIFY_TOKEN
    ) {
      console.log("META WEBHOOK VERIFIED");
      return res.status(200).send(challenge);
    }

    return res.status(403).send("Verification failed");
  }

  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }

  try {
    console.log(
      "META WEBHOOK EVENT:",
      JSON.stringify(req.body)
    );

    if (req.body.object !== "instagram") {
      return res.status(200).send("EVENT_RECEIVED");
    }

    for (const entry of req.body.entry || []) {

      /* =====================================================
         DM / POSTBACK / STORY REPLY
      ===================================================== */

      for (const event of entry.messaging || []) {
        const senderId = event.sender?.id;

        if (!senderId) {
          continue;
        }

        // Öz bot mesajlarımız
        if (event.message?.is_echo) {
          continue;
        }

        /* ---------------- BUTTON ---------------- */

        if (event.postback?.payload) {
          console.log(
            "POSTBACK:",
            senderId,
            event.postback.payload
          );

          await handlePostback(
            senderId,
            event.postback.payload
          );

          continue;
        }

        const text = event.message?.text || "";

        /* ---------------- STORY REPLY ---------------- */

        const isStoryReply = Boolean(
          event.message?.reply_to?.story
        );

        if (isStoryReply) {
          console.log(
            "STORY REPLY:",
            senderId,
            text
          );

          await startDmaFlow(
            senderId,
            text || "Instagram Story Reply"
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

        if (hasDmaKeyword(text)) {
          await startDmaFlow(
            senderId,
            text
          );
        }
      }

      /* =====================================================
         COMMENTS
      ===================================================== */

      for (const change of entry.changes || []) {
        if (change.field !== "comments") {
          continue;
        }

        const value = change.value || {};

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

        console.log(
          "INSTAGRAM COMMENT:",
          JSON.stringify({
            commenterId,
            commentId,
            commentText
          })
        );

        if (!commenterId || !commentId) {
          console.log(
            "INVALID COMMENT EVENT:",
            JSON.stringify(value)
          );

          continue;
        }

        /* ---------------------------------------------------
           CRITICAL: öz comment/reply-larımızı ignore et
        --------------------------------------------------- */

        if (
          String(commenterId) ===
          String(INSTAGRAM_ACCOUNT_ID)
        ) {
          console.log(
            "IGNORING OWN COMMENT:",
            commentId
          );

          continue;
        }

        /* ---------------------------------------------------
           CRITICAL: eyni comment yalnız 1 dəfə
        --------------------------------------------------- */

        const alreadyProcessed =
          await isCommentAlreadyProcessed(commentId);

        if (alreadyProcessed) {
          console.log(
            "COMMENT ALREADY PROCESSED:",
            commentId
          );

          continue;
        }

        /*
          ƏVVƏL processed kimi qeyd edirik.
          Sonra reply/DM göndəririk.

          Bu vacibdir:
          Meta eyni webhook-u paralel göndərsə belə
          duplicate flow başlamasın.
        */

        await markCommentProcessed(
          commentId,
          commenterId,
          commentText
        );

        /* ---------------- PUBLIC REPLY ---------------- */

        try {
          await replyToComment(commentId);
        } catch (error) {
          console.error(
            "PUBLIC COMMENT REPLY FAILED:",
            error
          );
        }

        /* ---------------- DM FLOW ---------------- */

        try {
          await startDmaFlow(
            commenterId,
            commentText || "Instagram comment"
          );
        } catch (error) {
          console.error(
            "COMMENT DMA FLOW ERROR:",
            error
          );
        }
      }
    }

    return res
      .status(200)
      .send("EVENT_RECEIVED");

  } catch (error) {
    console.error(
      "Webhook error:",
      error
    );

    return res
      .status(200)
      .send("EVENT_RECEIVED");
  }
}
