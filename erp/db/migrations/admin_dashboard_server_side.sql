-- Admin panel (erp/admin/index.html) sürəti: səhifələmə və statistikanı bazada hesabla.
-- Supabase SQL Editor-da əllə icra olunur (2 əmr, hər biri ayrıca).
-- Hər ikisi SECURITY INVOKER-dir: mövcud RLS policy-ləri olduğu kimi tətbiq olunur.

-- 1) Siyahı view-su: müraciət + namizəd + proqram bir sətirdə (axtarış/sıralama/səhifələmə üçün)
create or replace view public.dma_application_list
with (security_invoker = true) as
select
  a.id, a.candidate_id, a.program_id,
  a.eligibility_status, a.current_status, a.exam_score,
  a.exam_scheduled_at, a.interview_scheduled_at,
  a.interview_attended, a.interview_result, a.dma_status,
  a.general_note, a.training_group_id, a.created_at,
  c.full_name, c.fin, c.whatsapp_phone, c.email,
  p.name as program_name
from public.dma_applications a
join public.dma_candidates c on c.id = a.candidate_id
join public.dma_programs   p on p.id = a.program_id;

revoke all on public.dma_application_list from anon;
grant select on public.dma_application_list to authenticated;

-- 2) Dashboard statistikası (stageBucket məntiqinin SQL ekvivalenti, Bakı vaxtı ilə bu gün/dünən)
create or replace function public.dma_dashboard_stats()
returns table (program_name text, training bigint, in_process bigint, today bigint, yesterday bigint)
language sql stable security invoker set search_path = ''
as $$
  select
    p.name,
    count(*) filter (where s.bucket = 'ENROLLED'),
    count(*) filter (where s.bucket = ''),
    count(*) filter (where (s.created_at at time zone 'Asia/Baku')::date = (now() at time zone 'Asia/Baku')::date),
    count(*) filter (where (s.created_at at time zone 'Asia/Baku')::date = (now() at time zone 'Asia/Baku')::date - 1)
  from (
    select a.program_id, a.created_at,
      case
        when a.current_status in ('ENROLLED','GRADUATED') then 'ENROLLED'
        when a.current_status in ('DECLINED','NOT_ELIGIBLE','EXPELLED') then 'DECLINED'
        when a.current_status = 'EXAM_FAILED' then 'EXAM_FAILED'
        when a.current_status = 'INTERVIEW_FAILED' then 'INTERVIEW_FAILED'
        when a.dma_status = 'REJECTED' then 'DECLINED'
        when a.interview_result = 'FAILED' then 'INTERVIEW_FAILED'
        when a.exam_score is not null and a.exam_score < 30 then 'EXAM_FAILED'
        else ''
      end as bucket
    from public.dma_applications a
  ) s
  join public.dma_programs p on p.id = s.program_id
  group by p.name;
$$;

grant execute on function public.dma_dashboard_stats() to authenticated;
revoke execute on function public.dma_dashboard_stats() from anon;
