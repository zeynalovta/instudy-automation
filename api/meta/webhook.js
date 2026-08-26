const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;
const INSTAGRAM_ACCESS_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN;

export default async function handler(req, res) {
  // 1) Meta webhook verification
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("META WEBHOOK VERIFIED");
      return res.status(200).send(challenge);
    }

    return res.status(403).send("Verification failed");
  }

  // 2) Incoming Instagram events
  if (req.method === "POST") {
    try {
      const body = req.body;

      console.log("META WEBHOOK EVENT:", JSON.stringify(body));

      if (body.object !== "instagram") {
        return res.status(200).send("EVENT_RECEIVED");
      }

      for (const entry of body.entry || []) {
        for (const event of entry.messaging || []) {
          const senderId = event.sender?.id;

          // Echo messages-i ignore edirik
          if (event.message?.is_echo) {
            continue;
          }

          const text = event.message?.text;

          if (!senderId || !text) {
            continue;
          }

          console.log("Instagram sender:", senderId);
          console.log("Instagram message:", text);

          await sendInstagramMessage(
            senderId,
            "Salam 👋 INSTUDY DMA proqramına xoş gəlmisiniz."
          );
        }
      }

      return res.status(200).send("EVENT_RECEIVED");
    } catch (error) {
      console.error("Webhook error:", error);

      return res.status(200).send("EVENT_RECEIVED");
    }
  }

  return res.status(405).send("Method not allowed");
}

async function sendInstagramMessage(recipientId, text) {
  const response = await fetch(
    "https://graph.instagram.com/v24.0/me/messages",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${INSTAGRAM_ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        recipient: {
          id: recipientId
        },
        messaging_type: "RESPONSE",
        message: {
          text
        }
      })
    }
  );

  const data = await response.json();

  console.log("Instagram Send API response:", data);

  if (!response.ok) {
    throw new Error(JSON.stringify(data));
  }

  return data;
}
