# INSTUDY ERP V2 — Implementation Plan

**Status:** Yalnız plandır. **Heç bir implementasiya edilməyib. Mövcud ERP koduna, Supabase bazasına və canlı məlumatlara toxunulmayıb. Heç bir SQL icra olunmayıb. Commit/push edilməyib.**
**Əsas mənbə:** `audit/INSTUDY_ERP_V2_TARGET_ARCHITECTURE.md` (v3, final).
**Struktur:** hər faza — Database / Backend / Frontend dəyişiklikləri, Mövcud sistemə risklər, Test ssenariləri, Rollback planı, Acceptance criteria.
**Ümumi qayda (bütün fazalar üçün):** əks halda qeyd olunmayıbsa, hər fazanın DB dəyişiklikləri **additive**-dir (yalnız `CREATE TABLE`/`ALTER TABLE ... ADD COLUMN`/`CREATE TRIGGER` yeni obyektlərə), mövcud sütun/trigger/policy **silinmir və ya dəyişdirilmir**. İstisna: **Faza 6** (aşağı, xüsusi qeyd).

---

## Faza 0 — Canlı bazanın doğrulanması

**Database:** Yoxdur (dəyişiklik). `INSTUDY_ERP_MIGRATION_READINESS.md`-dəki yalnız-oxuyan `information_schema`/`pg_constraint`/`pg_trigger` və sətir-sayı sorğuları Supabase SQL Editor-da işə salınır.

**Backend/Frontend:** Yoxdur.

**Risklər:** Sıfır (yalnız-oxuyan sorğular).

**Test ssenariləri:** Sorğuların nəticəsi `INSTUDY_ERP_DATABASE_SCHEMA.sql`/`INSTUDY_ERP_DATA_DICTIONARY.csv` ilə sətir-sətir müqayisə edilir; uyğunsuzluq tapılarsa, Faza 1-ə keçmədən əvvəl bu sənədlər yenilənir.

**Rollback:** Tələb olunmur.

**Acceptance criteria:** Bütün 10 mövcud cədvəlin sütun/constraint/trigger siyahısı sənədlərlə 1:1 üst-üstə düşür; fərq varsa, sənədləşdirilib izah olunub.

---

## Faza 1 — Əlavə sütunlar, `dma_config`, icazə bayrağı (təməl)

### Database
```sql
-- YALNIZ TƏKLİF, İCRA EDİLMƏYİB
alter table public.dma_applications
  add column source text not null default 'FORM'
    check (source in ('FORM','DMA_REFERRAL','MANUAL','MANUAL_IMPORT')),
  add column eligibility_override_reason text,
  add column eligibility_overridden_by text,
  add column eligibility_overridden_at timestamptz,
  add column final_certificate_score numeric;

alter table public.dma_training_groups
  add column assessment_scheme_id bigint;   -- FK, dma_assessment_schemes Faza 4-də yaranacaq

create table public.dma_config (
  key text primary key,
  value text not null,
  description text,
  updated_at timestamptz not null default now()
);

insert into public.dma_config (key, value, description) values
  ('reapplication_cooldown_days', '90', 'Eyni proqrama yenidən müraciət üçün gözləmə müddəti (gün)'),
  ('erp_cutover_date', null, 'Faza 6 canlıya çıxdığı tarix (sənədləşdirmə məqsədli)');

alter table public.dma_config enable row level security;
grant select on table public.dma_config to authenticated;
create policy "admins_can_read_config" on public.dma_config
  for select to authenticated using ((select public.has_scope('dma')));

create or replace function public.can_override_eligibility()
returns boolean language sql stable set search_path = '' as $$
  select coalesce(
    (select public.is_admin())
    and (auth.jwt() -> 'app_metadata' ->> 'can_override_eligibility')::boolean is true,
    false
  );
$$;
revoke all on function public.can_override_eligibility() from public;
grant execute on function public.can_override_eligibility() to authenticated;
```

**Qeyd:** `assessment_scheme_id`-nin FK-si Faza 4-dən sonra (`dma_assessment_schemes` yarananda) `alter table ... add constraint` ilə əlavə olunacaq — bu fazada sütun `bigint`, FK-siz yaradılır ki, Faza 1 Faza 4-dən asılı olmasın.

