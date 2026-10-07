-- Google Sheets (İmtahan-müsahibə) -> ERP: mərhələ məlumatlarının idxalı
-- Supabase SQL Editor-da ADDIM-ADDIM əllə icra olunur. Heç nə avtomatik işə düşmür.
-- CSV: /Users/test/Downloads/DMA_progress_import.csv  (FİN artıq yerli uyğunlaşdırma ilə doldurulub)
--
-- Triggerlərə görə sıra vacibdir:
--  * trg_applications_score_status: exam_score dəyişəndə statusu özü yazır (>=30 INTERVIEW_INVITED, <30 EXAM_FAILED)
--  * trg_applications_interview_attendance_result: interview_attended='NO' olsa nəticə FAILED olur
--  Ona görə əvvəl bal yazılır (ADDIM 4), sonra son status ayrıca əmrlə (ADDIM 5).
--  İki update də yalnız NEW_APPLICATION / INTERVIEW_INVITED / EXAM_FAILED statusunda olan sətirlərə toxunur,
--  yəni idxaldan əvvəl bazada olan və artıq irəli getmiş müraciətlər qorunur.

-- ADDIM 1: staging cədvəli (köhnəsini silir). Sonra Table Editor -> import_dma_progress -> "Import data from CSV".
drop table if exists public.import_dma_progress cascade;
create table public.import_dma_progress (
  fin text, program_slug text, exam_score text, interview_at text,
  interview_attended text, interview_result text, target_status text, note text,
  match_type text, sheet_name text, sheet_phone text, sheet_order text
);

-- ADDIM 2: YOXLAMA (heç nə yazmır).
select count(*) as stage_rows from public.import_dma_progress;                       -- 1610 olmalıdır
select count(*) as fin_not_in_erp from public.import_dma_progress p
where not exists (select 1 from public.dma_candidates c where c.fin = upper(trim(p.fin)));   -- 0 olmalıdır
select count(*) as slug_not_found from public.import_dma_progress p
where not exists (select 1 from public.dma_programs d where d.slug = p.program_slug);        -- 0 olmalıdır
select target_status, count(*) from public.import_dma_progress group by 1 order by 2 desc;

-- ADDIM 3: bu proqram üzrə müraciəti olmayan namizədlərə müraciət yarat (təxminən 67).
insert into public.dma_applications (candidate_id, program_id)
select c.id, d.id
from public.import_dma_progress p
join public.dma_candidates c on c.fin = upper(trim(p.fin))
join public.dma_programs d on d.slug = p.program_slug
where not exists (
  select 1 from public.dma_applications a where a.candidate_id = c.id and a.program_id = d.id
);

-- ADDIM 4: imtahan balları (trigger statusu müvəqqəti özü təyin edir).
update public.dma_applications a
set exam_score = p.exam_score::numeric
from public.import_dma_progress p
join public.dma_candidates c on c.fin = upper(trim(p.fin))
join public.dma_programs d on d.slug = p.program_slug
where a.candidate_id = c.id and a.program_id = d.id
  and p.exam_score <> ''
  and a.exam_score is distinct from p.exam_score::numeric
  and a.current_status in ('NEW_APPLICATION','INTERVIEW_INVITED','EXAM_FAILED');

-- ADDIM 5: son status, müsahibə məlumatları və qeyd.
update public.dma_applications a
set current_status         = p.target_status,
    interview_scheduled_at = case when p.interview_at <> ''
                                  then (p.interview_at::timestamp at time zone 'Asia/Baku') end,
    interview_attended     = nullif(p.interview_attended, ''),
    interview_result       = nullif(p.interview_result, ''),
    interview_note         = nullif(p.note, '')
from public.import_dma_progress p
join public.dma_candidates c on c.fin = upper(trim(p.fin))
join public.dma_programs d on d.slug = p.program_slug
where a.candidate_id = c.id and a.program_id = d.id
  and a.current_status in ('NEW_APPLICATION','INTERVIEW_INVITED','EXAM_FAILED');

-- ADDIM 6: yoxlama
select current_status, count(*) from public.dma_applications group by 1 order by 2 desc;

-- ADDIM 7: təmizlik (yalnız yoxlamadan sonra)
-- drop table public.import_dma_progress;
