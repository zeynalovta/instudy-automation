-- Davamiyyətdən müəllim maaşı. instructor_pay.sql-dən sonra işlədin.
-- Dərs = bir qrupun bir günü (dma_attendance_records-da yazı olan). Gələn say 0-dırsa dərs sayılmır.
-- sabit:        pay = fixed_rate
-- per_student:  pay = (min(n,T)*base_rate + max(n-T,0)*extra_rate) / T     (n = gələn tələbə, T = student_threshold)
create or replace view public.dma_instructor_lesson_pay with (security_invoker = true) as
with lessons as (
  select training_group_id, session_date, count(*) filter (where attended) as attended_count
  from public.dma_attendance_records
  group by training_group_id, session_date
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
join public.dma_instructors i on i.id = g.instructor_id
where l.attended_count > 0;

grant select on public.dma_instructor_lesson_pay to authenticated;
