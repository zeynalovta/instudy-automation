import { supabase } from "../lib/supabase.js";

const ALLOWED_PROGRAMS = [
  "data",
  "frontend",
  "backend",
  "hr",
  "computer_operator",
  "accounting"
];

function cleanText(value) {
  return String(value || "").trim();
}

function normalizePhone(phone) {
  return cleanText(phone)
    .replace(/\s+/g, "")
    .replace(/-/g, "");
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
      phone,
      program,
      instagram_user_id,
      instagram_username
    } = req.body || {};

    const cleanName = cleanText(full_name);
    const cleanPhone = normalizePhone(phone);
    const cleanProgram = cleanText(program);

    if (cleanName.length < 3) {
      return res.status(400).json({
        success: false,
        error: "Ad və soyad düzgün daxil edilməyib."
      });
    }

    if (cleanPhone.length < 9) {
      return res.status(400).json({
        success: false,
        error: "Telefon nömrəsi düzgün daxil edilməyib."
      });
    }

    if (!ALLOWED_PROGRAMS.includes(cleanProgram)) {
      return res.status(400).json({
        success: false,
        error: "Təlim istiqaməti düzgün seçilməyib."
      });
    }

    let instagramContactId = null;

    if (instagram_user_id) {
      const { data: contact, error: contactError } = await supabase
        .from("instagram_contacts")
        .select("id")
        .eq("instagram_user_id", instagram_user_id)
        .maybeSingle();

      if (contactError) {
        throw contactError;
      }

      instagramContactId = contact?.id || null;
    }

    const { data: registration, error } = await supabase
      .from("registrations")
      .insert({
        instagram_contact_id: instagramContactId,
        instagram_user_id: instagram_user_id || null,
        instagram_username: instagram_username || null,

        full_name: cleanName,
        phone: cleanPhone,
        program: cleanProgram,

        registration_status: "registered",
        sheets_sync_status: "pending"
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    return res.status(200).json({
      success: true,
      registration_id: registration.id,
      program: registration.program,
      next_step: "exam_slot_selection"
    });

  } catch (error) {
    console.error("REGISTRATION ERROR:", error);

    return res.status(500).json({
      success: false,
      error: "Qeydiyyat zamanı texniki xəta baş verdi."
    });
  }
}
