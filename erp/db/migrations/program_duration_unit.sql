-- Təlim müddəti ay və ya gün ilə daxil edilə bilsin (növbəti mərhələdə
-- ödənişlər və müəllim haqqı günə görə hesablanacaq).
-- Mövcud dəyərlər admin paneldə "ay" kimi daxil edilib -> default 'month'.
alter table public.dma_programs
  add column if not exists duration_unit text not null default 'month';

alter table public.dma_programs
  drop constraint if exists dma_programs_duration_unit_check;
alter table public.dma_programs
  add constraint dma_programs_duration_unit_check check (duration_unit in ('month', 'day'));