### Backend
Yoxdur (bu fazada heç bir API dəyişmir).

### Frontend
Yoxdur.

### Mövcud sistemə risklər
- **Çox aşağı.** `ADD COLUMN` (nullable və ya defoltlu) Postgres-də mövcud sətirlərə avtomatik dəyər verir, heç bir mövcud sorğunu poza bilməz (SELECT * istifadə edən heç bir yer yoxdur — V1 auditdə bütün sorğular açıq sütun siyahısı ilədir).
- `dma_applications.source`-un `not null default 'FORM'` olması: mövcud `INSERT` (yalnız `api/dma/apply.js`) `source` sahəsini göndərmir, DB defoltu avtomatik `'FORM'` təyin edəcək — kodda dəyişiklik tələb olunmur, DAVRANIŞ EYNİ qalır.

### Test ssenariləri
1. Mövcud `api/dma/apply.js` vasitəsilə yeni müraciət göndərilir → sətir `source='FORM'` ilə yaranır (kod dəyişmədən).
2. Bütün mövcud admin səhifələri (Namizədlər, İmtahanlar, Müsahibələr, Qruplar, Davamiyyət, Məzunlar) açılır, xəta yoxdur, mövcud funksiyalar işləyir.
3. `dma_config`-dən `authenticated` (adi staff) `select` edə bilir, `insert`/`update` edə bilmir (yalnız `select` grant verilib).

### Rollback
```sql
alter table public.dma_applications
  drop column source, drop column eligibility_override_reason,
  drop column eligibility_overridden_by, drop column eligibility_overridden_at,
  drop column final_certificate_score;
alter table public.dma_training_groups drop column assessment_scheme_id;
drop table public.dma_config;
drop function public.can_override_eligibility();
```

### Acceptance criteria
- Yeni sütunlar mövcuddur, mövcud heç bir sorğu qırılmayıb.
- Yeni `FORM` müraciəti `source='FORM'` ilə yaranır.
- `dma_config`-də 2 sətir var, `authenticated` yalnız oxuya bilir.

---

## Faza 2 — Manual/DMA-referral müraciət + Eligibility Override

### Database
```sql
-- YALNIZ TƏKLİF, İCRA EDİLMƏYİB
create or replace function public.record_eligibility_override(
  p_application_id bigint, p_new_status text, p_reason text
) returns void language plpgsql security invoker set search_path = '' as $$
-- tam kod: bax Target Architecture, bölmə 3.2
$$;
revoke all on function public.record_eligibility_override(bigint, text, text) from public;
grant execute on function public.record_eligibility_override(bigint, text, text) to authenticated;
```

### Backend
- **Yeni fayl `api/dma/manual-application.js`:**
  - `api/dma/apply.js`-in FİN-tap-ya-yarat + validasiya məntiqini təkrar istifadə edir (paylaşılan köməkçi funksiyaya çıxarıla bilər, ya da təkrarlana bilər — implementasiya detalı).
  - **YENİ: server-side auth yoxlaması** — sorğunun `Authorization: Bearer <token>` başlığından Supabase Auth token-i alınır, `supabase.auth.getUser(token)` ilə doğrulanır, `role==='admin'` və `staff_scope in ('dma','all')` yoxlanılır; uğursuzdursa 401/403.
  - `source` sahəsi client-dən qəbul edilir, AMMA server-side allowlist: yalnız `'DMA_REFERRAL'` və `'MANUAL'`, başqa dəyər → 400.
  - `api/dma/apply.js`-ə **heç bir dəyişiklik yoxdur** (source hardcoded `'FORM'` olaraq qalır, indi də, gələcəkdə də).
- **`lib/dma-eligibility-override.js`** (opsional köməkçi) — admin frontend-in `record_eligibility_override` RPC-ni çağırdığı yer, əlavə backend endpoint tələb etmir (birbaşa Supabase client RPC çağırışı, RLS+RPC-daxili authorization kifayətdir).

