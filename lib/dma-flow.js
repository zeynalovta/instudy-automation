import crypto from "crypto";
import { supabase } from "./supabase.js";

import {
  sendText,
  sendButtonTemplate
} from "./instagram.js";

import {
  eventsEnabled,
  logEvents,
  buildEvent,
  ctxMetadata,
  parseInstagramError
} from "./events.js";

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
  "Kurslar onlayndır, yoxsa əyanidir?",
  "kurslar onlayndir",
  "necə qoşula bilərəm",
  "nece qosula bilerem",
  "Ödənişsiz proqramlara necə qoşula bilərəm?",
  "Təlim nə qədər müddət davam edir?",
  "Təlimlər nə qədər müddət davam edir?",
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

/*
  Uyğun gələn ilk açar sözü qaytarır (yoxdursa null).
  hasDmaKeyword ilə eyni məntiq: normalized.includes(keyword).
*/
export function findMatchedKeyword(text) {
  const normalized =
    normalizeText(text);

  return (
    KEYWORDS.find((keyword) =>
      normalized.includes(
        normalizeText(keyword)
      )
    ) ?? null
  );
}

export function hasDmaKeyword(text) {
  return findMatchedKeyword(text) !== null;
}

/* =========================================================
   EVENT TRACKING (measurement only)

   Bu bölmə yalnız hadisə yazır. EVENTS_ENABLED=true deyilsə
   trackedSend birbaşa göndərməni icra edir və heç nə etmir.
   Göndərmə xətası yenidən eyni şəkildə throw olunur.
========================================================= */

const KINDS_WITH_REGISTER_LINK = [
  "main",
  "trainings",
  "exam",
  "followup",
  "comment_private_reply"
];

function safeEvents(build) {
  try {
    return build() || [];
  } catch (error) {
    console.error(
      "EVENT_BUILD_FAILED:",
      error?.message
    );

    return [];
  }
}

async function trackedSend(
  userId,
  kind,
  ctx,
  sendFn,
  buildLeadingEvents = null
) {
  if (!eventsEnabled()) {
    return sendFn();
  }

  let result;

  try {
    result = await sendFn();

  } catch (error) {
    const events = [
      ...(buildLeadingEvents
        ? safeEvents(buildLeadingEvents)
        : []),

      ...safeEvents(() => [
        buildEvent({
          userId,
          type: "message_failed",
          channel: ctx.entryPoint ?? null,

          metadata: {
            message_kind: kind,
            ...parseInstagramError(error),
            ...ctxMetadata(ctx)
          }
        })
      ])
    ];

    await logEvents(events);

    try {
      if (error && typeof error === "object") {
        error.eventLogged = true;
      }
    } catch {
      // yalnız işarə, əsas xətaya təsir etmir
    }

    throw error;
  }

  // Göndəriş uğurlu oldu (sonrakı xətaların "göndərmə xətası"
  // kimi qeyd olunmaması üçün çağıran tərəf bunu oxuya bilər).
  try {
    ctx.sendSucceeded = true;
  } catch {
    // yalnız işarə, əsas axına təsir etmir
  }

  const events = [
    ...(buildLeadingEvents
      ? safeEvents(buildLeadingEvents)
      : []),

    ...safeEvents(() => [
      buildEvent({
        userId,
        type: "message_sent",
        channel: ctx.entryPoint ?? null,

        dedupeKey: result?.message_id
          ? `sent:${result.message_id}`
          : null,

        metadata: {
          message_kind: kind,
          api_message_id: result?.message_id ?? null,

          has_register_link:
            KINDS_WITH_REGISTER_LINK.includes(kind),

          ...ctxMetadata(ctx)
        }
      })
    ])
  ];

  await logEvents(events);

  return result;
}

function flowStartedEvent(
  userId,
  contact,
  created,
  ctx
) {
  const lastInteraction =
    contact?.last_interaction_at
      ? Date.parse(contact.last_interaction_at)
      : NaN;

  return buildEvent({
    userId,
    type: "flow_started",
    channel: ctx.entryPoint ?? null,

    metadata: {
      is_new_contact: created,

      prev_step: created
        ? null
        : contact?.current_step ?? null,

      prev_link_clicked: created
        ? null
        : contact?.registration_link_clicked ?? null,

      prev_confirmed: created
        ? null
        : contact?.registration_confirmed ?? null,

      prev_awaiting_operator: created
        ? null
        : contact?.awaiting_operator ?? null,

      prev_followup_sent: created
        ? null
        : contact?.followup_sent ?? null,

      prev_followup_due_at: created
        ? null
        : contact?.followup_due_at ?? null,

      prev_last_action: created
        ? null
        : contact?.last_action ?? null,

      seconds_since_last_interaction:
        created || Number.isNaN(lastInteraction)
          ? null
          : Math.round(
              (Date.now() - lastInteraction) / 1000
            ),

      ...ctxMetadata(ctx)
    }
  });
}

