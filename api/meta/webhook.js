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
      for (const event of entry.messaging || []) {
        const senderId = event.sender?.id;

        if (!senderId) {
          continue;
        }

        // Öz göndərdiyimiz mesajları ignore et
        if (event.message?.is_echo) {
          continue;
        }

        // Düymə / postback
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

        // Gələn mətn mesajı
        const text = event.message?.text;

        if (!text) {
          continue;
        }

        console.log("MESSAGE:", senderId, text);

        if (hasDmaKeyword(text)) {
          await startDmaFlow(senderId, text);
        }
      }
    }

    return res.status(200).send("EVENT_RECEIVED");
  } catch (error) {
    console.error("Webhook error:", error);

    // Meta eyni event-i təkrar-təkrar göndərməsin
    return res.status(200).send("EVENT_RECEIVED");
  }
}
