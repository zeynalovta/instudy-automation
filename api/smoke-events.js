import crypto from "crypto";

import { supabase } from "../lib/supabase.js";

import {
  eventsEnabled,
  logEvents,
  buildEvent
} from "../lib/events.js";

/*
  TEMPORARY SMOKE TEST (Sprint 1A). Yalnız `sprint-1a-smoke` branch-ində
  mövcuddur və heç vaxt main-ə birləşdirilməməlidir.

  Məqsəd: Preview mühitində tətbiqin istifadə etdiyi EYNİ yolu
  (supabase-js -> PostgREST -> log_instagram_events RPC) real Supabase
  ilə yoxlamaq.

  Təhlükəsizlik:
  - Yalnız VERCEL_ENV=preview. Başqa mühitdə 404.
  - Yalnız POST.
  - x-smoke-secret başlığı SMOKE_TEST_SECRET ilə uyğun olmalıdır.
    Hər uyğunsuzluq (secret yoxdur/yanlışdır/env təyin olunmayıb) 404 verir.
  - EVENTS_ENABLED=true olmalıdır, yoxsa 409 (heç nə yazılmır).
  - Yazılan bütün data serverdə SABİT tərtib edilmişdir. Sorğudan yalnız
    yoxlanılan run_id qəbul olunur.
  - Instagram / Meta kodu import EDİLMİR (dma-flow, instagram, webhook yox).
    Bu endpoint heç kimə mesaj göndərə bilməz.
  - Cavabda heç bir env dəyəri və ya secret qaytarılmır.
*/

const RUN_ID_PATTERN = /^[a-z0-9-]{6,32}$/;

function notFound(res) {
  return res
    .status(404)
    .json({ error: "not_found" });
}

function secretMatches(provided, expected) {
  if (
    !expected ||
    typeof provided !== "string"
  ) {
    return false;
  }

  // SHA-256 ilə sabit uzunluq: timingSafeEqual uzunluq fərqində atmasın.
  const left = crypto
    .createHash("sha256")
    .update(provided)
    .digest();

  const right = crypto
    .createHash("sha256")
    .update(expected)
    .digest();

  return crypto.timingSafeEqual(left, right);
}

function readBody(req) {
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }

  return req.body && typeof req.body === "object"
    ? req.body
    : {};
}

function generateRunId() {
  return (
    Date.now().toString(36) +
    "-" +
    crypto.randomBytes(3).toString("hex")
  );
}

function shortError(error) {
  return {
    code: error?.code ?? null,
    message: String(error?.message ?? "").slice(0, 160)
  };
}

/*
  Sabit sintetik event dəsti (5 event). İstifadəçi ID-si:
  __smoke__:<run-id>. Hər event-də metadata.smoke_test=true.
  Bir event (link_clicked) qəsdən dedupe açarsızdır.
*/
function buildSmokeEvents(runId, userId, requestId) {
  const now = new Date().toISOString();
  const prefix = `smoke:${runId}`;

  const base = {
    smoke_test: true,
    request_id: requestId
  };

  return [
    buildEvent({
      userId,
      type: "incoming_message",
      channel: "dm",
      adId: "SMOKE_AD_1",
      dedupeKey: `${prefix}:msg:1`,
      occurredAt: now,

      metadata: {
        ...base,
        message_type: "text",
        has_text: true,
        text_length: 18,
        matched_keyword: null,

        referral: {
          source: "ADS",
          type: "OPEN_THREAD",
          ad_id: "SMOKE_AD_1",
          ad_title: "SMOKE AD",
          post_id: null,
          ref: null
        },

        trigger_key: `${prefix}:msg:1`
      },

      text: "smoke test message"
    }),

    buildEvent({
      userId,
      type: "flow_started",
      channel: "dm",
      dedupeKey: `${prefix}:flow:1`,
      occurredAt: now,

      metadata: {
        ...base,
        is_new_contact: true,
        entry_point: "dm",
        trigger_key: `${prefix}:msg:1`
      }
    }),

    buildEvent({
      userId,
      type: "message_sent",
      channel: "dm",
      dedupeKey: `${prefix}:sent:1`,
      occurredAt: now,

      metadata: {
        ...base,
        message_kind: "main",
        api_message_id: "SMOKE-MID-1",
        has_register_link: true,
        entry_point: "dm"
      }
    }),

    buildEvent({
      userId,
      type: "incoming_comment",
      channel: "comment",
      mediaId: "SMOKE_MEDIA_1",
      dedupeKey: `${prefix}:cmt:1`,
      occurredAt: now,

      metadata: {
        ...base,
        media_product_type: "FEED",
        has_parent: false,
        text_length: 13,
        trigger_key: `${prefix}:cmt:1`
      },

      text: "smoke comment"
    }),

    buildEvent({
      userId,
      type: "link_clicked",
      occurredAt: now,

      metadata: {
        ...base,
        user_agent: "smoke-test",
        likely_bot: false
      }
    })
  ];
}

