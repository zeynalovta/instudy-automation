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

    // 1. Registration-u tap
    const { data: registration, error: registrationError } =
      await supabase
        .from("registrations")
        .select("*")
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

    // Artıq exam slot seçilibsə yenidən seçim etməsin
    if (registration.exam_booking_id) {
      return res.status(409).json({
        success: false,
        error: "Siz artıq imtahan vaxtı seçmisiniz."
      });
    }

    // 2. Slotu yoxla
    const { data: slot, error: slotError } =
      await supabase
        .from("exam_slots")
        .select("*")
        .eq("id", slot_id)
        .maybeSingle();

    if (slotError) {
      throw slotError;
    }

    if (!slot) {
      return res.status(404).json({
        success: false,
        error: "İmtahan vaxtı tapılmadı."
      });
    }

    if (!slot.is_active) {
      return res.status(409).json({
        success: false,
        error: "Bu imtahan vaxtı artıq aktiv deyil."
      });
    }

    if (slot.program !== registration.program) {
      return res.status(400).json({
        success: false,
        error: "Seçilmiş imtahan vaxtı təlim istiqamətinə uyğun deyil."
      });
    }

    if (slot.booked_count >= slot.capacity) {
      return res.status(409).json({
        success: false,
        error: "Təəssüf ki, bu imtahan vaxtı indicə doldu. Başqa vaxt seçin."
      });
    }

    // 3. Instagram contact olmalıdır
    // exam_bookings table hazırda instagram_contact_id tələb edir.
    if (!registration.instagram_contact_id) {
      return res.status(400).json({
        success: false,
        error: "Instagram əlaqəsi tapılmadı."
      });
    }

    // 4. Əvvəl yaratdığımız atomik RPC-ni çağır
    const { data: bookingResult, error: bookingError } =
      await supabase.rpc("reserve_exam_slot", {
        p_contact_id: registration.instagram_contact_id,
        p_slot_id: slot_id
      });

    if (bookingError) {
      throw bookingError;
    }

    if (!bookingResult?.success) {
      const reason = bookingResult?.reason;

      if (reason === "slot_full") {
        return res.status(409).json({
          success: false,
          error: "Bu imtahan vaxtı artıq dolub. Başqa vaxt seçin."
        });
      }

      if (reason === "already_booked") {
        return res.status(409).json({
          success: false,
          error: "Siz artıq imtahan vaxtı seçmisiniz."
        });
      }

      return res.status(400).json({
        success: false,
        error: "İmtahan vaxtını rezerv etmək mümkün olmadı."
      });
    }

    // 5. Booking ID-ni registration-a yaz
    const bookingId =
      bookingResult.booking_id;

    const { error: updateError } =
      await supabase
        .from("registrations")
        .update({
          exam_booking_id: bookingId,
          registration_status: "exam_selected"
        })
        .eq("id", registration_id);

    if (updateError) {
      throw updateError;
    }

    return res.status(200).json({
      success: true,
      booking_id: bookingId,
      exam_date: bookingResult.exam_date,
      exam_time: bookingResult.exam_time
    });

  } catch (error) {
    console.error("EXAM BOOKING ERROR:", error);

    return res.status(500).json({
      success: false,
      error: "İmtahan vaxtını seçərkən texniki xəta baş verdi."
    });
  }
}
