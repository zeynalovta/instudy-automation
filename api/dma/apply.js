// DMA panelinin (candidates/applications sxemi) müraciət forması üçün server
// tərəfi. dma/apply/index.html-in LearnUp-dakı "smooth-task" Supabase Edge
// Function-una göndərdiyi GET (aktiv proqramlar) və POST (müraciət) sorğularının
// yerini tutur -- həmin funksiyanın kodu bizdə yox idi, ona görə bu sıfırdan
// yazılıb (instudy-nin öz Vercel /api konvensiyasına uyğun, lib/supabase.js-in
// service-role client-i ilə, RLS-i keçərək).
//
// Dizayn qərarı (orijinal kod görünmədiyi üçün): eyni FIN ikinci dəfə
// müraciət etsə, candidates sətri YENİDƏN yaradılmır -- mövcud namizəd
// istifadə olunur (candidates.fin unikaldır). Amma eyni namizəd eyni
// proqrama artıq müraciət edibsə, ikinci dəfə application yaradılmır, xəta
// qaytarılır. Fərqli proqrama müraciət isə sərbəstdir (yeni application).
import { supabase } from "../../lib/supabase.js";

function cleanText(value) {
  return String(value ?? "").trim();
}

function parseBoolean(value) {
  if (value === true) return true;
  if (value === false) return false;
  return null;
}

function isValidFin(fin) {
  return /^[A-Z0-9]{7}$/.test(fin);
}

function isValidDate(value) {
  if (!value) return false;
  const d = new Date(value);
  return !Number.isNaN(d.getTime());
}

async function handleGet(req, res) {
  const { data, error } = await supabase
    .from("dma_programs")
    .select("id, name, slug, duration")
    .eq("is_active", true)
    .order("name");

  if (error) {
    console.error("DMA_APPLY_LIST_PROGRAMS_ERROR:", error.message);
    return res.status(500).json({
      success: false,
      message: "Təlim proqramları yüklənə bilmədi."
    });
  }

  return res.status(200).json({ success: true, programs: data || [] });
}

async function handlePost(req, res) {
  const body = req.body || {};

  const full_name = cleanText(body.full_name);
  const fin = cleanText(body.fin).toUpperCase();
  const birth_date = cleanText(body.birth_date);
  const email = cleanText(body.email) || null;
  const whatsapp_phone = cleanText(body.whatsapp_phone);
  const address = cleanText(body.address) || null;
  const education = cleanText(body.education) || null;
  const is_student = parseBoolean(body.is_student);
  const is_employed = parseBoolean(body.is_employed);
  const has_active_voen = parseBoolean(body.has_active_voen);
  const attended_dma_course_last_12_months = parseBoolean(
    body.attended_dma_course_last_12_months
  );
  const program_slug = cleanText(body.program_slug);

  if (full_name.length < 3) {
    return res.status(400).json({ success: false, message: "Ad və soyad düzgün daxil edilməyib." });
  }
  if (!isValidFin(fin)) {
    return res.status(400).json({ success: false, message: "FİN 7 simvoldan ibarət olmalıdır." });
  }
  if (!isValidDate(birth_date)) {
    return res.status(400).json({ success: false, message: "Doğum tarixi düzgün deyil." });
  }
  if (whatsapp_phone.length < 9) {
    return res.status(400).json({ success: false, message: "Telefon nömrəsi düzgün daxil edilməyib." });
  }
  if (!program_slug) {
    return res.status(400).json({ success: false, message: "Zəhmət olmasa, təlim proqramını seçin." });
  }

  const { data: program, error: programError } = await supabase
    .from("dma_programs")
    .select("id")
    .eq("slug", program_slug)
    .eq("is_active", true)
    .maybeSingle();

  if (programError) {
    console.error("DMA_APPLY_PROGRAM_LOOKUP_ERROR:", programError.message);
    return res.status(500).json({ success: false, message: "Texniki xəta baş verdi." });
  }
  if (!program) {
    return res.status(400).json({ success: false, message: "Seçilmiş təlim proqramı tapılmadı." });
  }

  // Eyni FIN-lə əvvəlki müraciət varsa, həmin namizəd sətri təkrar istifadə
  // olunur (candidates.fin unikaldır, yenidən insert 23505 verərdi).
  let candidateId;
  const { data: existingCandidate, error: findError } = await supabase
    .from("dma_candidates")
    .select("id")
    .eq("fin", fin)
    .maybeSingle();

  if (findError) {
    console.error("DMA_APPLY_FIND_CANDIDATE_ERROR:", findError.message);
    return res.status(500).json({ success: false, message: "Texniki xəta baş verdi." });
  }

  if (existingCandidate) {
    candidateId = existingCandidate.id;

    const { data: dup, error: dupError } = await supabase
      .from("dma_applications")
      .select("id")
      .eq("candidate_id", candidateId)
      .eq("program_id", program.id)
      .maybeSingle();

    if (dupError) {
      console.error("DMA_APPLY_DUP_CHECK_ERROR:", dupError.message);
      return res.status(500).json({ success: false, message: "Texniki xəta baş verdi." });
    }
    if (dup) {
      return res.status(409).json({
        success: false,
        message: "Bu FİN ilə seçdiyiniz proqrama artıq müraciət edilib."
      });
    }

    const { error: updateError } = await supabase
      .from("dma_candidates")
      .update({
        full_name, birth_date, email, whatsapp_phone, address, education,
        is_student, is_employed, has_active_voen, attended_dma_course_last_12_months
      })
      .eq("id", candidateId);

    if (updateError) {
      console.error("DMA_APPLY_UPDATE_CANDIDATE_ERROR:", updateError.message);
      return res.status(500).json({ success: false, message: "Texniki xəta baş verdi." });
    }
  } else {
    const { data: newCandidate, error: insertError } = await supabase
      .from("dma_candidates")
      .insert({
        full_name, fin, birth_date, email, whatsapp_phone, address, education,
        is_student, is_employed, has_active_voen, attended_dma_course_last_12_months
      })
      .select("id")
      .single();

    if (insertError) {
      console.error("DMA_APPLY_INSERT_CANDIDATE_ERROR:", insertError.message);
      return res.status(500).json({ success: false, message: "Texniki xəta baş verdi." });
    }
    candidateId = newCandidate.id;
  }

  // current_status/eligibility_status trigger tərəfindən (applications_set_eligibility)
  // avtomatik hesablanır -- burada yalnız candidate_id/program_id verilir.
  const { data: application, error: applicationError } = await supabase
    .from("dma_applications")
    .insert({ candidate_id: candidateId, program_id: program.id })
    .select("id, current_status")
    .single();

  if (applicationError) {
    console.error("DMA_APPLY_INSERT_APPLICATION_ERROR:", applicationError.message);
    return res.status(500).json({ success: false, message: "Müraciət göndərilərkən xəta baş verdi." });
  }

  return res.status(200).json({
    success: true,
    application_id: application.id,
    current_status: application.current_status
  });
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") return await handleGet(req, res);
    if (req.method === "POST") return await handlePost(req, res);
    return res.status(405).json({ success: false, message: "Method not allowed" });
  } catch (error) {
    console.error("DMA_APPLY_UNEXPECTED_ERROR:", error);
    return res.status(500).json({ success: false, message: "Gözlənilməz xəta baş verdi." });
  }
}
