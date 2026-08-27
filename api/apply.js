import { supabase } from "../lib/supabase.js";
import { syncRegistrationToGoogleSheets } from "../lib/google-sheets.js";

const ALLOWED_PROGRAMS = [
  "data",
  "frontend",
  "backend",
  "hr",
  "computer_operator",
  "accounting"
];

const ALLOWED_EDUCATION_LEVELS = [
  "secondary",
  "vocational",
  "bachelor",
  "master"
];

function cleanText(value) {
  return String(value || "").trim();
}

function normalizePhone(phone) {
  return cleanText(phone)
    .replace(/\s+/g, "")
    .replace(/-/g, "");
}

function calculateAge(birthDate) {
  const birth = new Date(birthDate);

  if (Number.isNaN(birth.getTime())) {
    return null;
  }

  const today = new Date();

  let age =
    today.getFullYear() -
    birth.getFullYear();

  const monthDifference =
    today.getMonth() -
    birth.getMonth();

  if (
    monthDifference < 0 ||
    (
      monthDifference === 0 &&
      today.getDate() < birth.getDate()
    )
  ) {
    age--;
  }

  return age;
}

function parseBoolean(value) {
  if (value === true || value === "true") {
    return true;
  }

  if (value === false || value === "false") {
    return false;
  }

  return null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  try {
    const {
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
      instagram_user_id,
      instagram_username
    } = req.body || {};

    const cleanName =
      cleanText(full_name);

    const cleanFatherName =
      cleanText(father_name);

    const cleanFin =
      cleanText(fin).toUpperCase();

    const cleanBirthDate =
      cleanText(birth_date);

    const cleanPhone =
      normalizePhone(phone);

    const cleanProgram =
      cleanText(program);

    const cleanEducation =
      cleanText(education_level);

    const cleanAddress =
      cleanText(address);

    const studentStatus =
      parseBoolean(is_student);

    const employedStatus =
      parseBoolean(is_employed);

    const activeVoenStatus =
      parseBoolean(has_active_voen);

    const dmaRegisteredStatus =
      parseBoolean(
        dma_unemployed_registered
      );

    const attendedDmaStatus =
      parseBoolean(
        attended_dma_course_last_year
      );

    /* ================================================
       VALIDATION
    ================================================= */

    if (cleanName.length < 3) {
      return res.status(400).json({
        success: false,
        error:
          "Ad və soyad düzgün daxil edilməyib."
      });
    }

    if (cleanFatherName.length < 2) {
      return res.status(400).json({
        success: false,
        error:
          "Ata adı düzgün daxil edilməyib."
      });
    }

    if (cleanFin.length < 5) {
      return res.status(400).json({
        success: false,
        error:
          "FİN düzgün daxil edilməyib."
      });
    }

    if (!cleanBirthDate) {
      return res.status(400).json({
        success: false,
        error:
          "Doğum tarixini daxil edin."
      });
    }

    const age =
      calculateAge(cleanBirthDate);

    if (age === null) {
      return res.status(400).json({
        success: false,
        error:
          "Doğum tarixi düzgün deyil."
      });
    }

    if (cleanPhone.length < 9) {
      return res.status(400).json({
        success: false,
        error:
          "Telefon nömrəsi düzgün daxil edilməyib."
      });
    }

    if (
      !ALLOWED_PROGRAMS.includes(
        cleanProgram
      )
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Təlim istiqaməti düzgün seçilməyib."
      });
    }

    if (
      !ALLOWED_EDUCATION_LEVELS.includes(
        cleanEducation
      )
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Təhsil səviyyəsi düzgün seçilməyib."
      });
    }

    if (!cleanAddress) {
      return res.status(400).json({
        success: false,
        error:
          "Faktiki yaşayış ünvanını daxil edin."
      });
    }

    if (
      studentStatus === null ||
      employedStatus === null ||
      activeVoenStatus === null ||
      dmaRegisteredStatus === null ||
      attendedDmaStatus === null
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Bütün uyğunluq suallarını cavablandırın."
      });
    }

    /* ================================================
       ELIGIBILITY
    ================================================= */

    const eligibilityReasons = [];

    if (age < 18 || age > 35) {
      eligibilityReasons.push(
        "AGE_NOT_ELIGIBLE"
      );
    }

    if (studentStatus === true) {
      eligibilityReasons.push(
        "STUDENT_STATUS"
      );
    }

    if (activeVoenStatus === true) {
      eligibilityReasons.push(
        "ACTIVE_VOEN"
      );
    }

    const eligibilityStatus =
      eligibilityReasons.length === 0
        ? "eligible"
        : "ineligible";

    /* ================================================
       INSTAGRAM CONTACT
    ================================================= */

    let instagramContactId = null;

    if (instagram_user_id) {
      const {
        data: contact,
        error: contactError
      } = await supabase
        .from("instagram_contacts")
        .select("id")
        .eq(
          "instagram_user_id",
          instagram_user_id
        )
        .maybeSingle();

      if (contactError) {
        throw contactError;
      }

      instagramContactId =
        contact?.id || null;
    }

    /* ================================================
       SAVE REGISTRATION TO SUPABASE
    ================================================= */

    const {
      data: registration,
      error
    } = await supabase
      .from("registrations")
      .insert({
        instagram_contact_id:
          instagramContactId,

        instagram_user_id:
          instagram_user_id || null,

        instagram_username:
          instagram_username || null,

        full_name:
          cleanName,

        father_name:
          cleanFatherName,

        fin:
          cleanFin,

        birth_date:
          cleanBirthDate,

        phone:
          cleanPhone,

        program:
          cleanProgram,

        education_level:
          cleanEducation,

        is_student:
          studentStatus,

        is_employed:
          employedStatus,

        has_active_voen:
          activeVoenStatus,

        dma_unemployed_registered:
          dmaRegisteredStatus,

        attended_dma_course_last_year:
          attendedDmaStatus,

        address:
          cleanAddress,

        eligibility_status:
          eligibilityStatus,

        eligibility_reason:
          eligibilityReasons.length
            ? eligibilityReasons.join(" ")
            : null,

        registration_status:
          "registered",

        sheets_sync_status:
          "pending"
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    /* ================================================
       GOOGLE SHEETS SYNC
    ================================================= */

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

        exam_date: "",
        exam_time: "",
        exam_status: "",

        created_at:
          registration.created_at,

        instagram_username:
          registration.instagram_username || ""
      });

    if (sheetResult.success) {
      await supabase
        .from("registrations")
        .update({
          sheets_sync_status:
            "synced",

          sheets_synced_at:
            new Date().toISOString()
        })
        .eq(
          "id",
          registration.id
        );
    } else {
      await supabase
        .from("registrations")
        .update({
          sheets_sync_status:
            "failed"
        })
        .eq(
          "id",
          registration.id
        );
    }

    /* ================================================
       RESPONSE
    ================================================= */

    return res.status(200).json({
      success: true,

      registration_id:
        registration.id,

      program:
        registration.program,

      eligibility_status:
        eligibilityStatus,

      eligibility_reasons:
        eligibilityReasons,

      sheets_sync_status:
        sheetResult.success
          ? "synced"
          : "failed",

      next_step:
        eligibilityStatus === "eligible"
          ? "exam_slot_selection"
          : "thank_you"
    });

  } catch (error) {
    console.error(
      "REGISTRATION ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      error:
        "Qeydiyyat zamanı texniki xəta baş verdi."
    });
  }
}
