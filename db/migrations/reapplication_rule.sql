begin;

create or replace function public.applications_enforce_reapplication_rule()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_latest_exam timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext(new.candidate_id::text || ':' || new.program_id::text));

  if exists (
    select 1 from public.dma_applications a
    where a.candidate_id = new.candidate_id
      and a.program_id = new.program_id
      and a.current_status not in (
        'NOT_ELIGIBLE', 'EXAM_FAILED', 'EXAM_NO_SHOW', 'INTERVIEW_FAILED',
        'INTERVIEW_NO_SHOW', 'DMA_REJECTED', 'EXPELLED', 'GRADUATED', 'DECLINED'
      )
  ) then
    raise exception 'REAPPLY_BLOCKED: active application exists for this program';
  end if;

  select max(a.exam_scheduled_at) into v_latest_exam
  from public.dma_applications a
  where a.candidate_id = new.candidate_id
    and a.program_id = new.program_id;

  if v_latest_exam is not null and v_latest_exam + interval '90 days' > now() then
    raise exception 'REAPPLY_BLOCKED: cooldown active until %', v_latest_exam + interval '90 days';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_applications_enforce_reapplication_rule on public.dma_applications;

create trigger trg_applications_enforce_reapplication_rule
before insert on public.dma_applications
for each row execute function public.applications_enforce_reapplication_rule();

commit;

-- Rollback:
-- drop trigger if exists trg_applications_enforce_reapplication_rule on public.dma_applications;
-- drop function if exists public.applications_enforce_reapplication_rule();