function postbackEvent(userId, type, ctx) {
  return buildEvent({
    userId,
    type,
    channel: "postback",
    metadata: ctxMetadata(ctx)
  });
}

async function markFirstConfirmed(userId) {
  if (!eventsEnabled()) {
    return;
  }

  try {
    const { error } = await supabase
      .from("instagram_contacts")
      .update({
        first_confirmed_at:
          new Date().toISOString()
      })
      .eq("instagram_user_id", userId)
      .is("first_confirmed_at", null);

    if (error) {
      console.error(
        "FIRST_CONFIRMED_UPDATE_FAILED:",
        error.message
      );
    }

  } catch (error) {
    console.error(
      "FIRST_CONFIRMED_UPDATE_FAILED:",
      error?.message
    );
  }
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

      return {
        contact: updated,
        created: false
      };
    }

    return {
      contact: existing,
      created: false
    };
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

  return {
    contact: data,
    created: true
  };
}

/* =========================================================
   START DMA FLOW - NORMAL DM / STORY
========================================================= */

export async function startDmaFlow(
  userId,
  incomingText,
  ctx = {}
) {
  const {
    contact,
    created
  } = await getOrCreateContact(userId);

  const registerUrl =
    createRegistrationUrl(userId);

  await trackedSend(
    userId,
    "main",
    ctx,
    () => sendButtonTemplate(
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
    ),
    () => [
      flowStartedEvent(
        userId,
        contact,
        created,
        ctx
      )
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
  incomingText,
  ctx = {}
) {
  const {
    contact,
    created
  } = await getOrCreateContact(userId);

  const registerUrl =
    createRegistrationUrl(userId);

  const sendPrivateReply = async () => {
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
            attachment: {
              type: "template",

              payload: {
                template_type:
                  "button",

                text:
                  MAIN_MESSAGE,

                buttons: [
                  {
                    type:
                      "web_url",

                    url:
                      registerUrl,

                    title:
                      "Qeydiyyatdan keç"
                  },
                  {
                    type:
                      "postback",

                    title:
                      "Hansı təlimlər var?",

                    payload:
                      "DMA_TRAININGS"
                  },
                  {
                    type:
                      "postback",

                    title:
                      "İmtahan barədə",

                    payload:
                      "DMA_EXAM"
                  }
                ]
              }
            }
          }
        })
      }
    );

    const responseData =
      await response.json();

    console.log(
      "PRIVATE COMMENT REPLY RESPONSE:",
      JSON.stringify(responseData)
    );

    if (!response.ok) {
      throw new Error(
        `Private comment reply failed: ${JSON.stringify(responseData)}`
      );
    }

    return responseData;
  };

  const data = await trackedSend(
    userId,
    "comment_private_reply",
    ctx,
    sendPrivateReply,
    () => [
      flowStartedEvent(
        userId,
        contact,
        created,
        ctx
      )
    ]
  );

  const { error } = await supabase
    .from("instagram_contacts")
    .update({
      current_step:
        "dma_comment_private_reply_sent",

      registration_link_clicked:
        false,

      registration_confirmed:
        false,

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
  payload,
  ctx = {}
) {
  const registerUrl =
    createRegistrationUrl(userId);

  const eventCtx = {
    ...ctx,
    entryPoint: "postback"
  };

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

    await trackedSend(
      userId,
      "trainings",
      eventCtx,
      () => sendButtonTemplate(
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
      )
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

    await trackedSend(
      userId,
      "exam",
      eventCtx,
      () => sendButtonTemplate(
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
      )
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

    await trackedSend(
      userId,
      "question_prompt",
      eventCtx,
      () => sendText(
        userId,
        "Zəhmət olmasa sualınızı yazılı və ya səsli formada qeyd edin, operatorumuz tezliklə cavablandıracaq."
      ),
      () => [
        postbackEvent(
          userId,
          "operator_requested",
          eventCtx
        )
      ]
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

    try {
      await trackedSend(
        userId,
        "registered_ack",
        eventCtx,
        () => sendText(
          userId,
          "Sizə uğurlar arzu edirik!"
        ),
        () => [
          postbackEvent(
            userId,
            "self_confirmed",
            eventCtx
          )
        ]
      );

    } finally {
      // Göndərmə uğursuz olsa belə vəziyyət artıq dəyişib;
      // sticky vaxt damğası yazılır (heç vaxt throw etmir).
      await markFirstConfirmed(userId);
    }

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
  userId,
  ctx = {}
) {
  const registerUrl =
    createRegistrationUrl(userId);

  await trackedSend(
    userId,
    "followup",
    {
      ...ctx,
      entryPoint: "followup"
    },
    () => sendButtonTemplate(
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
    )
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
