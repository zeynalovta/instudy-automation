import {
  hasDmaKeyword,
  startDmaFlow,
  handlePostback
} from "../../lib/dma-flow.js";

const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;

const COMMENT_REPLIES = [
  "Məlumat göndərildi 📥",
  "DM göndərildi 👀",
  "Ətraflı məlumat təqdim edildi ✨"
];

function getRandomCommentReply() {
  const index = Math.floor(
    Math.random() * COMMENT_REPLIES.length
  );

  return COMMENT_REPLIES[index];
}

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
    console.error(
      "COMMENT REPLY ERROR:",
      JSON.stringify(data)
    );

    throw new Error(
      `Comment reply failed: ${JSON.stringify(data)}`
    );
  }

  return data;
}

export default async function handler(req, res) {

  // =====================================================
  // META WEBHOOK VERIFICATION
  // =====================================================

  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (
      mode === "subscribe" &&
      token === VERIFY_TOKEN
    ) {
      console.log("META WEBHOOK VERIFIED");

      return res
        .status(200)
        .send(challenge);
    }

    return res
      .status(403)
      .send("Verification failed");
  }

  if (req.method !== "POST") {
    return res
      .status(405)
      .send("Method not allowed");
  }

  try {
    console.log(
      "META WEBHOOK EVENT:",
      JSON.stringify(req.body)
    );

    if (req.body.object !== "instagram") {
      return res
        .status(200)
        .send("EVENT_RECEIVED");
    }

    for (const entry of req.body.entry || []) {

      // =====================================================
      // INSTAGRAM DM / BUTTON EVENTS
      // =====================================================

      for (const event of entry.messaging || []) {

        const senderId =
          event.sender?.id;

        if (!senderId) {
          continue;
        }

        // Öz bot mesajlarımızı ignore et
        if (event.message?.is_echo) {
          continue;
        }

        // ---------------------------------------------
        // BUTTON / POSTBACK
        // ---------------------------------------------

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

        // ---------------------------------------------
        // TEXT DM
        // ---------------------------------------------

        const text =
          event.message?.text;

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

      // =====================================================
      // INSTAGRAM COMMENT EVENTS
      // =====================================================

      for (const change of entry.changes || []) {

        if (change.field !== "comments") {
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

        console.log(
          "INSTAGRAM COMMENT:",
          JSON.stringify({
            commenterId,
            commentId,
            commentText
          })
        );

        if (!commenterId) {
          console.log(
            "COMMENT WITHOUT USER ID:",
            JSON.stringify(value)
          );

          continue;
        }

        /*
        ---------------------------------------------
        1. PUBLIC COMMENT REPLY
        ---------------------------------------------
        */

        if (commentId) {
          try {
            await replyToComment(
              commentId
            );
          } catch (error) {
            /*
            Public reply alınmasa belə
            DM flow-u işləməyə davam etsin.
            */
            console.error(
              "PUBLIC COMMENT REPLY FAILED:",
              error
            );
          }
        }

        /*
        ---------------------------------------------
        2. DMA DM FLOW
        ---------------------------------------------
        */

        try {
          await startDmaFlow(
            commenterId,
            commentText ||
              "Instagram comment"
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

    /*
    Meta event-i retry edib
    duplicate mesaj yaratmasın.
    */
    return res
      .status(200)
      .send("EVENT_RECEIVED");
  }
}
