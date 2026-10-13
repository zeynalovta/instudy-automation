-- Məzunun aldığı beynəlxalq sertifikat. Supabase SQL Editor-də bir dəfə işlədin.
-- İşə düzəltmə VƏ YA sertifikat müddəti ödəyir (Məzunlar səhifəsində "son tarix" bu halda bağlanır).
alter table public.dma_applications
  add column if not exists certificate_name text,
  add column if not exists certificate_at date;
