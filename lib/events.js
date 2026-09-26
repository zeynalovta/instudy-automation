import { supabase } from "./supabase.js";

/*
  Sprint 1A: measurement / observability / attribution.

  Bu modul yalnız hadisələri (event) yazır. Heç bir istifadəçi
  davranışını dəyişmir və heç vaxt əsas Instagram axınını sındırmır.

  EVENTS_ENABLED=true olmayana qədər bütün funksiyalar heç nə etmir.

  Qaydalar:
  - Event metadata-sında istifadəçinin sərbəst mətni OLMAMALIDIR.
    Mətn yalnız `text` sahəsində (payload cədvəli, maks. 500 simvol) ötürülür.
  - Attachment URL-ləri (photo_url, video_url və s.) saxlanmır.
  - Yazma xətaları EVENT_LOG_FAILED kimi log-lanır və udulur.
*/

const MAX_TEXT_LENGTH = 500;
const MAX_FIELD_LENGTH = 200;
const RPC_TIMEOUT_MS = 2000;

export function eventsEnabled() {
  return process.env.EVENTS_ENABLED === "true";
}

/* =========================================================
   SMALL HELPERS
========================================================= */

function cut(value, max = MAX_FIELD_LENGTH) {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value);

  return text.length > max
    ? text.slice(0, max)
    : text;
}

/*
  Meta timestamp-ları saniyə (entry.time) və ya millisaniyə
  (messaging.timestamp) ola bilər.
*/
export function toIso(value) {
  const number = Number(value);

  if (!Number.isFinite(number) || number <= 0) {
    return null;
  }

  const milliseconds =
    number < 1e11
      ? number * 1000
      : number;

  const date = new Date(milliseconds);

  return Number.isNaN(date.getTime())
    ? null
    : date.toISOString();
}

export function ctxMetadata(ctx = {}) {
  return {
    request_id: ctx.requestId ?? null,
    trigger_key: ctx.triggerKey ?? null,
    entry_point: ctx.entryPoint ?? null
  };
}

/* =========================================================
   EVENT BUILDER
========================================================= */

export function buildEvent({
  userId,
  type,
  channel = null,
  program = null,
  programMethod = null,
  adId = null,
  mediaId = null,
  dedupeKey = null,
  occurredAt = null,
  metadata = {},
  text = null
}) {
  return {
    instagram_user_id:
      userId === null || userId === undefined
        ? null
        : String(userId),

    event_type: type,
    channel,
    program,
    program_method: programMethod,
    ad_id: cut(adId),
    media_id: cut(mediaId),
    dedupe_key: cut(dedupeKey, 300),
    occurred_at: occurredAt,
    metadata,

    text: text
      ? String(text).slice(0, MAX_TEXT_LENGTH)
      : null
  };
}

/* =========================================================
   WRITE (RPC log_instagram_events)
========================================================= */

/*
  Heç vaxt throw etmir. Xəta olsa yalnız log-layır.
*/
export async function logEvents(events) {
  if (!eventsEnabled()) {
    return null;
  }

  let list = [];

  // Bütün hazırlıq və yazma bir try daxilindədir: heç bir halda throw etmir.
  try {
    list = (
      Array.isArray(events)
        ? events
        : [events]
    ).filter(Boolean);

    if (list.length === 0) {
      return null;
    }

    /*
      Eyni user_key-lərin paralel batch-lərdə əks sırada
      kilidlənib deadlock yaratmaması üçün istifadəçi ID-sinə
      görə sıralanır (sort sabitdir, eyni istifadəçinin
      event-lərinin sırası dəyişmir).
    */
    list.sort((a, b) => {
      const left = String(a.instagram_user_id ?? "");
      const right = String(b.instagram_user_id ?? "");

      if (left < right) return -1;
      if (left > right) return 1;
      return 0;
    });

    const { data, error } = await supabase
      .rpc(
        "log_instagram_events",
        { p_events: list }
      )
      .abortSignal(
        AbortSignal.timeout(RPC_TIMEOUT_MS)
      );

    if (error) {
      console.error(
        "EVENT_LOG_FAILED:",
        JSON.stringify({
          code: error.code ?? null,
          message: cut(error.message),
          events: list.length
        })
      );

      return null;
    }

    if (data && data.failed > 0) {
      console.error(
        "EVENT_LOG_PARTIAL_FAILURE:",
        JSON.stringify({
          result: data,
          events: list.length
        })
      );
    }

    return data;

  } catch (error) {
    console.error(
      "EVENT_LOG_FAILED:",
      JSON.stringify({
        message: cut(error?.message),
        events: list.length
      })
    );

    return null;
  }
}

