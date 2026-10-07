-- Google Sheets -> ERP import (DMA müraciətləri)
-- Supabase SQL Editor-da ADDIM-ADDIM əllə icra olunur. Heç nə avtomatik işə düşmür.
-- CSV: /Users/test/Downloads/DMA_applications_clean.csv (14 sütun, 1-ci sütun "timestamp"). Başlıq dəyişdirilmir.

-- ADDIM 1: staging cədvəli (köhnəsini silib yenidən yaradır). Sonra Table Editor -> import_dma_stage -> "Import data from CSV".
drop table if exists public.import_dma_stage cascade;
create table public.import_dma_stage (
  "timestamp" text, full_name text, email text, fin text, birth_date text,
  whatsapp_phone text, program_name text, education text,
  is_student text, is_employed text, has_active_voen text,
  address text, attended_dma_course_last_12_months text, problem text
);

-- ADDIM 2: program_name -> dma_programs.slug xəritəsi.
-- Slug-ları Sistem -> Təlimlər səhifəsindəki real dəyərlərə görə YOXLAYIN/dəyişin.
create table if not exists public.import_dma_program_map (
  program_name text primary key,
  slug text not null
);
-- Əvvəl real slug-lara baxın:  select id, name, slug, is_active from public.dma_programs order by id;
-- Aşağıdakı slug-lar fərziyyədir (reklam xəritəsindəki adlara görə); fərqlidirsə ikinci sütunu dəyişin.
insert into public.import_dma_program_map values
  ('HR',                                   'hr'),
  ('Mühasibatlıq',                         'accounting'),
  ('Data analitika',                       'data'),
  ('Backend Developer',                    'backend'),
  ('Frontend Developer',                   'frontend'),
  ('Kompüter operatoru',                   'computer_operator'),
  ('Ofis proqramları(Kompüter operatoru)', 'computer_operator')
on conflict (program_name) do update set slug = excluded.slug;

-- Slug-u dma_programs-da tapılmayanlar (BOŞ olmalıdır, yoxsa o proqramın müraciətləri yazılmaz):
select m.* from public.import_dma_program_map m
where not exists (select 1 from public.dma_programs p where p.slug = m.slug);

-- ADDIM 3: YOXLAMA (heç nə yazmır). Xəritəsiz proqram və pis sətirlər:
select program_name, count(*) from public.import_dma_stage s
where not exists (select 1 from public.import_dma_program_map m where m.program_name = s.program_name)
group by 1;

-- Təmiz sətirlər: FİN 7 simvol, tarix və telefon düzgün, ad >= 3 simvol.
-- FİN üzrə ən son sətir qalır (dublikatlar birləşir).
create or replace view public.import_dma_valid as
select distinct on (upper(trim(fin)))
  trim(full_name) as full_name,
  upper(trim(fin)) as fin,
  birth_date::date as birth_date,
  regexp_replace(whatsapp_phone, '[^0-9+]', '', 'g') as whatsapp_phone,
  nullif(trim(email), '') as email,
  nullif(trim(education), '') as education,
  nullif(trim(address), '') as address,
  lower(trim(is_student)) in ('true','bəli','beli','yes','1') as is_student,
  lower(trim(is_employed)) in ('true','bəli','beli','yes','1') as is_employed,
  lower(trim(has_active_voen)) in ('true','bəli','beli','yes','1') as has_active_voen,
  lower(trim(attended_dma_course_last_12_months)) in ('true','bəli','beli','yes','1') as attended_dma_course_last_12_months
from public.import_dma_stage
where length(trim(fin)) = 7
  and birth_date ~ '^\d{4}-\d{2}-\d{2}$'
  and length(regexp_replace(whatsapp_phone, '[^0-9]', '', 'g')) >= 9
  and length(trim(full_name)) >= 3
  and coalesce(problem,'') not ilike '%test%'
  and "timestamp" < '2026-10-07'   -- migrasiya kəsimi: 6 oktyabr 23:59:59 daxil
order by upper(trim(fin)), "timestamp" desc;

select count(*) as valid_candidates from public.import_dma_valid;

-- ADDIM 4: İMPORT (yalnız 3-cü addımın nəticəsi təmizdirsə).
begin;

insert into public.dma_candidates
  (full_name, fin, birth_date, whatsapp_phone, email, education, address,
   is_student, is_employed, has_active_voen, attended_dma_course_last_12_months)
select full_name, fin, birth_date, whatsapp_phone, email, education, address,
       is_student, is_employed, has_active_voen, attended_dma_course_last_12_months
from public.import_dma_valid
on conflict (fin) do nothing;   -- ERP-də artıq olan namizədlər toxunulmaz qalır

-- Hər (namizəd, proqram) cütü üçün 1 müraciət; artıq olanlar keçilir.
-- Trigger (applications_set_eligibility) eligibility_status/current_status-u özü hesablayır.
insert into public.dma_applications (candidate_id, program_id)
select distinct c.id, p.id
from public.import_dma_stage s
join public.import_dma_valid v on v.fin = upper(trim(s.fin))
  and s."timestamp" < '2026-10-07'
join public.dma_candidates c on c.fin = v.fin
join public.import_dma_program_map m on m.program_name = s.program_name
join public.dma_programs p on p.slug = m.slug
where not exists (
  select 1 from public.dma_applications a
  where a.candidate_id = c.id and a.program_id = p.id
);

select (select count(*) from public.dma_candidates) as candidates,
       (select count(*) from public.dma_applications) as applications;

commit;

-- ADDIM 5: təmizlik
-- drop view public.import_dma_valid;
-- drop table public.import_dma_stage, public.import_dma_program_map;
