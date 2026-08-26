import crypto from "crypto";
import { supabase } from "../lib/supabase.js";

const GOOGLE_FORM_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLSdNmcVl9glgVrEWmDEpRwMbZ9l5MEE02i_37fncRebg295wIg/viewform";

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

  return res.redirect(302, GOOGLE_FORM_URL);
}
