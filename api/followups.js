import { supabase } from "../lib/supabase.js";
import { sendDmaFollowup } from "../lib/dma-flow.js";

export default async function handler(req, res) {
  if (
    req.headers.authorization !==
    `Bearer ${process.env.FOLLOWUP_SECRET}`
  ) {
    return res.status(401).json({
      error: "Unauthorized"
    });
  }

  try {
    const now = new Date().toISOString();

    const { data: contacts, error } = await supabase
      .from("instagram_contacts")
      .select("*")
      .eq("registration_link_clicked", false)
      .eq("registration_confirmed", false)
      .eq("followup_sent", false)
      .not("followup_due_at", "is", null)
      .lte("followup_due_at", now)
      .limit(100);

    if (error) {
      throw error;
    }

    let sent = 0;

    for (const contact of contacts || []) {
      try {
        await sendDmaFollowup(
          contact.instagram_user_id
        );

        sent++;
      } catch (error) {
        console.error(
          "FOLLOWUP SEND ERROR:",
          contact.instagram_user_id,
          error
        );
      }
    }

    return res.status(200).json({
      success: true,
      found: contacts?.length || 0,
      sent
    });

  } catch (error) {
    console.error("FOLLOWUP ENDPOINT ERROR:", error);

    return res.status(500).json({
      success: false,
      error: "followup_failed"
    });
  }
}