### Frontend
- `admin/candidates/index.html` (və ya `admin/index.html`) səhifəsinə **"+ Yeni müraciət əlavə et"** düyməsi/modalı: ad, FİN, doğum tarixi, telefon, e-poçt, ünvan, təhsil, proqram, mənbə (`DMA_REFERRAL`/`MANUAL` radio/dropdown) → `POST /api/dma/manual-application`.
- Eligibility override UI: yalnız `can_override_eligibility()` claim-i olan istifadəçilərə görünən bir düymə (UI-də gizlətmə YALNIZ rahatlıq üçündür, əsl qoruma RPC-dədir) — status dəyişikliyi zamanı "Override et" seçimi, səbəb mətn qutusu məcburi, `record_eligibility_override` RPC-ni çağırır.

### Mövcud sistemə risklər
- **Aşağı.** Yeni, təcrid olunmuş endpoint/UI. `api/dma/apply.js` və mövcud status-dəyişmə axını **toxunulmur**.
- Risk nöqtəsi: yeni endpoint-in auth yoxlaması səhv yazılsa, icazəsiz yazma mümkün ola bilər — diqqətli kod review tələb olunur (aşağıdakı test ssenariləri bunu əhatə edir).

### Test ssenariləri
1. Admin sessiyası ilə `manual-application` çağırılır, `source='DMA_REFERRAL'` → uğurlu, standart eligibility trigger işə düşür.
2. Eyni endpoint `source='MANUAL_IMPORT'` ilə çağırılır → **400 rədd edilir**.
3. Token olmadan/etibarsız token ilə çağırılır → **401/403**.
4. Mövcud FİN ilə çağırılır → yeni `dma_candidates` sətri YARANMIR, mövcud profil istifadə olunur, yalnız yeni `dma_applications` sətri yaranır.
5. `can_override_eligibility=true` olmayan staff `record_eligibility_override` çağırır → RPC `NOT_AUTHORIZED` xətası ilə rədd edir.
6. `can_override_eligibility=true` olan Manager çağırır, boş səbəblə → RPC `REASON_REQUIRED` ilə rədd edir.
7. Manager düzgün səbəblə çağırır → `current_status` dəyişir, `dma_application_status_history`-də `old_status`/`new_status`/`changed_at` + `note` (icra edən + səbəb) düzgün yazılır, `dma_applications.eligibility_override_*` sütunları dolur.

### Rollback
```sql
drop function public.record_eligibility_override(bigint, text, text);
```
`api/dma/manual-application.js` faylı silinir/deploy-dan çıxarılır. Frontend düyməsi geri qaytarılır.

### Acceptance criteria
- Regular staff `MANUAL_IMPORT` göndərə bilmir (API 400).
- Override yalnız `can_override_eligibility` claim-i olanlara işləyir, DB-də yoxlanılır (UI-dən asılı deyil — test: birbaşa RPC-ni çağırıb yoxlamaq mümkündür).
- Hər override tam audit tarixçəsi ilə (kim, niyə, əvvəlki/yeni status, vaxt) qeyd olunur.

---

## Faza 3 — `dma_class_sessions` (Davamiyyət + Müəllim)

### Database
`CREATE TABLE dma_class_sessions` (bütün sütunlarla, `session_status` daxil) + `dma_class_sessions_snapshot_expected()` trigger + `set_class_sessions_updated_at` trigger + RLS policy. Tam kod: Target Architecture, bölmə 2.1.

### Backend
Birbaşa client-side Supabase sorğuları (digər dma_* admin əməliyyatları kimi) — ayrıca API endpoint tələb olunmur (`dma_class_sessions`-a `authenticated` üçün RLS-based `insert`/`update`/`select` icazəsi verilir, digər əməliyyat cədvəlləri ilə eyni naxış).

### Frontend
- `admin/attendance/index.html`-ə (və ya yeni `admin/class-sessions/`) yeni bölmə: qrup + tarix seçib "dərs qeydi" yaratmaq/redaktə etmək — dərs statusu (Keçirilib/Ləğv edilib), müəllim adı, müəllim iştirakı, faktiki iştirakçı sayı (əl ilə).
- Gözlənilən say **redaktə edilə bilməz** göstərilir (avtomatik, snapshot), yalnız məlumat kimi.
- Faiz/qalmayan sayı **hesablanmış** sahə kimi göstərilir (saxlanmır); `CANCELLED` üçün "Dərs keçirilməyib" yazısı, 0% GÖSTƏRİLMİR.

