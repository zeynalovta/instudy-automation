import crypto from "crypto";
import { supabase } from "./supabase.js";

import {
  sendText,
  sendButtonTemplate
} from "./instagram.js";

const BASE_URL =
  "https://instudy-automation-28fw.vercel.app";

/* =========================================================
   DMA KEYWORDS
========================================================= */

const KEYWORDS = [
  "salam",
  "melumat",
  "məlumat",
  "hr",
  "data",
  "front",
  "frontend",
  "back",
  "backend",
  "komputer",
  "kompüter",
  "ofis",
  "mühasib",
  "muhasib",
  "ödənişsiz",
  "odenissiz",
  "təqaüd",
  "teqaud",
  "müddət",
  "muddet",
  "hizmetler",
  "xidmət",
  "xidmet",
  "görüş",
  "Görüş",
  "randevu",
  "hizmetler",
  "+",
  "məhdudiyyət",
  "mehdudiyyet",
  "kurslar onlayndır",
  "kurslar onlayndir",
  "necə qoşula bilərəm",
  "nece qosula bilerem",
  "merhaba",
  "hello",
  "hansı xidmətləri təklif edirsən",
  "hansi xidmetleri teklif edirsen",
  "sənin xidmətlərinin qiyməti nədir",
  "senin xidmetlerinin qiymeti nedir"
];

/* =========================================================
   MESSAGES
========================================================= */

const MAIN_MESSAGE = `Dövlət Məşğulluq Agentliyi (DMA) ilə əməkdaşlıq çərçivəsində işsiz şəxslərin peşə bacarıqlarını artırmaq üçün ödənişsiz təlimlər təşkil olunur. Təlimlər əyani tədris olunur.

Tələblər:

Əyani təhsil alan tələbə olmamalı

Adınıza aktiv VÖEN qeydiyyatı olmamalı

DMA-da işsiz kimi qeydiyyatda olmalı

Yaş aralığı: 18–35

Bu tələblərə cavab verən şəxslər imtahan və müsahibə mərhələsindən uğurla keçərsə, təlimdə iştirak imkanı qazanacaq.

Təlim müddətində iştirakçılara 200 AZN təqaüd veriləcək və kursu bitirənlərə müvafiq sahələrdə işlə təmin olunmağa dəstək olunacaq.

Hörmətlə, INSTUDY

Qeydiyyat linki aşağıdadır👇`;

const TRAINING_MESSAGE = `Hazırda aşağıdakı təlimlər üzrə qeydiyyat aparılır:

💻 Frontend Developer (3 ay)
💻 Backend Developer (3 ay)
👥 HR (2 ay)
🖥 Kompüter Operatoru (2 ay)
📊 Mühasibatlıq (3 ay)
📈 Data Analitika (4 ay)

Qeydiyyat linki aşağıdadır👇`;

const EXAM_MESSAGE = `Təlimlərə qəbul imtahan və müsahibə əsasında həyata keçirilir.

İmtahan:
✅ İnformatika
✅ Məntiq
✅ Ümumi biliklər
✅ İngilis dili

İmtahan əyani formada keçirilir.

Qeydiyyat linki aşağıdadır👇`;

const FOLLOWUP_MESSAGE = `Salam 👋

DMA layihəsinə maraq göstərdiyiniz üçün təşəkkür edirik.

Hazırda qeydiyyat davam edir və yerlər məhduddur.

Təlimlər ödənişsizdir, iştirakçılara aylıq 200 AZN təqaüd verilir.

Qeydiyyatı tamamlamaq üçün aşağıdakı düymədən istifadə edin.`;

/* =========================================================
   KEYWORD MATCHING
========================================================= */

function normalizeText(text = "") {
  return text
    .toLocaleLowerCase("az")
    .trim();
}

export function hasDmaKeyword(text) {
  const normalized =
    normalizeText(text);

  return KEYWORDS.some((keyword) =>
    normalized.includes(
      normalizeText(keyword)
    )
  );
}

/* =========================================================
   REGISTRATION TRACKING URL
========================================================= */

function createTrackingSignature(userId) {
  return crypto
    .createHmac(
      "sha256",
      process.env.TRACKING_SECRET
    )
    .update(userId)
    .digest("hex");
}

export function createRegistrationUrl(userId) {
  const signature =
    createTrackingSignature(userId);

  return (
    `${BASE_URL}/api/register` +
    `?u=${encodeURIComponent(userId)}` +
    `&s=${signature}`
  );
}

/* =========================================================
   INSTAGRAM PROFILE
========================================================= */

