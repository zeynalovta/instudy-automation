import crypto from "crypto";
import { supabase } from "../lib/supabase.js";

import {
  eventsEnabled,
  logEvents,
  buildEvent,
  isLikelyBot
} from "../lib/events.js";

const GOOGLE_FORM_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLSdNmcVl9glgVrEWmDEpRwMbZ9l5MEE02i_37fncRebg295wIg/viewform";

const TRACKING_TIMEOUT_MS = 1500;

/*
  Sprint 1A: ölçmə. Yönləndirməni heç vaxt gecikdirmir (maks. 1,5 san)
  və heç vaxt sındırmır. EVENTS_ENABLED=true deyilsə heç nə etmir.
*/
async function markFirstLinkClick(userId, clickedAt) {
  try {
    const { error } = await supabase
      .from("instagram_contacts")
      .update({
        first_link_clicked_at: clickedAt
      })
      .eq("instagram_user_id", userId)
      .is("first_link_clicked_at", null);

    if (error) {
      console.error(
        "FIRST_LINK_CLICK_UPDATE_FAILED:",
        error.message
      );
    }

  } catch (error) {
    console.error(
      "FIRST_LINK_CLICK_UPDATE_FAILED:",
      error?.message
    );
  }
}

async function trackLinkClick(req, userId) {
  if (!eventsEnabled()) {
    return;
  }

  let timer;

  try {
    const clickedAt = new Date().toISOString();

    const userAgent = String(
      req.headers?.["user-agent"] || ""
    ).slice(0, 200);

    const work = Promise.allSettled([
      logEvents([
        buildEvent({
          userId,
          type: "link_clicked",
          occurredAt: clickedAt,

          metadata: {
            user_agent: userAgent || null,
            likely_bot: isLikelyBot(userAgent),

            request_id:
              req.headers?.["x-vercel-id"] ?? null
          }
        })
      ]),

      markFirstLinkClick(userId, clickedAt)
    ]);

    const timeout = new Promise((resolve) => {
      timer = setTimeout(
        resolve,
        TRACKING_TIMEOUT_MS
      );
    });

    await Promise.race([work, timeout]);

  } catch (error) {
    console.error(
      "EVENT_CAPTURE_FAILED:",
      error?.message
    );

  } finally {
    clearTimeout(timer);
  }
}

function validSignature(userId, signature) {
  const expected = crypto
    .createHmac("sha256", process.env.TRACKING_SECRET)
    .update(userId)
    .digest("hex");

  if (!signature || signature.length !== expected.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}

export default async function handler(req, res) {
  const userId = req.query.u;
  const signature = req.query.s;

  if (!userId || !validSignature(userId, signature)) {
    return res.status(403).send("Invalid registration link");
  }

  const { error } = await supabase
    .from("instagram_contacts")
    .update({
      registration_link_clicked: true,
      followup_due_at: null,
      current_step: "registration_link_clicked"
    })
    .eq("instagram_user_id", userId);

  if (error) {
    console.error("Registration tracking error:", error);
  }

  await trackLinkClick(req, userId);

  return res.redirect(302, GOOGLE_FORM_URL);
}
