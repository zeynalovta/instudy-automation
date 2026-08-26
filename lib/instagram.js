const ACCESS_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN;
const INSTAGRAM_ACCOUNT_ID = process.env.INSTAGRAM_ACCOUNT_ID;

const GRAPH_URL =
  `https://graph.instagram.com/v26.0/${INSTAGRAM_ACCOUNT_ID}/messages`;

async function callInstagram(payload) {
  const response = await fetch(GRAPH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();

  console.log("Instagram API response:", JSON.stringify(data));

  if (!response.ok) {
    throw new Error(JSON.stringify(data));
  }

  return data;
}

export async function sendText(recipientId, text) {
  return callInstagram({
    recipient: {
      id: recipientId
    },
    message: {
      text
    }
  });
}

export async function sendButtonTemplate(
  recipientId,
  text,
  buttons
) {
  return callInstagram({
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text,
          buttons
        }
      }
    }
  });
}
