import {
  hasDmaKeyword,
  startDmaFlow,
  handlePostback
} from "../../lib/dma-flow.js";

const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;

export default async function handler(req, res) {
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (
      mode === "subscribe" &&
      token === VERIFY_TOKEN
    ) {
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

      // =====================================================
      // 1) INSTAGRAM DM / POSTBACK EVENTS
      // =====================================================

      for (const event of entry.messaging || []) {
        const senderId = event.sender?.id;

        if (!senderId) {
          continue;
        }

        // Öz göndərdiyimiz mesajları ignore et
        if (event.message?.is_echo) {
          continue;
        }

        // BUTTON / POSTBACK
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

        // TEXT MESSAGE
        const text = event.message?.text;

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
      // 2) INSTAGRAM COMMENT EVENTS
      // =====================================================

      for (const change of entry.changes || []) {
        if (change.field !== "comments") {
          continue;
        }

        const value = change.value || {};

        const commenterId =
          value.from?.id ||
          value.from?.user_id ||
          value.user_id;

        const commentText =
          value.text ||
          value.message ||
          "";

        if (!commenterId) {
          console.log(
            "COMMENT WITHOUT USER ID:",
            JSON.stringify(value)
          );

          continue;
        }

        console.log(
          "INSTAGRAM COMMENT:",
          commenterId,
          commentText
        );

        // Variant A:
        // HƏR comment DMA flow-u başladır.
        await startDmaFlow(
          commenterId,
          commentText || "Instagram comment"
        );
      }
    }

    return res.status(200).send("EVENT_RECEIVED");

  } catch (error) {
    console.error(
      "Webhook error:",
      error
    );

    return res.status(200).send("EVENT_RECEIVED");
  }
}