function sameResult(actual, expected) {
  return (
    actual !== null &&
    actual !== undefined &&
    actual.inserted === expected.inserted &&
    actual.duplicates === expected.duplicates &&
    actual.failed === expected.failed
  );
}

export default async function handler(
  req,
  res
) {
  res.setHeader("Cache-Control", "no-store");

  // 1) Yalnız Preview
  if (process.env.VERCEL_ENV !== "preview") {
    return notFound(res);
  }

  // 2) Yalnız POST
  if (req.method !== "POST") {
    return notFound(res);
  }

  // 3) Secret başlığı (təyin olunmayıbsa bağlıdır)
  if (
    !secretMatches(
      req.headers?.["x-smoke-secret"],
      process.env.SMOKE_TEST_SECRET
    )
  ) {
    return notFound(res);
  }

  // 4) Event yazma aktiv olmalıdır
  if (!eventsEnabled()) {
    return res
      .status(409)
      .json({ error: "events_disabled" });
  }

  // 5) run_id: yalnız yoxlanılan dəyər qəbul olunur
  const body = readBody(req);

  const runId =
    body.run_id === undefined
      ? generateRunId()
      : body.run_id;

  if (
    typeof runId !== "string" ||
    !RUN_ID_PATTERN.test(runId)
  ) {
    return res
      .status(400)
      .json({ error: "invalid_run_id" });
  }

  const userId = `__smoke__:${runId}`;

  const requestId =
    req.headers?.["x-vercel-id"] ?? null;

  const steps = {};

  // A) Yeni run: 5 yeni event (2 payload sətri)
  steps.batch_a = await logEvents(
    buildSmokeEvents(runId, userId, requestId)
  );

  // B) Eyni batch təkrarı: dedupe açarlı 4 event təkrar sayılır,
  //    açarsız link_clicked yenidən yazılır (yeni sətir)
  steps.batch_b_repeat = await logEvents(
    buildSmokeEvents(runId, userId, requestId)
  );

  // C) Qismən xəta izolyasiyası: istifadəçi ID-si olmayan sətir uğursuz olur,
  //    mövcud açarlı sətir dublikat sayılır (yeni sətir yoxdur)
  const duplicateOfFirst = buildSmokeEvents(
    runId,
    userId,
    requestId
  )[0];

  const withoutUser = buildEvent({
    userId: null,
    type: "incoming_message",
    metadata: { smoke_test: true }
  });

  steps.partial_failure = await logEvents([
    withoutUser,
    duplicateOfFirst
  ]);

  // D) service_role instagram_events-i dəyişə/silə bilməməlidir
  const updateAttempt = await supabase
    .from("instagram_events")
    .update({ channel: "smoke-should-fail" })
    .eq("dedupe_key", `smoke:${runId}:msg:1`);

  steps.update_denied = {
    denied: Boolean(updateAttempt.error),
    ...shortError(updateAttempt.error)
  };

  const deleteAttempt = await supabase
    .from("instagram_events")
    .delete()
    .eq("dedupe_key", `smoke:${runId}:msg:1`);

  steps.delete_denied = {
    denied: Boolean(deleteAttempt.error),
    ...shortError(deleteAttempt.error)
  };

  const expected = {
    batch_a: {
      inserted: 5,
      duplicates: 0,
      failed: 0
    },

    batch_b_repeat: {
      inserted: 1,
      duplicates: 4,
      failed: 0
    },

    partial_failure: {
      inserted: 0,
      duplicates: 1,
      failed: 1
    },

    update_denied: { denied: true, code: "42501" },
    delete_denied: { denied: true, code: "42501" }
  };

  const checks = {
    batch_a: sameResult(
      steps.batch_a,
      expected.batch_a
    ),

    batch_b_repeat: sameResult(
      steps.batch_b_repeat,
      expected.batch_b_repeat
    ),

    partial_failure: sameResult(
      steps.partial_failure,
      expected.partial_failure
    ),

    update_denied:
      steps.update_denied.denied === true &&
      steps.update_denied.code === "42501",

    delete_denied:
      steps.delete_denied.denied === true &&
      steps.delete_denied.code === "42501"
  };

  return res
    .status(200)
    .json({
      run_id: runId,
      smoke_user: userId,
      node: process.version,
      vercel_env: process.env.VERCEL_ENV,
      steps,
      expected,
      checks,
      pass: Object.values(checks).every(Boolean)
    });
}
