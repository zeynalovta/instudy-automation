-- Qrup davamiyyəti dərs səviyyəsində: hər (qrup, gün) üçün gözlənilən/gələn say və müəllim iştirakı.
-- Supabase SQL Editor-də bir dəfə işlədin. instructor_pay_view.sql-dən sonra.
-- Köhnə tələbə-səviyyəli dma_attendance_records toxunulmaz qalır (tarixçə), view onu yalnız session yazısı olmayan günlər üçün istifadə edir.

create table if not exists public.dma_group_sessions (
  id                bigint generated always as identity primary key,
  training_group_id bigint not null references public.dma_training_groups(id) on delete cascade,
  session_date      date not null,
  expected_count    int  not null check (expected_count >= 0),  -- dərs başlayanda qrup siyahısı (ilk yadda saxlamada dondurulur)
  present_count     int  not null check (present_count >= 0),
  teacher_status    text not null check (teacher_status in ('yes', 'no', 'replacement')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (training_group_id, session_date),
  check (present_count <= expected_count)
);
alter table public.dma_group_sessions enable row level security;

drop policy if exists "dma_staff_all_group_sessions" on public.dma_group_sessions;
create policy "dma_staff_all_group_sessions" on public.dma_group_sessions
  for all to authenticated
  using ((select public.has_scope('dma'))) with check ((select public.has_scope('dma')));
grant select, insert, update, delete on public.dma_group_sessions to authenticated;

-- Əvəzləyən müəllim: "replacement" olduqda maaş ona hesablanır.
alter table public.dma_group_sessions
  add column if not exists replacement_instructor_id bigint references public.dma_instructors(id) on delete set null;
alter table public.dma_group_sessions drop constraint if exists dma_group_sessions_replacement_check;
alter table public.dma_group_sessions add constraint dma_group_sessions_replacement_check
  check (teacher_status <> 'replacement' or replacement_instructor_id is not null);

-- Qeyri-iş günləri (bayram və s.): həmin gün dərs planlaşdırılmır, "qeyd edilməyən" sayılmır.
create table if not exists public.dma_non_working_days (
  day        date primary key,
  note       text,
  created_at timestamptz not null default now()
);
alter table public.dma_non_working_days enable row level security;
drop policy if exists "dma_staff_all_non_working_days" on public.dma_non_working_days;
create policy "dma_staff_all_non_working_days" on public.dma_non_working_days
  for all to authenticated
  using ((select public.has_scope('dma'))) with check ((select public.has_scope('dma')));
grant select, insert, update, delete on public.dma_non_working_days to authenticated;

create or replace function public.dma_group_sessions_touch()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;
drop trigger if exists dma_group_sessions_touch on public.dma_group_sessions;
create trigger dma_group_sessions_touch before update on public.dma_group_sessions
  for each row execute function public.dma_group_sessions_touch();

-- Maaş view: sütunlar və sıra dəyişmir (create or replace üçün). Dərs = session yazısı və ya session olmayan gündə köhnə
-- tələbə yazıları. yes -> qrupun müəllimi, replacement -> əvəzləyən müəllim, no -> ödəniş yoxdur.
create or replace view public.dma_instructor_lesson_pay with (security_invoker = true) as
with lessons as (
  select s.training_group_id, s.session_date, s.present_count::bigint as attended_count,
         case s.teacher_status when 'replacement' then s.replacement_instructor_id else g0.instructor_id end as paid_instructor_id
  from public.dma_group_sessions s
  join public.dma_training_groups g0 on g0.id = s.training_group_id
  where s.teacher_status in ('yes', 'replacement')
  union all
  select r.training_group_id, r.session_date, count(*) filter (where r.attended), g1.instructor_id
  from public.dma_attendance_records r
  join public.dma_training_groups g1 on g1.id = r.training_group_id
  where not exists (
    select 1 from public.dma_group_sessions s
    where s.training_group_id = r.training_group_id and s.session_date = r.session_date
  )
  group by r.training_group_id, r.session_date, g1.instructor_id
)
select
  l.session_date,
  g.id   as group_id,
  g.name as group_name,
  i.id   as instructor_id,
  i.full_name as instructor_name,
  i.pay_type,
  l.attended_count,
  case when i.pay_type = 'fixed' then coalesce(i.fixed_rate, 0)
       else round((least(l.attended_count, i.student_threshold) * coalesce(i.base_rate, 0)
                 + greatest(l.attended_count - i.student_threshold, 0) * coalesce(i.extra_rate, 0))
                 / i.student_threshold::numeric, 2)
  end as pay
from lessons l
join public.dma_training_groups g on g.id = l.training_group_id
join public.dma_instructors i on i.id = l.paid_instructor_id
where l.attended_count > 0;

grant select on public.dma_instructor_lesson_pay to authenticated;