### Mövcud sistemə risklər
- **Aşağı.** Tamamilə yeni, paralel cədvəl. Mövcud `dma_attendance_records` funksionallığına heç bir toxunuş yoxdur.

### Test ssenariləri
1. Qrupda 20 ENROLLED tələbə olarkən dərs yaradılır → `expected_attendee_count=20` avtomatik yazılır.
2. Həmin dərsdə `actual_attendee_count=17` daxil edilir → UI-də "17/20, 85.0%, 3 iştirak etməyib" göstərilir.
3. Dərsdən SONRA 2 tələbə `EXPELLED` edilir → **köhnə dərsin** `expected_attendee_count`-u **20 olaraq qalır** (dəyişmir).
4. Sonra YENİ bir dərs yaradılır → yeni dərsin `expected_attendee_count`-u indi **18** (yeni ENROLLED sayı) olur.
5. Dərs `CANCELLED` statusu ilə yaradılır → `expected_attendee_count`/`actual_attendee_count` NULL qalır, UI-də "Dərs keçirilməyib" göstərilir, 0% YOXDUR.
6. Eyni (qrup, tarix) üçün ikinci dərs yaradılmağa cəhd edilir → UNIQUE constraint ilə rədd edilir.
7. Qrup üzrə "ortalama davamiyyət" hesablanarkən `CANCELLED` dərslər **istisna** olunur (nə sayğaca, nə cəmə daxil edilir).

### Rollback
```sql
drop trigger trg_class_sessions_snapshot_expected on public.dma_class_sessions;
drop function public.dma_class_sessions_snapshot_expected();
drop table public.dma_class_sessions;
```

### Acceptance criteria
- Gözlənilən say yalnız yaradılma anında təyin olunur, sonradan DƏYİŞMİR.
- Faktiki say əl ilə redaktə edilə bilir, gözlənilənə təsir etmir.
- Ləğv edilmiş dərs 0% kimi göstərilmir/hesablanmır.
- Müəllim iştirakı ayrıca sahədə, tələbə göstəricilərindən asılı olmadan qeyd olunur.

---

## Faza 4 — Qiymətləndirmə modeli (`dma_assessment_*`)

### Database
`CREATE TABLE dma_assessment_schemes`, `dma_assessment_components`, `dma_student_assessment_results` (tam kod: Target Architecture, bölmə 2.2) + `recalculate_final_certificate_score()` trigger + `dma_training_groups.assessment_scheme_id`-yə FK əlavəsi:
```sql
alter table public.dma_training_groups
  add constraint dma_training_groups_assessment_scheme_id_fkey
  foreign key (assessment_scheme_id) references public.dma_assessment_schemes(id);
```

### Backend
Birbaşa client-side Supabase sorğuları (RLS-based).

### Frontend
- **Yeni "Qiymətləndirmə sxemləri" admin səhifəsi:** proqram seçib sxem versiyaları yaratmaq/baxmaq, hər versiyaya komponent (ad, maks bal, çəki%, keçid balı) əlavə etmək. Çəkilərin cəminin 100% olduğunu **UI-də** yoxlayan (submit-dən əvvəl xəbərdarlıq) validasiya.
- **Qrup yaratma/redaktə formasına** "Qiymətləndirmə sxemi" seçimi əlavə olunur (`assessment_scheme_id`). **UI xəbərdarlığı:** əgər qrupda artıq `dma_student_assessment_results` varsa, sxemin dəyişdirilməsi qadağan edilir/xəbərdarlıq göstərilir.
- **Namizəd profili/Namizədlər səhifəsinə** hər komponent üzrə bal daxiletmə sahəsi (qrupun sxeminə görə dinamik generasiya olunan formalar) + yekun bal (`final_certificate_score`, READ-ONLY, avtomatik).

