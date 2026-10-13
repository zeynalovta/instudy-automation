-- Qrupun bitmə tarixi keçib (Bakı vaxtı ilə dünən və ya əvvəl) -> təlimdə olan tələbə "məzun" olur.
-- Supabase SQL Editor-də bir dəfə işlədin. Məzunlar səhifəsi hər açılışda bu funksiyanı çağırır (təkrar çağırış zərərsizdir).
-- security invoker: RLS qüvvədədir, yalnız dma scope-u olan işçi dəyişə bilər.
create or replace function public.dma_graduate_finished_groups()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.dma_applications a
  set current_status = 'GRADUATED'
  from public.dma_training_groups g
  where g.id = a.training_group_id
    and a.current_status = 'ENROLLED'
    and g.ends_at is not null
    and g.ends_at < (now() at time zone 'Asia/Baku')::date;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function public.dma_graduate_finished_groups() from public, anon;
grant execute on function public.dma_graduate_finished_groups() to authenticated;
