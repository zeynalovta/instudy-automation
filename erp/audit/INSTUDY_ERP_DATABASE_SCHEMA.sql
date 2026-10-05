-- ============================================================
-- INSTUDY ERP — DATABASE SCHEMA (REFERENCE / DOCUMENTATION ONLY)
-- ============================================================
-- BU FAYL İCRA EDİLMƏMƏLİDİR. Yalnız sənədləşdirmə məqsədi daşıyır.
--
-- Mənbə: bu sənəd instudy repo-suna aid olan yerli
-- `instudy_dma_schema_bundle.sql` (29 ardıcıl LearnUp miqrasiyasının
-- birləşdirilmiş halı, öz növbəsində canlı bazadan information_schema +
-- pg_constraint + pg_trigger ilə çıxarılıb əl ilə tərtib edilib) və
-- admin/*.html + dma/*.html + api/dma/apply.js kodunun bütün Supabase
-- sorğularının çarpaz yoxlanmasıdır. BU SESSIYADA CANLI BAZAYA BİRBAŞA
-- SORĞU GÖNDƏRİLMƏYİB — aşağıdakı struktur VERIFIED (kod+sxem) statusundadır,
-- NOT VERIFIED DEYİL, amma canlı `information_schema` sorğusu ilə ayrıca
-- təsdiqlənməsi tövsiyə olunur (bax audit sənədinin sonu).
--
-- Bu fayl 29 miqrasiyanın TARİXİ ARDICILLIĞINI YOX, YALNIZ SON (bugünkü)
-- vəziyyəti əks etdirir. Silinmiş sütunlar (məs. elimination_note) və
-- "UI-dən çıxarılmış, amma DB-də hələ icazəli" status dəyərləri burada
-- YOXDUR / şərhlə qeyd olunub -- tam tarixi üçün orijinal bundle faylına
-- baxın.
-- ============================================================


-- ---- dma_programs ----
create table public.dma_programs (
  id          bigint generated always as identity primary key,
  name        text not null,
  slug        text not null unique,
  is_active   boolean default true,
  created_at  timestamptz default now(),
  duration    real
);
-- Qeyd: bu cədvələ heç bir admin-panel UI-i INSERT/UPDATE etmir (VERIFIED,
-- kod). Yalnız Supabase Table Editor / SQL ilə idarə olunur.


-- ---- dma_candidates ----
create table public.dma_candidates (
  id                                    bigint generated always as identity primary key,
  full_name                             text not null,
  fin                                   text not null unique,
  birth_date                            date not null,
  email                                 text,
  whatsapp_phone                        text not null,
  education                             text,
  is_student                            boolean,
  is_employed                           boolean,
  has_active_voen                       boolean,
  address                               text,
  attended_dma_course_last_12_months    boolean,
  created_at                            timestamptz default now(),
  updated_at                            timestamptz default now()
);

create index idx_candidates_fin on public.dma_candidates (fin);
create index idx_candidates_full_name on public.dma_candidates (full_name);
create index idx_candidates_phone on public.dma_candidates (whatsapp_phone);

create or replace function public.dma_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_candidates_updated_at
before update on public.dma_candidates
for each row execute function public.dma_set_updated_at();


-- ---- dma_applications (mərkəzi cədvəl) ----
create table public.dma_applications (
  id                        bigint generated always as identity primary key,
  candidate_id              bigint not null references public.dma_candidates(id) on delete cascade,
  program_id                bigint not null references public.dma_programs(id),
  eligibility_status        text default 'NEW'
    check (eligibility_status in ('NEW','PRELIMINARILY_ELIGIBLE','MANUAL_REVIEW_REQUIRED','NOT_ELIGIBLE')),
  eligibility_reason        text,                         -- trigger tərəfindən yazılır
  unemployment_status       text default 'NOT_CHECKED'
    check (unemployment_status in ('NOT_CHECKED','PENDING','CONFIRMED','NOT_CONFIRMED')),
    -- ^ Heç bir admin UI bu sütuna yazmır (VERIFIED, kod) -- həmişə defolt qalır.
  current_status            text default 'NEW_APPLICATION'
    check (current_status in (
      'NEW_APPLICATION','ELIGIBLE','MANUAL_REVIEW_REQUIRED','NOT_ELIGIBLE',
      'EXAM_INVITED','EXAM_BOOKED','ATTENDANCE_CONFIRMED','EXAM_ATTENDED','EXAM_NO_SHOW','EXAM_FAILED','EXAM_PASSED',
      'INTERVIEW_INVITED','INTERVIEW_BOOKED','INTERVIEW_ATTENDED','INTERVIEW_NO_SHOW','INTERVIEW_FAILED','RESERVE_LIST','INTERVIEW_PASSED',
      'DOCUMENT_CHECK','SUBMITTED_TO_DMA','ADDITIONAL_DOCUMENTS_REQUIRED','DMA_REJECTED','DMA_APPROVED',
      'ENROLLED','TRAINING_STARTED','EXPELLED','GRADUATED','DECLINED'
    )),
    -- ^ EXAM_INVITED, ATTENDANCE_CONFIRMED, DOCUMENT_CHECK, SUBMITTED_TO_DMA,
    --   ADDITIONAL_DOCUMENTS_REQUIRED, DMA_REJECTED, DMA_APPROVED,
    --   TRAINING_STARTED -- DB-də icazəlidir, amma admin UI dropdown-larında
    --   artıq təklif OLUNMUR (sxem şərhi, VERIFIED).
  general_note              text,
  created_at                timestamptz default now(),
  updated_at                timestamptz default now(),
  exam_score                numeric,
  interview_note            text,
  employment_status         text
    check (employment_status is null or employment_status in ('SEEKING', 'EMPLOYED', 'NOT_SEEKING')),
  employment_note           text,
  employed_at               date,
  exam_scheduled_at         timestamptz,
  interview_scheduled_at    timestamptz,
  interview_attended        text
    check (interview_attended is null or interview_attended in ('YES', 'NO')),
  interview_result          text
    check (interview_result is null or interview_result in ('PASSED', 'FAILED', 'RESERVE')),
  dma_status                text
    check (dma_status is null or dma_status in ('SUBMITTED', 'APPROVED', 'REJECTED')),
  training_group_id         bigint references public.dma_training_groups(id)
    -- ^ ON DELETE CASCADE/SET NULL QƏSDƏN YOXDUR: üzvü olan qrupu silmək
    --   cəhdi FK violation ilə uğursuz olmalıdır (sxem şərhi).
);

create index idx_applications_candidate on public.dma_applications (candidate_id);
create index idx_applications_current_status on public.dma_applications (current_status);
create index idx_applications_eligibility on public.dma_applications (eligibility_status);
create index idx_applications_program on public.dma_applications (program_id);

create trigger set_applications_updated_at
before update on public.dma_applications
for each row execute function public.dma_set_updated_at();

-- Eligibility / status trigger-lərin son (bugünkü) versiyası:
create or replace function public.compute_eligibility(
  p_has_active_voen boolean, p_attended_dma_course_last_12_months boolean,
  p_is_student boolean, p_is_employed boolean, p_birth_date date
) returns text language sql stable set search_path = '' as $$
  select case
    when p_has_active_voen is true then 'NOT_ELIGIBLE'
    when p_attended_dma_course_last_12_months is true then 'NOT_ELIGIBLE'
    when p_is_student is true then 'NOT_ELIGIBLE'
    when p_is_employed is true then 'NOT_ELIGIBLE'
    when p_birth_date is null then 'MANUAL_REVIEW_REQUIRED'
    when date_part('year', age(current_date, p_birth_date)) > 35 then 'NOT_ELIGIBLE'
    when date_part('year', age(current_date, p_birth_date)) < 18 then 'NOT_ELIGIBLE'
    else 'PRELIMINARILY_ELIGIBLE'
  end;
$$;

-- BEFORE INSERT: eligibility_status + ilkin current_status hesablanır.
-- "*operatoru*" proqramı imtahanı atlayıb birbaşa INTERVIEW_INVITED-ə gedir.
create or replace function public.applications_set_eligibility()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_candidate record; v_status text; v_age integer; v_program_name text;
begin
  select has_active_voen, attended_dma_course_last_12_months, is_student, is_employed, birth_date
  into v_candidate from public.dma_candidates where id = new.candidate_id;

  v_status := public.compute_eligibility(
    v_candidate.has_active_voen, v_candidate.attended_dma_course_last_12_months,
    v_candidate.is_student, v_candidate.is_employed, v_candidate.birth_date
  );
  new.eligibility_status := v_status;

  select name into v_program_name from public.dma_programs where id = new.program_id;

  new.current_status := case
    when v_status <> 'PRELIMINARILY_ELIGIBLE' then 'MANUAL_REVIEW_REQUIRED'
    when v_program_name ilike '%operatoru%' then 'INTERVIEW_INVITED'
    else 'ELIGIBLE'
  end;

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
$$;

create trigger trg_applications_set_eligibility
before insert on public.dma_applications
for each row execute function public.applications_set_eligibility();

-- BEFORE UPDATE: exam_score dəyişəndə statusu avtomatik yönləndirir.
create or replace function public.applications_score_status()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.exam_score is not distinct from old.exam_score then return new; end if;
  if new.exam_score is null then return new; end if;
  new.current_status := case when new.exam_score >= 30 then 'INTERVIEW_INVITED' else 'EXAM_FAILED' end;
  return new;
end;
$$;

create trigger trg_applications_score_status
before update on public.dma_applications
for each row execute function public.applications_score_status();

-- BEFORE INSERT OR UPDATE: müsahibəyə gəlməyən avtomatik FAILED olur.
create or replace function public.applications_interview_attendance_result()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.interview_attended = 'NO' then
    new.interview_result := 'FAILED';
  end if;
  return new;
end;
$$;

create trigger trg_applications_interview_attendance_result
before insert or update on public.dma_applications
for each row execute function public.applications_interview_attendance_result();


-- ---- dma_application_status_history (append-only audit trail) ----
create table public.dma_application_status_history (
  id              bigint generated always as identity primary key,
  application_id  bigint not null references public.dma_applications(id) on delete cascade,
  old_status      text,
  new_status      text not null,
  note            text,   -- heç bir kod yolu bunu doldurmur (VERIFIED) -- həmişə NULL
  changed_at      timestamptz not null default now()
);

alter table public.dma_application_status_history enable row level security;

create or replace function public.log_initial_application_status()
returns trigger language plpgsql as $$
begin
  insert into public.dma_application_status_history (application_id, old_status, new_status)
  values (new.id, null, new.current_status);
  return new;
end;
$$;

create trigger initial_application_status_trigger
after insert on public.dma_applications
for each row execute function public.log_initial_application_status();

create or replace function public.log_application_status_change()
returns trigger language plpgsql as $$
begin
  if old.current_status is distinct from new.current_status then
    insert into public.dma_application_status_history (application_id, old_status, new_status)
    values (new.id, old.current_status, new.current_status);
  end if;
  return new;
end;
$$;

create trigger application_status_change_trigger
after update of current_status on public.dma_applications
for each row execute function public.log_application_status_change();


-- ---- dma_exam_sessions / dma_exam_bookings ----
create table public.dma_exam_sessions (
  id          bigint generated always as identity primary key,
  program_id  bigint not null references public.dma_programs(id),
  starts_at   timestamptz not null,
  capacity    integer not null check (capacity > 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
  -- Qeyd: bu cədvəldə updated_at-i avtomatik yeniləyən trigger YOXDUR
  -- (dma_candidates/dma_applications-dan fərqli). Sətir yaradılandan sonra
  -- bu sütun heç vaxt dəyişmir (VERIFIED, sxem + kod).
);

create table public.dma_exam_bookings (
  id               bigint generated always as identity primary key,
  application_id   bigint not null references public.dma_applications(id),
  exam_session_id  bigint not null references public.dma_exam_sessions(id),
  status           text not null default 'BOOKED',
    -- ^ DB-də CHECK constraint YOXDUR (BOOKED/CANCELLED yalnız RPC məntiqi
    --   ilə təmin olunur, VERIFIED).
  created_at       timestamptz not null default now()
);

alter table public.dma_exam_sessions enable row level security;
alter table public.dma_exam_bookings enable row level security;

-- Tutum-təhlükəsiz, atomik (FOR UPDATE sətir kilidi) rezervasiya:
create or replace function public.book_exam_session(p_application_id bigint, p_exam_session_id bigint)
returns table(booking_id bigint, new_status text)
language plpgsql security definer set search_path = '' as $$
declare
  v_session_program_id bigint; v_capacity integer; v_starts_at timestamptz;
  v_application_program_id bigint; v_application_status text;
  v_booked_count integer; v_new_booking_id bigint;
begin
  select program_id, capacity, starts_at into v_session_program_id, v_capacity, v_starts_at
  from public.dma_exam_sessions where id = p_exam_session_id for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;

  select program_id, current_status into v_application_program_id, v_application_status
  from public.dma_applications where id = p_application_id;
  if not found then raise exception 'APPLICATION_NOT_FOUND'; end if;

  if v_application_program_id is distinct from v_session_program_id then
    raise exception 'PROGRAM_MISMATCH';
  end if;
  if v_application_status not in ('ELIGIBLE', 'EXAM_BOOKED') then
    raise exception 'NOT_BOOKABLE';
  end if;

  select count(*) into v_booked_count from public.dma_exam_bookings
  where exam_session_id = p_exam_session_id and status = 'BOOKED';
  if v_booked_count >= v_capacity then raise exception 'SESSION_FULL'; end if;

  update public.dma_exam_bookings set status = 'CANCELLED'
  where application_id = p_application_id and status = 'BOOKED';

  insert into public.dma_exam_bookings (application_id, exam_session_id, status)
  values (p_application_id, p_exam_session_id, 'BOOKED')
  returning id into v_new_booking_id;

  update public.dma_applications
  set current_status = 'EXAM_BOOKED', exam_scheduled_at = v_starts_at
  where id = p_application_id;

  return query select v_new_booking_id, 'EXAM_BOOKED'::text;
end;
$$;

create or replace function public.list_available_exam_sessions(p_program_id bigint)
returns table(id bigint, starts_at timestamptz, available_seats integer)
language sql stable security definer set search_path = '' as $$
  select es.id, es.starts_at,
    (es.capacity - coalesce(count(eb.id) filter (where eb.status = 'BOOKED'), 0))::integer
  from public.dma_exam_sessions es
  left join public.dma_exam_bookings eb on eb.exam_session_id = es.id
  where es.program_id = p_program_id and es.starts_at > now()
  group by es.id, es.starts_at, es.capacity
  having es.capacity - coalesce(count(eb.id) filter (where eb.status = 'BOOKED'), 0) > 0
  order by es.starts_at asc;
$$;

create or replace function public.get_application_for_booking(p_application_id bigint)
returns table(application_id bigint, program_id bigint, program_name text, current_status text)
language sql stable security definer set search_path = '' as $$
  select a.id, a.program_id, p.name, a.current_status
  from public.dma_applications a join public.dma_programs p on p.id = a.program_id
  where a.id = p_application_id;
$$;

revoke all on function public.book_exam_session(bigint, bigint) from public;
grant execute on function public.book_exam_session(bigint, bigint) to anon, authenticated;
revoke all on function public.list_available_exam_sessions(bigint) from public;
grant execute on function public.list_available_exam_sessions(bigint) to anon, authenticated;
revoke all on function public.get_application_for_booking(bigint) from public;
grant execute on function public.get_application_for_booking(bigint) to anon, authenticated;


-- ---- dma_interview_sessions / dma_interview_bookings (exam ilə simmetrikdir) ----
create table public.dma_interview_sessions (
  id          bigint generated always as identity primary key,
  program_id  bigint not null references public.dma_programs(id),
  starts_at   timestamptz not null,
  capacity    integer not null check (capacity > 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint dma_interview_sessions_program_starts_at_key unique (program_id, starts_at)
  -- updated_at üçün trigger yoxdur (eyni tapıntı dma_exam_sessions-da olduğu kimi)
);

create table public.dma_interview_bookings (
  id                     bigint generated always as identity primary key,
  application_id         bigint not null references public.dma_applications(id),
  interview_session_id   bigint not null references public.dma_interview_sessions(id),
  status                 text not null default 'BOOKED',   -- DB CHECK yoxdur
  created_at             timestamptz not null default now()
);

alter table public.dma_interview_sessions enable row level security;
alter table public.dma_interview_bookings enable row level security;

create or replace function public.book_interview_session(p_application_id bigint, p_interview_session_id bigint)
returns table(booking_id bigint, new_status text)
language plpgsql security definer set search_path = '' as $$
declare
  v_session_program_id bigint; v_capacity integer; v_starts_at timestamptz;
  v_application_program_id bigint; v_application_status text;
  v_booked_count integer; v_new_booking_id bigint;
begin
  select program_id, capacity, starts_at into v_session_program_id, v_capacity, v_starts_at
  from public.dma_interview_sessions where id = p_interview_session_id for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;

  select program_id, current_status into v_application_program_id, v_application_status
  from public.dma_applications where id = p_application_id;
  if not found then raise exception 'APPLICATION_NOT_FOUND'; end if;

  if v_application_program_id is distinct from v_session_program_id then
    raise exception 'PROGRAM_MISMATCH';
  end if;
  if v_application_status not in ('INTERVIEW_INVITED', 'INTERVIEW_BOOKED') then
    raise exception 'NOT_BOOKABLE';
  end if;

  select count(*) into v_booked_count from public.dma_interview_bookings
  where interview_session_id = p_interview_session_id and status = 'BOOKED';
  if v_booked_count >= v_capacity then raise exception 'SESSION_FULL'; end if;

  update public.dma_interview_bookings set status = 'CANCELLED'
  where application_id = p_application_id and status = 'BOOKED';

  insert into public.dma_interview_bookings (application_id, interview_session_id, status)
  values (p_application_id, p_interview_session_id, 'BOOKED')
  returning id into v_new_booking_id;

  update public.dma_applications
  set current_status = 'INTERVIEW_BOOKED', interview_scheduled_at = v_starts_at
  where id = p_application_id;

  return query select v_new_booking_id, 'INTERVIEW_BOOKED'::text;
end;
$$;

create or replace function public.list_available_interview_sessions(p_program_id bigint)
returns table(id bigint, starts_at timestamptz, available_seats integer)
language sql stable security definer set search_path = '' as $$
  select ivs.id, ivs.starts_at,
    (ivs.capacity - coalesce(count(ivb.id) filter (where ivb.status = 'BOOKED'), 0))::integer
  from public.dma_interview_sessions ivs
  left join public.dma_interview_bookings ivb on ivb.interview_session_id = ivs.id
  where ivs.program_id = p_program_id and ivs.starts_at > now()
  group by ivs.id, ivs.starts_at, ivs.capacity
  having ivs.capacity - coalesce(count(ivb.id) filter (where ivb.status = 'BOOKED'), 0) > 0
  order by ivs.starts_at asc;
$$;

create or replace function public.get_application_for_interview_booking(p_application_id bigint)
returns table(application_id bigint, program_id bigint, program_name text, current_status text)
language sql stable security definer set search_path = '' as $$
  select a.id, a.program_id, p.name, a.current_status
  from public.dma_applications a join public.dma_programs p on p.id = a.program_id
  where a.id = p_application_id;
$$;

revoke all on function public.book_interview_session(bigint, bigint) from public;
grant execute on function public.book_interview_session(bigint, bigint) to anon, authenticated;
revoke all on function public.list_available_interview_sessions(bigint) from public;
grant execute on function public.list_available_interview_sessions(bigint) to anon, authenticated;
revoke all on function public.get_application_for_interview_booking(bigint) from public;
grant execute on function public.get_application_for_interview_booking(bigint) to anon, authenticated;


-- ---- dma_training_groups ----
create table public.dma_training_groups (
  id          bigint generated always as identity primary key,
  program_id  bigint not null references public.dma_programs(id),
  name        text not null,
  starts_at   date not null,
  ends_at     date,
  created_at  timestamptz not null default now()
);

alter table public.dma_training_groups enable row level security;


-- ---- dma_attendance_records ----
create table public.dma_attendance_records (
  id                  bigint generated always as identity primary key,
  training_group_id   bigint not null references public.dma_training_groups(id),
  application_id      bigint not null references public.dma_applications(id),
  session_date        date not null,
  attended            boolean not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),  -- trigger yoxdur (bax dma_exam_sessions)
  unique (training_group_id, application_id, session_date)
);

alter table public.dma_attendance_records enable row level security;


-- ============================================================
-- ACCESS CONTROL (RLS) -- xülasə
-- ============================================================
-- Hər 10 cədvəldə RLS aktivdir. anon roluna heç bir cədvələ birbaşa
-- giriş yoxdur (yalnız yuxarıdakı 6 SECURITY DEFINER RPC ictimai).
-- authenticated rolu üçün bütün policy-lər aşağıdakı iki funksiyaya əsaslanır:

create or replace function public.is_admin()
returns boolean language sql stable set search_path = '' as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false);
$$;

-- Fail-closed versiya (son, 20260818 miqrasiyası):
create or replace function public.staff_scope()
returns text language sql stable set search_path = '' as $$
  select case
    when (auth.jwt() -> 'app_metadata' ->> 'staff_scope') in ('dma', 'all')
    then auth.jwt() -> 'app_metadata' ->> 'staff_scope'
    else 'no_access'
  end;
$$;

create or replace function public.has_scope(required_scope text)
returns boolean language sql stable set search_path = '' as $$
  select (select public.is_admin())
    and (public.staff_scope() = required_scope or public.staff_scope() = 'all');
$$;

-- Nümunə policy (bütün 10 cədvəldə eyni naxış təkrarlanır --
-- select/update/all -> using ((select public.has_scope('dma'))) ):
--
-- create policy "admins_can_read_applications" on public.dma_applications
--   for select to authenticated using ((select public.has_scope('dma')));