### Mövcud sistemə risklər
- **Aşağı-orta.** Yeni cədvəllər, yeni trigger — amma trigger yalnız YENİ cədvələ qoyulur, mövcud `dma_applications`-ın 4 trigger-inə toxunmur. Əsas risk: UI dizaynının mürəkkəbliyi (dinamik forma generasiyası), texniki DB riski deyil.

### Test ssenariləri
1. "Data Analitika" üçün v1 sxemi yaradılır (Excel 25%, SQL 25%, Power BI 25%, Python 25%), qrup buna bağlanır.
2. Tələbəyə Excel=80, SQL=90 daxil edilir → `final_certificate_score` avtomatik `(80/100*25)+(90/100*25)=42.5` olur.
3. Power BI=70, Python=60 əlavə edilir → `final_certificate_score` avtomatik `100`-ə yenilənir.
4. Bir nəticə silinir (`SQL` sətri) → `final_certificate_score` avtomatik yenidən hesablanır (SQL-siz).
5. Proqram üçün v2 sxemi yaradılır (fərqli çəkilər) — **v1-ə bağlı qrupun mövcud nəticələri DƏYİŞMİR.**
6. v2-yə bağlı yeni qrup yaradılır, öz komponentləri ilə işləyir, v1-dən müstəqil.
7. Artıq nəticəsi olan qrupun sxemi dəyişdirilməyə cəhd edilir → UI xəbərdarlıq göstərir (və ya bloklayır).

### Rollback
```sql
drop trigger trg_recalculate_final_certificate_score on public.dma_student_assessment_results;
drop function public.recalculate_final_certificate_score();
drop table public.dma_student_assessment_results;
drop table public.dma_assessment_components;
alter table public.dma_training_groups drop constraint dma_training_groups_assessment_scheme_id_fkey;
drop table public.dma_assessment_schemes;
```

### Acceptance criteria
- Hər proqram öz komponent strukturunu konfiqurasiya edə bilir.
- Yekun bal həmişə `dma_student_assessment_results`-dan avtomatik, düzgün hesablanır.
- Sxem versiyaları bir-birindən tam müstəqildir, köhnə nəticələrə təsir yoxdur.

---

## Faza 5 — `dma_employment_contacts`

### Database
`CREATE TABLE dma_employment_contacts` + RLS policy (Target Architecture-dəki dəyişməz dizayn).

### Backend
Birbaşa client-side Supabase sorğuları.

### Frontend
`admin/graduates/index.html`-ə hər məzun üçün "Əlaqə tarixçəsi" bölməsi: yeni əlaqə qeydi (tarix, üsul, nəticə, növbəti əlaqə tarixi) əlavə etmək, siyahını görmək.

### Mövcud sistemə risklər
Sıfıra yaxın — yeni, müstəqil cədvəl, mövcud `employment_status`/`employment_note`/`employed_at` sütunlarına toxunmur.

### Test ssenariləri
1. Məzuna 3 ardıcıl əlaqə qeydi əlavə olunur, xronoloji sırayla görünür.
2. `next_followup_date` dolu qeydlər "Bu gün əlaqə saxlanmalı olanlar" siyahısında (gələcək Dashboard genişləndirməsi üçün) düzgün seçilir.

### Rollback
```sql
drop table public.dma_employment_contacts;
```

### Acceptance criteria
Staff məzunla hər əlaqəni ayrıca, tarixləşdirilmiş şəkildə qeyd edə bilir, mövcud sadə status sahələri toxunulmaz qalır.

---

## Faza 6 — Təkrar müraciət qaydası (⚠️ CANLI DAVRANIŞ DƏYİŞİKLİYİ)

**Bu, bütün planda YEGANƏ fazadır ki, mövcud istifadəçi davranışını real dəyişir** (əvvəllər ömürlük blok, indi 90 gün + aktiv-yoxlama).

### Database
```sql
-- YALNIZ TƏKLİF, İCRA EDİLMƏYİB — tam kod: Target Architecture, bölmə 5.3
create or replace function public.applications_enforce_reapplication_policy()
returns trigger language plpgsql set search_path = '' as $$ ... $$;

create trigger trg_applications_enforce_reapplication_policy
before insert on public.dma_applications
for each row execute function public.applications_enforce_reapplication_policy();

update public.dma_config set value = '<bugünkü tarix>' where key = 'erp_cutover_date';
```

