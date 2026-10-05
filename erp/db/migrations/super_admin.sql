-- "Sistem" paneli üçün super admin + təlim (proqram) idarəetməsi. instructors.sql-dən SONRA işlədin.
create or replace function public.is_super_admin()
returns boolean language sql stable set search_path = '' as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'super_admin') = 'true', false);
$$;

-- Müəllim və proqram yazma icazəsi yalnız super admin-də
drop policy if exists "dma_staff_all_instructors" on public.dma_instructors;
drop policy if exists "staff_read_instructors" on public.dma_instructors;
create policy "staff_read_instructors" on public.dma_instructors
  for select to authenticated using ((select public.has_scope('dma')));
drop policy if exists "super_admin_write_instructors" on public.dma_instructors;
create policy "super_admin_write_instructors" on public.dma_instructors
  for all to authenticated
  using ((select public.is_super_admin())) with check ((select public.is_super_admin()));

drop policy if exists "super_admin_write_programs" on public.dma_programs;
create policy "super_admin_write_programs" on public.dma_programs
  for all to authenticated
  using ((select public.is_super_admin())) with check ((select public.is_super_admin()));
grant select, insert, update, delete on public.dma_programs to authenticated;

-- Öz hesabınızı super admin edin (sonra çıxış edib yenidən daxil olun)
update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"super_admin": true}'::jsonb
 where email = 'allahverdi.zeynalov93@gmail.com';