/* =========================================================
   META PAYLOAD HELPERS
========================================================= */

/*
  Yalnız allowlist. photo_url, video_url, product_id və digər
  müvəqqəti/imzalı URL-lər ATILIR.
*/
export function sanitizeReferral(referral) {
  if (!referral || typeof referral !== "object") {
    return null;
  }

  const context =
    referral.ads_context_data &&
    typeof referral.ads_context_data === "object"
      ? referral.ads_context_data
      : {};

  return {
    source: cut(referral.source, 60),
    type: cut(referral.type, 60),
    ref: cut(referral.ref),
    ad_id: cut(referral.ad_id),
    ad_title: cut(context.ad_title),
    post_id: cut(context.post_id)
  };
}

export function describeMessage(message) {
  const attachments = Array.isArray(message?.attachments)
    ? message.attachments
    : [];

  const attachmentTypes = attachments.map(
    (attachment) =>
      cut(attachment?.type, 30) || "unknown"
  );

  const hasText =
    typeof message?.text === "string" &&
    message.text.length > 0;

  let messageType;

  if (message?.is_deleted) {
    messageType = "deleted";
  } else if (message?.is_unsupported) {
    messageType = "unsupported";
  } else if (attachmentTypes.length > 0) {
    messageType = attachmentTypes[0];
  } else if (hasText) {
    messageType = "text";
  } else {
    messageType = "unknown";
  }

  return {
    messageType,
    attachmentTypes,
    hasText
  };
}

/*
  Yalnız açıq siqnal. Tam söz sərhədi (Azərbaycan hərfləri
  nəzərə alınır). Bir neçə proqram tapılsa program=null.
*/
const PROGRAM_PATTERNS = [
  [
    "backend",
    /(?<![\p{L}\p{N}])(?:back-?end|back end|bekend)\p{L}*/u
  ],
  [
    "frontend",
    /(?<![\p{L}\p{N}])(?:front-?end|front end)\p{L}*/u
  ],
  [
    "hr",
    /(?<![\p{L}\p{N}])hr(?![\p{L}\p{N}])/u
  ],
  [
    "data",
    /(?<![\p{L}\p{N}])data(?![\p{L}\p{N}])/u
  ],
  [
    "accounting",
    /(?<![\p{L}\p{N}])(?:mühasib|muhasib)\p{L}*/u
  ],
  [
    "computer_operator",
    /(?<![\p{L}\p{N}])(?:kompüter|komputer)\p{L}*\s+operator\p{L}*/u
  ]
];

export function detectProgram(text) {
  if (!text) {
    return null;
  }

  const normalized =
    String(text).toLocaleLowerCase("az");

  const candidates = PROGRAM_PATTERNS
    .filter(([, pattern]) =>
      pattern.test(normalized)
    )
    .map(([program]) => program);

  if (candidates.length === 0) {
    return null;
  }

  if (candidates.length === 1) {
    return {
      program: candidates[0],
      method: "keyword",
      candidates
    };
  }

  return {
    program: null,
    method: null,
    candidates
  };
}

/*
  callInstagram xətanı new Error(JSON.stringify(data)) kimi atır,
  şərh axını isə "Private comment reply failed: {json}" kimi.
*/
export function parseInstagramError(error) {
  const raw =
    error && typeof error === "object" && "message" in error
      ? String(error.message)
      : String(error ?? "");

  const start = raw.indexOf("{");

  let parsed = null;

  if (start >= 0) {
    try {
      parsed = JSON.parse(raw.slice(start));
    } catch {
      parsed = null;
    }
  }

  const apiError = parsed?.error;

  if (apiError && typeof apiError === "object") {
    return {
      error_code: apiError.code ?? null,
      error_subcode: apiError.error_subcode ?? null,
      error_type: cut(apiError.type, 60),
      error_message: cut(apiError.message)
    };
  }

  return {
    error_code: error?.code ?? null,
    error_subcode: null,
    error_type: cut(error?.name, 60),
    error_message: cut(raw)
  };
}

export function isLikelyBot(userAgent) {
  const value = String(userAgent || "");

  if (!value) {
    return null;
  }

  // "Instagram" sözü bot əlaməti deyil: real istifadəçilərin
  // Instagram daxili brauzeri belə görünür.
  return /facebookexternalhit|facebot|crawler|spider|preview|headless|curl\/|python-requests|go-http-client|\bbot\b/i
    .test(value);
}

export function messagingTriggerKey(event) {
  if (event?.message?.mid) {
    return `msg:${event.message.mid}`;
  }

  if (event?.postback?.mid) {
    return `pb:${event.postback.mid}`;
  }

  return null;
}

