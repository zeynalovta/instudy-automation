begin;

create or replace function public.applications_set_eligibility()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_candidate record;
  v_status text;
  v_age integer;
begin
  select has_active_voen, attended_dma_course_last_12_months, is_student, is_employed, birth_date
  into v_candidate
  from public.dma_candidates
  where id = new.candidate_id;

  v_status := public.compute_eligibility(
    v_candidate.has_active_voen,
    v_candidate.attended_dma_course_last_12_months,
    v_candidate.is_student,
    v_candidate.is_employed,
    v_candidate.birth_date
  );

  new.eligibility_status := v_status;
  new.current_status := 'NEW_APPLICATION';

  if v_candidate.birth_date is not null then
    v_age := date_part('year', age(current_date, v_candidate.birth_date));
  end if;

  if v_age is not null and (v_age > 35 or v_age < 18) then
    new.eligibility_reason := 'Namizədin yaşı uyğunluq aralığında (18-35) deyil.';
  elsif v_candidate.birth_date is null then
    new.eligibility_reason := 'Doğum tarixi qeyd olunmayıb, yaş manual yoxlanmalıdır.';
  elsif v_candidate.is_student is true then
    new.eligibility_reason := 'Namizəd hazırda tələbədir.';
  elsif v_candidate.has_active_voen is true then
    new.eligibility_reason := 'Namizədin adına aktiv VÖEN var.';
  elsif v_candidate.is_employed is true then
    new.eligibility_reason := 'Məşğulluq statusu manual yoxlanmalıdır.';
  elsif v_candidate.attended_dma_course_last_12_months is true then
    new.eligibility_reason := 'Son 12 ayda DMA xətti ilə kurs iştirakı manual yoxlanmalıdır.';
  else
    new.eligibility_reason := 'İlkin uyğunluq kriteriyalarına uyğundur.';
  end if;

  return new;
end;
$function$;

commit;

-- Rollback (original definition, restores status logic):
-- begin;
-- create or replace function public.applications_set_eligibility()
-- returns trigger language plpgsql set search_path = '' as $function$
-- declare v_candidate record; v_status text; v_age integer; v_program_name text;
-- begin
--   select has_active_voen, attended_dma_course_last_12_months, is_student, is_employed, birth_date
--   into v_candidate from public.dma_candidates where id = new.candidate_id;
--   v_status := public.compute_eligibility(v_candidate.has_active_voen, v_candidate.attended_dma_course_last_12_months, v_candidate.is_student, v_candidate.is_employed, v_candidate.birth_date);
--   new.eligibility_status := v_status;
--   select name into v_program_name from public.dma_programs where id = new.program_id;
--   new.current_status := case
--     when v_status <> 'PRELIMINARILY_ELIGIBLE' then 'MANUAL_REVIEW_REQUIRED'
--     when v_program_name ilike '%operatoru%' then 'INTERVIEW_INVITED'
--     else 'ELIGIBLE' end;
--   if v_candidate.birth_date is not null then v_age := date_part('year', age(current_date, v_candidate.birth_date)); end if;
--   if v_age is not null and (v_age > 35 or v_age < 18) then new.eligibility_reason := 'Namizədin yaşı uyğunluq aralığında (18-35) deyil.';
--   elsif v_candidate.birth_date is null then new.eligibility_reason := 'Doğum tarixi qeyd olunmayıb, yaş manual yoxlanmalıdır.';
--   elsif v_candidate.is_student is true then new.eligibility_reason := 'Namizəd hazırda tələbədir.';
--   elsif v_candidate.has_active_voen is true then new.eligibility_reason := 'Namizədin adına aktiv VÖEN var.';
--   elsif v_candidate.is_employed is true then new.eligibility_reason := 'Məşğulluq statusu manual yoxlanmalıdır.';
--   elsif v_candidate.attended_dma_course_last_12_months is true then new.eligibility_reason := 'Son 12 ayda DMA xətti ilə kurs iştirakı manual yoxlanmalıdır.';
--   else new.eligibility_reason := 'İlkin uyğunluq kriteriyalarına uyğundur.';
--   end if;
--   return new;
-- end;
-- $function$;
-- commit;