### Backend
- `api/dma/apply.js` və `api/dma/manual-application.js`-ə **əlavə pre-check** (aydın xəta mesajı üçün): INSERT-dən əvvəl "aktiv müraciət varmı" və "90 gün keçibmi" sorğusu, uğursuzdursa 409 + istifadəçiyə anlaşılan mesaj (məs. "Bu proqrama 47 gün sonra yenidən müraciət edə bilərsiniz").

### Frontend
`dma/apply/index.html`-də 409 xətası üçün UI mesajı (qalan gün sayı ilə).

### Mövcud sistemə risklər
- **Orta.** Bu, ilk dəfə real bir **iş qaydasını** dəyişir. Əgər `api/dma/apply.js`-in pre-check-i DB trigger-i ilə TAM sinxron deyilsə (məsələn fərqli terminal-status siyahısı istifadə edilsə), istifadəçi tətbiq-səviyyəli yoxlamadan keçib DB trigger-inin **çiy** (az dostcasına) xətasına rast gələ bilər — hər iki qatın EYNİ terminal-status siyahısını və EYNİ `dma_config` dəyərini istifadə etdiyi diqqətlə təmin edilməlidir (kодda paylaşılan sabit/funksiya).
- Miqrasiya (Faza 7) BU FAZADAN ƏVVƏL və ya SONRA ola bilər, AMMA `source='MANUAL_IMPORT'` bypass-ı hər iki halda mövcud olmalıdır (Faza 6-nın öz trigger-i bunu artıq təmin edir).

### Test ssenariləri
1. Aktiv müraciəti olan namizəd (məs. `ELIGIBLE`) eyni proqrama yenidən müraciət edir → **bloklanır**, "aktiv müraciətiniz var" mesajı.
2. `RESERVE_LIST`-də olan namizəd yenidən müraciət edir → **bloklanır** (aktiv sayılır).
3. `DECLINED` namizəd, son müraciətdən 45 gün keçib → **bloklanır**, "45 gün sonra yenidən cəhd edin" mesajı.
4. Eyni namizəd, 91 gün keçəndən sonra → **icazə verilir**.
5. `GRADUATED` namizəd fərqli proqrama müraciət edir → **heç bir məhdudiyyət yoxdur** (cross-program).
6. `source='MANUAL_IMPORT'` ilə (yalnız miqrasiya skriptindən) eyni proqrama 3 tarixi müraciət daxil edilir → **bloklanmır**.
7. `dma_config.reapplication_cooldown_days` `120`-yə dəyişdirilir → yeni yoxlamalar 120 günü tətbiq edir (kod dəyişikliyi olmadan).

### Rollback
```sql
drop trigger trg_applications_enforce_reapplication_policy on public.dma_applications;
drop function public.applications_enforce_reapplication_policy();
```
Backend pre-check kodu geri qaytarılır (əvvəlki "ömürlük bir dəfə" davranışına).

### Acceptance criteria
- Aktiv müraciət qaydası və 90 günlük cooldown hər iki backend yolunda (public forma + manual-application) EYNİ şəkildə tətbiq olunur.
- DB trigger-i backend yoxlamasından müstəqil olaraq da qaydanı təmin edir (bir backend-in yoxlaması unudulsa belə).
- `MANUAL_IMPORT` mənbəli sətirlər tam azaddır.
- Konfiqurasiya dəyəri kod dəyişmədən effektiv olur.

---

## Faza 7 — Tarixi miqrasiya (Google Sheets → ERP)

### Database
```sql
-- YALNIZ TƏKLİF, İCRA EDİLMƏYİB — tam kod: Migration Readiness sənədi, bölmə 4 + Target Architecture bölmə 4
create table public.dma_import_staging (...);

-- Mövcud 2 trigger funksiyasına source='MANUAL_IMPORT' bypass-ı ("CREATE OR REPLACE"):
create or replace function public.applications_set_eligibility() ... 
  -- başına: if new.source = 'MANUAL_IMPORT' then return new; end if;
create or replace function public.applications_interview_attendance_result() ...
  -- başına: if new.source = 'MANUAL_IMPORT' then return new; end if;
```

