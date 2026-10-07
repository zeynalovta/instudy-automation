-- Müddət yalnız gün ilə saxlanılır; ay/gün vahidi sütunu lazım deyil.
alter table public.dma_programs drop constraint if exists dma_programs_duration_unit_check;
alter table public.dma_programs drop column if exists duration_unit;