async function getInstagramProfile(userId) {
  try {
    const url =
      `https://graph.instagram.com/v26.0/${userId}` +
      `?fields=name,username` +
      `&access_token=${encodeURIComponent(
        process.env.INSTAGRAM_ACCESS_TOKEN
      )}`;

    const response =
      await fetch(url);

    const data =
      await response.json();

    if (!response.ok) {
      console.error(
        "Instagram profile API error:",
        JSON.stringify(data)
      );

      return {
        username: null,
        name: null
      };
    }

    return {
      username:
        data.username || null,

      name:
        data.name || null
    };

  } catch (error) {
    console.error(
      "Instagram profile fetch error:",
      error
    );

    return {
      username: null,
      name: null
    };
  }
}

/* =========================================================
   CONTACT
========================================================= */

async function getOrCreateContact(userId) {
  const {
    data: existing,
    error: findError
  } = await supabase
    .from("instagram_contacts")
    .select("*")
    .eq(
      "instagram_user_id",
      userId
    )
    .maybeSingle();

  if (findError) {
    throw findError;
  }

  const profile =
    await getInstagramProfile(userId);

  if (existing) {
    const updates = {};

    if (profile.username) {
      updates.username =
        profile.username;
    }

    if (
      profile.name &&
      !existing.full_name
    ) {
      updates.full_name =
        profile.name;
    }

    if (
      Object.keys(updates).length > 0
    ) {
      const {
        data: updated,
        error: updateError
      } = await supabase
        .from("instagram_contacts")
        .update(updates)
        .eq(
          "id",
          existing.id
        )
        .select()
        .single();

      if (updateError) {
        throw updateError;
      }

      return updated;
    }

    return existing;
  }

  const {
    data,
    error
  } = await supabase
    .from("instagram_contacts")
    .insert({
      instagram_user_id:
        userId,

      username:
        profile.username,

      full_name:
        profile.name,

      current_step:
        "dma_started",

      qualification_status:
        "in_progress"
    })
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

/* =========================================================
   START DMA FLOW - NORMAL DM / STORY
========================================================= */

export async function startDmaFlow(
  userId,
  incomingText
) {
  await getOrCreateContact(userId);

  const registerUrl =
    createRegistrationUrl(userId);

  await sendButtonTemplate(
    userId,
    MAIN_MESSAGE,
    [
      {
        type: "web_url",
        url: registerUrl,
        title: "Qeydiyyatdan keç"
      },
      {
        type: "postback",
        title: "Hansı təlimlər var?",
        payload: "DMA_TRAININGS"
      },
      {
        type: "postback",
        title: "İmtahan barədə",
        payload: "DMA_EXAM"
      }
    ]
  );

  const followupDate =
    new Date(
      Date.now() +
      60 * 60 * 1000
    ).toISOString();

  const { error } = await supabase
    .from("instagram_contacts")
    .update({
      current_step:
        "dma_main_sent",

      registration_link_clicked:
        false,

      registration_confirmed:
        false,

      followup_sent:
        false,

      followup_due_at:
        followupDate,

      awaiting_operator:
        false,

      last_action:
        "DMA_STARTED",

      last_action_at:
        new Date().toISOString(),

      last_incoming_text:
        incomingText,

      last_interaction_at:
        new Date().toISOString()
    })
    .eq(
      "instagram_user_id",
      userId
    );

  if (error) {
    throw error;
  }
}

/* =========================================================
   START DMA FLOW - COMMENT PRIVATE REPLY
========================================================= */

export async function startDmaFlowFromComment(
  commentId,
  userId,
  incomingText
) {
  await getOrCreateContact(userId);

  const response = await fetch(
    `https://graph.instagram.com/v26.0/${process.env.INSTAGRAM_ACCOUNT_ID}/messages`,
    {
      method: "POST",

      headers: {
        Authorization:
          `Bearer ${process.env.INSTAGRAM_ACCESS_TOKEN}`,

        "Content-Type":
          "application/json"
      },

      body: JSON.stringify({
        recipient: {
          comment_id: commentId
        },

        message: {
          text: MAIN_MESSAGE
        }
      })
    }
  );

  const data =
    await response.json();

  console.log(
    "PRIVATE COMMENT REPLY RESPONSE:",
    JSON.stringify(data)
  );

  if (!response.ok) {
    throw new Error(
      `Private comment reply failed: ${JSON.stringify(data)}`
    );
  }

  const { error } = await supabase
    .from("instagram_contacts")
    .update({
      current_step:
        "dma_comment_private_reply_sent",

      registration_link_clicked:
        false,

      registration_confirmed:
        false,

      /*
        Comment private reply-dən dərhal
        sonra follow-up planlamırıq.
      */

      followup_sent:
        false,

      followup_due_at:
        null,

      awaiting_operator:
        false,

      last_action:
        "DMA_COMMENT_STARTED",

      last_action_at:
        new Date().toISOString(),

      last_incoming_text:
        incomingText,

      last_interaction_at:
        new Date().toISOString()
    })
    .eq(
      "instagram_user_id",
      userId
    );

  if (error) {
    throw error;
  }

  return data;
}

/* =========================================================
   BUTTON / POSTBACK HANDLER
========================================================= */

export async function handlePostback(
  userId,
  payload
) {
  const registerUrl =
    createRegistrationUrl(userId);

  /* -------------------------
     TRAININGS
  ------------------------- */

  if (payload === "DMA_TRAININGS") {
    const { error } = await supabase
      .from("instagram_contacts")
      .update({
        last_action:
          "DMA_TRAININGS",

        last_action_at:
          new Date().toISOString(),

        current_step:
          "viewed_trainings",

        last_interaction_at:
          new Date().toISOString()
      })
      .eq(
        "instagram_user_id",
        userId
      );

    if (error) {
      throw error;
    }

    await sendButtonTemplate(
      userId,
      TRAINING_MESSAGE,
      [
        {
          type: "web_url",
          url: registerUrl,
          title:
            "Qeydiyyatdan keç"
        }
      ]
    );

    return;
  }

  /* -------------------------
     EXAM
  ------------------------- */

  if (payload === "DMA_EXAM") {
    const { error } = await supabase
      .from("instagram_contacts")
      .update({
        last_action:
          "DMA_EXAM",

        last_action_at:
          new Date().toISOString(),

        current_step:
          "viewed_exam_info",

        last_interaction_at:
          new Date().toISOString()
      })
      .eq(
        "instagram_user_id",
        userId
      );

    if (error) {
      throw error;
    }

    await sendButtonTemplate(
      userId,
      EXAM_MESSAGE,
      [
        {
          type: "web_url",
          url: registerUrl,
          title:
            "Qeydiyyatdan keç"
        }
      ]
    );

    return;
  }

  /* -------------------------
     QUESTION
  ------------------------- */

  if (
    payload ===
    "DMA_HAVE_QUESTION"
  ) {
    const { error } = await supabase
      .from("instagram_contacts")
      .update({
        last_action:
          "DMA_HAVE_QUESTION",

        last_action_at:
          new Date().toISOString(),

        awaiting_operator:
          true,

        current_step:
          "waiting_operator_question",

        last_interaction_at:
          new Date().toISOString()
      })
      .eq(
        "instagram_user_id",
        userId
      );

    if (error) {
      throw error;
    }

    await sendText(
      userId,
      "Zəhmət olmasa sualınızı yazılı və ya səsli formada qeyd edin, operatorumuz tezliklə cavablandıracaq."
    );

    return;
  }

  /* -------------------------
     REGISTERED
  ------------------------- */

  if (
    payload ===
    "DMA_REGISTERED"
  ) {
    const { error } = await supabase
      .from("instagram_contacts")
      .update({
        last_action:
          "DMA_REGISTERED",

        last_action_at:
          new Date().toISOString(),

        registration_confirmed:
          true,

        followup_due_at:
          null,

        awaiting_operator:
          false,

        current_step:
          "completed",

        last_interaction_at:
          new Date().toISOString()
      })
      .eq(
        "instagram_user_id",
        userId
      );

    if (error) {
      throw error;
    }

    await sendText(
      userId,
      "Sizə uğurlar arzu edirik!"
    );

    return;
  }

  console.log(
    "Unknown postback payload:",
    payload
  );
}

/* =========================================================
   1 HOUR FOLLOW-UP
========================================================= */

export async function sendDmaFollowup(
  userId
) {
  const registerUrl =
    createRegistrationUrl(userId);

  await sendButtonTemplate(
    userId,
    FOLLOWUP_MESSAGE,
    [
      {
        type: "web_url",
        url: registerUrl,
        title: "Qeydiyyatdan keç"
      },
      {
        type: "postback",
        title: "Sualım var",
        payload:
          "DMA_HAVE_QUESTION"
      },
      {
        type: "postback",
        title:
          "Qeydiyyatdan keçdim",
        payload:
          "DMA_REGISTERED"
      }
    ]
  );

  const { error } = await supabase
    .from("instagram_contacts")
    .update({
      followup_sent:
        true,

      last_action:
        "DMA_FOLLOWUP_SENT",

      last_action_at:
        new Date().toISOString(),

      current_step:
        "followup_sent",

      last_interaction_at:
        new Date().toISOString()
    })
    .eq(
      "instagram_user_id",
      userId
    );

  if (error) {
    throw error;
  }
}