### Backend
Ayrıca, **veb-də ekspozisiya OLUNMAYAN** bir miqrasiya skripti (Node.js CLI, yalnız məhdud girişli operator tərəfindən lokal/təhlükəsiz mühitdə, service-role açarı ilə işə salınır). Bu skript:
1. Sheets-i oxuyur, `dma_import_staging`-ə xam JSON kimi yazır.
2. FİN dublikatlarını, status-mapping uyğunsuzluqlarını aşkarlayır (`validation_state`).
3. Yalnız `READY` sətirləri `dma_candidates`/`dma_applications` (`source='MANUAL_IMPORT'`, **`created_at` = Sheets-dəki əsl tarix**, bax Target Architecture bölmə 4) və (varsa) `dma_application_status_history` (`source='MANUAL_IMPORT'` işarəli tarixi status keçidləri) cədvəllərinə köçürür.

### Frontend
Yoxdur (skript, UI deyil).

### Mövcud sistemə risklər
- **Orta-yüksək.** İki mərkəzi trigger funksiyasına `CREATE OR REPLACE` — diqqətli test tələb edir. `source='FORM'`/`'DMA_REFERRAL'`/`'MANUAL'` üçün davranış **1:1 saxlanılmalıdır** (aşağıdakı test ssenarisi 1-2 bunu doğrulayır).
- Böyük həcmli INSERT-lər — Supabase-in sorğu/timeout limitlərinə görə partiyalarla (batch) edilməlidir.

### Test ssenariləri
1. **Reqressiya:** trigger dəyişikliyindən DƏRHAL sonra, `source='FORM'` ilə adi bir müraciət göndərilir → əvvəlki kimi `eligibility_status`/`current_status` avtomatik hesablanır (dəyişməyib).
2. **Reqressiya:** `interview_attended='NO'` təyin edilir (`source='FORM'` sətirdə) → `interview_result` əvvəlki kimi avtomatik `FAILED` olur.
3. `source='MANUAL_IMPORT'` ilə `eligibility_status='ELIGIBLE'`, `current_status='GRADUATED'` göndərilir → **override EDİLMİR**, olduğu kimi qalır.
4. `source='MANUAL_IMPORT'`, `interview_attended='NO'`, `interview_result='RESERVE'` göndərilir → **`interview_result` FAILED-ə DÖNÜŞMÜR**, `RESERVE` olaraq qalır.
5. Dublikat FİN-li iki Sheets sətri staging-ə yüklənir → `validation_state='DUPLICATE'` kimi işarələnir, real cədvəllərə YAZILMIR.
6. Naməlum status adı olan sətir → `validation_state='REVIEW_NEEDED'`, bloklanmır, əl ilə baxılana qədər gözləyir.
7. İdxaldan sonra: `dma_application_status_history`-də idxal edilmiş sətirlərin `source='MANUAL_IMPORT'` işarəsi ilə canlı sətirlərdən **ayırd edilə bildiyi** yoxlanılır.

### Rollback
- Trigger funksiyaları əvvəlki (`CREATE OR REPLACE` ilə, V1-dəki orijinal koda) qaytarılır.
- İdxal edilmiş sətirlər `source='MANUAL_IMPORT'` filtri ilə identifikasiya edilib, lazım gələrsə silinə bilər (`dma_import_staging`-dəki `imported_application_id` izləmə sütunu bunun üçün dəqiq siyahı verir).

### Acceptance criteria
- Canlı (`FORM`/`DMA_REFERRAL`/`MANUAL`) axın **HEÇ DƏYİŞMƏYİB** (reqressiya testləri 1-2 keçir).
- Bütün tarixi sətirlər `source='MANUAL_IMPORT'` və düzgün, əsl tarixi `created_at` ilə mövcuddur.
- Dublikat/uyğunsuz sətirlər bloklanmadan, aydın işarələnərək saxlanılıb.

---

## Faza 8 — `updated_at` bug-fix trigger-ləri

