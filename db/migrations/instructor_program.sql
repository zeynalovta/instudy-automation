-- Müəllimin keçdiyi təlim. Supabase SQL Editor-də bir dəfə işlədin.
alter table public.dma_instructors
  add column if not exists program_id bigint references public.dma_programs(id) on delete set null;
