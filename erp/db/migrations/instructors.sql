-- Müəllimlər cədvəli və qrupa müəllim bağlantısı. Supabase SQL Editor-də bir dəfə işlədin.
create table if not exists public.dma_instructors (
  id          bigint generated always as identity primary key,
  full_name   text not null,
  phone       text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
alter table public.dma_instructors enable row level security;

drop policy if exists "dma_staff_all_instructors" on public.dma_instructors;
create policy "dma_staff_all_instructors" on public.dma_instructors
  for all to authenticated
  using ((select public.has_scope('dma'))) with check ((select public.has_scope('dma')));
grant select, insert, update, delete on public.dma_instructors to authenticated;

alter table public.dma_training_groups
  add column if not exists instructor_id bigint references public.dma_instructors(id) on delete set null;
