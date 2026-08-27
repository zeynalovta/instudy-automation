import { supabase } from "../../lib/supabase.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  try {
    const {
      registration_id,
      slot_id
    } = req.body || {};

    if (!registration_id || !slot_id) {
      return res.status(400).json({
        success: false,
        error: "Məlumatlar natamamdır."
      });
    }

    // Registration mövcuddurmu?
    const { data: registration, error: registrationError } =
      await supabase
        .from("registrations")
        .select(`
          id,
          program,
          exam_booking_id,
          registration_status
        `)
        .eq("id", registration_id)
        .maybeSingle();

    if (registrationError) {
      throw registrationError;
    }

    if (!registration) {
      return res.status(404).json({
        success: false,
        error: "Qeydiyyat tapılmadı."
      });
    }

    // Artıq slot seçibsə
    if (registration.exam_booking_id) {
      return res.status(409).json({
        success: false,
        error: "Siz artıq imtahan vaxtı seçmisiniz."
      });
    }

    // Yeni atomik RPC
    const { data: bookingResult, error: bookingError } =
      await supabase.rpc(
        "reserve_exam_slot_by_registration",
        {
          p_registration_id: registration_id,
          p_slot_id: slot_id
        }
      );

    if (bookingError) {
      throw bookingError;
    }

    if (!bookingResult?.success) {
      const reason = bookingResult?.reason;

      const messages = {
        registration_not_found:
          "Qeydiyyat tapılmadı.",

        already_booked:
          "Siz artıq imtahan vaxtı seçmisiniz.",

        slot_not_found:
          "İmtahan vaxtı tapılmadı.",

        slot_inactive:
          "Bu imtahan vaxtı artıq aktiv deyil.",

        program_mismatch:
          "Seçilmiş imtahan vaxtı təlim istiqamətinizə uyğun deyil.",

        slot_full:
          "Bu imtahan vaxtı artıq dolub. Başqa vaxt seçin."
      };

      return res.status(409).json({
        success: false,
        error:
          messages[reason] ||
          "İmtahan vaxtını rezerv etmək mümkün olmadı."
      });
    }

    return res.status(200).json({
      success: true,
      booking_id:
        bookingResult.booking_id,
      exam_date:
        bookingResult.exam_date,
      exam_time:
        bookingResult.exam_time
    });

  } catch (error) {
    console.error(
      "EXAM BOOKING ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      error:
        "İmtahan vaxtını seçərkən texniki xəta baş verdi."
    });
  }
}
