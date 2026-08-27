import { supabase } from "../../lib/supabase.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  try {
    const program = String(req.query.program || "").trim();

    if (!program) {
      return res.status(400).json({
        success: false,
        error: "Program is required"
      });
    }

    const today = new Date().toISOString().slice(0, 10);

    const { data, error } = await supabase
      .from("exam_slots")
      .select(`
        id,
        program,
        exam_date,
        exam_time,
        capacity,
        booked_count,
        is_active
      `)
      .eq("program", program)
      .eq("is_active", true)
      .gte("exam_date", today)
      .order("exam_date", { ascending: true })
      .order("exam_time", { ascending: true });

    if (error) {
      throw error;
    }

    const slots = (data || [])
      .filter((slot) => slot.booked_count < slot.capacity)
      .map((slot) => ({
        id: slot.id,
        program: slot.program,
        exam_date: slot.exam_date,
        exam_time: slot.exam_time,
        available: slot.capacity - slot.booked_count
      }));

    return res.status(200).json({
      success: true,
      slots
    });

  } catch (error) {
    console.error("EXAM SLOTS ERROR:", error);

    return res.status(500).json({
      success: false,
      error: "İmtahan vaxtlarını yükləmək mümkün olmadı."
    });
  }
}