/* =========================================================
   INCOMING EVENTS (webhook body -> events)
========================================================= */

/*
  Webhook sorğusundakı bütün gələn hadisələri (DM, story cavabı,
  postback, şərh) event-ə çevirir. Botun cavab verib-vermədiyindən
  və açar sözün olub-olmamasından asılı deyil.

  Öz mesajlarımız (is_echo) və öz şərhlərimiz buraya düşmür.
*/
export function buildIncomingEvents(
  body,
  {
    requestId = null,
    findMatchedKeyword = () => null,
    ownAccountId = null
  } = {}
) {
  const events = [];

  for (const entry of body?.entry || []) {

    /* ---------------- DM / STORY / POSTBACK ---------------- */

    for (const event of entry?.messaging || []) {
      const senderId = event?.sender?.id;

      if (!senderId) {
        continue;
      }

      const message = event.message;

      if (message?.is_echo) {
        continue;
      }

      const occurredAt = toIso(event.timestamp);

      if (event.postback?.payload) {
        const key = event.postback.mid
          ? `pb:${event.postback.mid}`
          : null;

        events.push(
          buildEvent({
            userId: senderId,
            type: "incoming_postback",
            channel: "postback",
            dedupeKey: key,
            occurredAt,
            metadata: {
              payload: cut(event.postback.payload, 100),
              title: cut(event.postback.title, 100),
              trigger_key: key,
              request_id: requestId
            }
          })
        );

        continue;
      }

      if (!message) {
        continue;
      }

      const text =
        typeof message.text === "string"
          ? message.text
          : "";

      const {
        messageType,
        attachmentTypes,
        hasText
      } = describeMessage(message);

      const referral = sanitizeReferral(
        message.referral ?? event.referral ?? null
      );

      const isStoryReply = Boolean(
        message.reply_to?.story
      );

      const program = detectProgram(text);

      const key = message.mid
        ? `msg:${message.mid}`
        : null;

      events.push(
        buildEvent({
          userId: senderId,
          type: "incoming_message",
          channel: isStoryReply ? "story_reply" : "dm",

          program: program?.program ?? null,

          programMethod: program?.program
            ? program.method
            : null,

          adId: referral?.ad_id ?? null,
          dedupeKey: key,
          occurredAt,

          metadata: {
            message_type: messageType,
            attachment_types: attachmentTypes,
            has_text: hasText,
            text_length: text.length,

            matched_keyword: text
              ? cut(findMatchedKeyword(text))
              : null,

            is_story_reply: isStoryReply,

            reply_to_story_id: cut(
              message.reply_to?.story?.id,
              100
            ),

            referral,

            program_candidates:
              program && program.candidates.length > 1
                ? program.candidates
                : undefined,

            raw_event_keys: Object.keys(event),
            raw_message_keys: Object.keys(message),

            trigger_key: key,
            request_id: requestId
          },

          text
        })
      );
    }

    /* ---------------- COMMENTS ---------------- */

    for (const change of entry?.changes || []) {
      if (change?.field !== "comments") {
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

      if (!commenterId || !commentId) {
        continue;
      }

      if (
        ownAccountId &&
        String(commenterId) === String(ownAccountId)
      ) {
        continue;
      }

      const commentText =
        value.text ||
        value.message ||
        "";

      const program = detectProgram(commentText);

      const key = `cmt:${commentId}`;

      events.push(
        buildEvent({
          userId: commenterId,
          type: "incoming_comment",
          channel: "comment",

          program: program?.program ?? null,

          programMethod: program?.program
            ? program.method
            : null,

          mediaId: value.media?.id ?? null,
          dedupeKey: key,
          occurredAt: toIso(entry?.time),

          metadata: {
            media_product_type: cut(
              value.media?.media_product_type,
              60
            ),

            has_parent: Boolean(value.parent_id),
            text_length: String(commentText).length,

            program_candidates:
              program && program.candidates.length > 1
                ? program.candidates
                : undefined,

            raw_value_keys: Object.keys(value),

            trigger_key: key,
            request_id: requestId
          },

          text: commentText
        })
      );
    }
  }

  return events;
}

/*
  Sorğudakı emal olunacaq element sayı (messaging + comment change).
  webhook_aborted zamanı qalan element sayını hesablamaq üçün.
*/
export function countRequestItems(body) {
  let total = 0;

  for (const entry of body?.entry || []) {
    total += (entry?.messaging || []).length;
    total += (entry?.changes || []).length;
  }

  return total;
}
