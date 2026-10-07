-- İdxal olunan müraciətlərin real tarixini (CSV "timestamp") created_at-a yaz.
-- Supabase SQL Editor-da əllə, ADDIM-ADDIM icra olunur. Mənbə: public.import_dma_stage (silinməməlidir!); xəritə ADDIM 2-nin içindədir.
-- Yalnız bu gün (2026-10-07, Bakı vaxtı) yaranan sətirlərə toxunur, yəni idxaldan əvvəlki müraciətlər qorunur.
-- Vaxt zonası: Google Forms damğası Bakı vaxtı kimi qəbul edilir.
-- Bunu idxal günündə icra edin; sabahdan sonra "bu gün yaranan" süzgəci artıq tutmayacaq.

-- ADDIM 1: önizləmə (heç nə yazmır)
select count(*) as to_fix from public.dma_applications where created_at >= timestamptz '2026-10-07 00:00+04';

-- ADDIM 2: hər (namizəd, proqram) üçün ən erkən real müraciət tarixi
with prog_map(program_name, slug) as (
  values
    ('HR', 'hr'),
    ('Mühasibatlıq', 'accounting'),
    ('Data analitika', 'data'),
    ('Backend Developer', 'backend'),
    ('Frontend Developer', 'frontend'),
    ('Kompüter operatoru', 'computer_operator'),
    ('Ofis proqramları(Kompüter operatoru)', 'computer_operator')
),
first_apply as (
  select upper(trim(s.fin)) as fin, m.slug,
         min((s."timestamp"::timestamp) at time zone 'Asia/Baku') as applied_at
  from public.import_dma_stage s
  join prog_map m on m.program_name = s.program_name
  where s."timestamp" < '2026-10-07'
  group by 1, 2
)
update public.dma_applications a
set created_at = f.applied_at
from first_apply f
join public.dma_candidates c on c.fin = f.fin
join public.dma_programs d on d.slug = f.slug
where a.candidate_id = c.id and a.program_id = d.id
  and a.created_at >= timestamptz '2026-10-07 00:00+04';

-- ADDIM 3: CSV-də həmin proqram üzrə sətri olmayan (ADDIM 3-də yaradılmış) müraciətlər:
-- namizədin ən erkən müraciət tarixi götürülür
update public.dma_applications a
set created_at = m.first_at
from (
  select candidate_id, min(created_at) as first_at
  from public.dma_applications
  where created_at < timestamptz '2026-10-07 00:00+04'
  group by 1
) m
where a.candidate_id = m.candidate_id
  and a.created_at >= timestamptz '2026-10-07 00:00+04';

-- ADDIM 4: namizədin created_at-ı = onun ən erkən müraciəti
update public.dma_candidates c
set created_at = m.first_at
from (select candidate_id, min(created_at) as first_at from public.dma_applications group by 1) m
where c.id = m.candidate_id
  and c.created_at >= timestamptz '2026-10-07 00:00+04'
  and m.first_at < c.created_at;

-- ADDIM 5: status tarixçəsinin ilk qeydi (old_status boş) müraciət tarixi olsun
update public.dma_application_status_history h
set changed_at = a.created_at
from public.dma_applications a
where h.application_id = a.id
  and h.old_status is null
  and h.changed_at >= timestamptz '2026-10-07 00:00+04'
  and a.created_at < timestamptz '2026-10-07 00:00+04';

-- ADDIM 6: yoxlama
select date_trunc('month', created_at) as ay, count(*) from public.dma_applications group by 1 order by 1;