### Database
```sql
-- YALNIZ TƏKLİF, İCRA EDİLMƏYİB
create trigger set_exam_sessions_updated_at before update on public.dma_exam_sessions
  for each row execute function public.dma_set_updated_at();
create trigger set_interview_sessions_updated_at before update on public.dma_interview_sessions
  for each row execute function public.dma_set_updated_at();
create trigger set_training_groups_updated_at before update on public.dma_training_groups
  for each row execute function public.dma_set_updated_at();
create trigger set_attendance_records_updated_at before update on public.dma_attendance_records
  for each row execute function public.dma_set_updated_at();
```

### Backend/Frontend
Yoxdur.

### Mövcud sistemə risklər
Çox aşağı — bu sütun heç bir mövcud kodda oxunmur/filtrlənmir (V1 auditdə təsdiqlənib), ona görə dəyərinin dəyişməsi heç bir görünən effekt yaratmır, yalnız məlumatı düzəldir.

### Test ssenariləri
Bir imtahan slotunun `capacity`-si dəyişdirilir → `updated_at` indi düzgün yenilənir (əvvəllər donmuşdu).

### Rollback
```sql
drop trigger set_exam_sessions_updated_at on public.dma_exam_sessions;
-- (digər 3-ü də eyni şəkildə)
```

### Acceptance criteria
4 cədvəlin `updated_at`-i artıq real dəyişiklik vaxtını əks etdirir.

---

## Faza 9 — Server-side Dashboard

### Database
```sql
-- KONSEPTUAL, YALNIZ TƏKLİF — dəqiq sahələr implementasiya zamanı razılaşdırılır
create or replace function public.get_dashboard_summary()
returns table (...) language sql stable security invoker set search_path = '' as $$ ... $$;
```

### Backend
Yoxdur (birbaşa RPC çağırışı frontend-dən).

### Frontend
`admin/index.html`-in `renderDashboard()` funksiyası `get_dashboard_summary()` RPC-sini çağıracaq şəkildə yenidən yazılır; köhnə client-side limitsiz `dma_applications` yükləməsi YALNIZ Dashboard üçün aradan qalxır (digər səhifələr toxunulmur).

### Mövcud sistemə risklər
Aşağı-orta — yalnız bir səhifənin (Dashboard) daxili məntiqi dəyişir, digər 6 admin səhifəsi toxunulmur.

### Test ssenariləri
Dashboard-un yeni RPC ilə göstərdiyi rəqəmlər, köhnə client-side hesablama ilə (keçid dövründə paralel) müqayisə edilir, uyğunluq təsdiqlənir.

### Rollback
Frontend-i köhnə `renderDashboard()` versiyasına qaytarmaq (RPC-ni silmək məcburi deyil, sadəcə istifadə olunmur).

### Acceptance criteria
Dashboard bütün yeni modulları (sertifikat tamamlanma faizi, işədüzəlmə sayı və s.) əhatə edir, səhifə yüklənməsi əvvəlkindən sürətli/bərabərdir.

---

## V2.1 (bu planın əhatəsindən kənar, gələcək üçün qeyd)

Proqram-səviyyəli RLS (`dma_program_staff`), `dma_programs` CRUD UI, çəki-cəmi DB-səviyyəli validasiyası, strukturlaşdırılmış `dma_teachers`. Bunlar ayrıca, bu sənədin formatına uyğun planlaşdırılmalıdır, hazırkı 9 fazaya daxil edilmir.

---

## Ümumi qeyd: fazaların sırası haqqında

Fazalar **1→9** ardıcıllıqla göstərilib, amma **6 və 7 bir-birindən asılı deyil** (istənilən sırada ola bilər, hər ikisi öz `source` bypass-ı ilə işləyir) — məntiqi rahatlıq üçün yan-yana qoyulub. **2, 3, 4, 5 bir-birindən TAM müstəqildir**, paralel və ya istənilən sırada aparıla bilər. Yalnız **Faza 4, Faza 1-dən (bax `assessment_scheme_id` FK) asılıdır**, **Faza 6/7, Faza 1-dən (`source`, `dma_config`) asılıdır**.

Heç bir addım hələ tətbiq edilməyib.
