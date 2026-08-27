import { supabase } from "../../lib/supabase.js";
import { syncRegistrationToGoogleSheets } from "../../lib/google-sheets.js";

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

    // =====================================================
    // 1. REGISTRATION-U TAP
    // =====================================================

    const {
      data: registration,
      error: registrationError
    } = await supabase
      .from("registrations")
      .select(`
        id,
        instagram_username,
        full_name,
        father_name,
        fin,
        birth_date,
        phone,
        program,
        education_level,
        is_student,
        is_employed,
        has_active_voen,
        dma_unemployed_registered,
        attended_dma_course_last_year,
        address,
        eligibility_status,
        exam_booking_id,
        registration_status,
        created_at
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

    // Artıq slot seçilib
    if (registration.exam_booking_id) {
      return res.status(409).json({
        success: false,
        error: "Siz artıq imtahan vaxtı seçmisiniz."
      });
    }

    // =====================================================
    // 2. ATOMİK SLOT REZERVASİYASI
    // =====================================================

    const {
      data: bookingResult,
      error: bookingError
    } = await supabase.rpc(
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

    // =====================================================
    // 3. GOOGLE SHEETS-DƏ EYNİ SƏTRİ YENİLƏ
    // =====================================================

    const sheetResult =
      await syncRegistrationToGoogleSheets({
        registration_id:
          registration.id,

        full_name:
          registration.full_name,

        father_name:
          registration.father_name,

        fin:
          registration.fin,

        birth_date:
          registration.birth_date,

        phone:
          registration.phone,

        program:
          registration.program,

        education_level:
          registration.education_level,

        is_student:
          registration.is_student,

        is_employed:
          registration.is_employed,

        has_active_voen:
          registration.has_active_voen,

        dma_unemployed_registered:
          registration.dma_unemployed_registered,

        attended_dma_course_last_year:
          registration.attended_dma_course_last_year,

        address:
          registration.address,

        eligibility_status:
          registration.eligibility_status,

        exam_date:
          bookingResult.exam_date,

        exam_time:
          bookingResult.exam_time,

        exam_status:
          "confirmed",

        created_at:
          registration.created_at,

        instagram_username:
          registration.instagram_username || ""
      });

    // =====================================================
    // 4. SYNC STATUS-U SUPABASE-DƏ SAXLA
    // =====================================================

    if (sheetResult.success) {
      await supabase
        .from("registrations")
        .update({
          sheets_sync_status: "synced",
          sheets_synced_at:
            new Date().toISOString()
        })
        .eq("id", registration.id);
    } else {
      await supabase
        .from("registrations")
        .update({
          sheets_sync_status: "failed"
        })
        .eq("id", registration.id);

      console.error(
        "EXAM GOOGLE SHEETS SYNC FAILED:",
        sheetResult
      );
    }

    // =====================================================
    // 5. USER RESPONSE
    // =====================================================

    return res.status(200).json({
      success: true,

      booking_id:
        bookingResult.booking_id,

      exam_date:
        bookingResult.exam_date,

      exam_time:
        bookingResult.exam_time,

      sheets_sync_status:
        sheetResult.success
          ? "synced"
          : "failed"
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
