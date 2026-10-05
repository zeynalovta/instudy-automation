-- Müəllim ödəniş məlumatları. instructor_program.sql-dən sonra Supabase SQL Editor-də işlədin.
-- pay_type = 'fixed'       -> fixed_rate: bir dərsə görə sabit məbləğ
-- pay_type = 'per_student' -> ilk student_threshold nəfər base_rate, qalanları extra_rate ilə
alter table public.dma_instructors
  add column if not exists pay_type text not null default 'fixed',
  add column if not exists fixed_rate numeric(10,2),
  add column if not exists base_rate numeric(10,2),
  add column if not exists extra_rate numeric(10,2),
  add column if not exists student_threshold int not null default 20;

alter table public.dma_instructors drop constraint if exists dma_instructors_pay_type_check;
alter table public.dma_instructors
  add constraint dma_instructors_pay_type_check check (pay_type in ('fixed', 'per_student'));
