-- Təlim zamanı xaric edilən tələbə: tarix, səbəb, qeyd. Supabase SQL Editor-də bir dəfə işlədin.
-- Qrup bağlantısı (training_group_id) saxlanılır; davamiyyətdə gözlənilən say xaric tarixindən etibarən azalır.
alter table public.dma_applications
  add column if not exists expelled_at date,
  add column if not exists expelled_reason text,
  add column if not exists expelled_note text;

alter table public.dma_applications drop constraint if exists dma_applications_expelled_reason_check;
alter table public.dma_applications add constraint dma_applications_expelled_reason_check
  check (expelled_reason is null or expelled_reason in ('ATTENDANCE', 'EMPLOYED', 'SELF', 'OTHER'));
