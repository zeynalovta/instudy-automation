# INSTUDY ERP V2 — Target Architecture

**Status:** Yalnız arxitektura təklifidir. **Heç bir kod, cədvəl, trigger, RLS və mövcud məlumat dəyişdirilməyib. Heç bir SQL icra olunmayıb. Commit/push edilməyib.**
**Versiya:** v3 — FINAL (bütün açıq qərar nöqtələri bağlanıb). Implementasiya planı ayrıca sənəddədir: `audit/INSTUDY_ERP_V2_IMPLEMENTATION_PLAN.md`.
**Əsas mənbə:** `audit/INSTUDY_ERP_TECHNICAL_AUDIT.md`, `audit/INSTUDY_ERP_DATABASE_SCHEMA.sql`, `audit/INSTUDY_ERP_DATA_DICTIONARY.csv`, `audit/INSTUDY_ERP_MIGRATION_READINESS.md`.
**Əsas prinsip:** Mövcud 10 `dma_*` cədvəlinin strukturu və davranışı **dəyişməz qalır** (yalnız bəzilərinə **nullable, geriyə-uyğun** sütunlar əlavə olunur). Bütün yeni funksionallıq ya yeni cədvəllərlə, ya da mövcud cədvəllərə əlavə sütunlarla qurulur. **Yalnız Faza 6 (təkrar müraciət qaydası) canlı istifadəçi davranışını real dəyişir** — bu, açıq şəkildə işarələnib.

---

## 0. Biznes tələbləri → texniki tərcümə (yekun)

| # | Tələb | Yekun qərar |
|---|---|---|
| 1 | Lid sayı | Dəyişiklik yox |
| 2 | DMA-referral | "+ Yeni müraciət əlavə et", `source` sütunu, standart trigger axını, override-üçün ayrıca icazə səviyyəsi (bölmə 3) |
| 3 | Proqram sheet-ləri | Dəyişməz (bölmə 6) |
| 4 | İmtahan-müsahibə | Dəyişməz |
| 5 | DMA qruplar | Dəyişməz |
| 6 | Davamiyyət + müəllim | `dma_class_sessions`, gözlənilən=snapshot, faktiki=əl ilə, **dərs statusu ayrıca** (bölmə 2.1) |
| 7 | Qiymətləndirmə | `dma_assessment_schemes/components/student_assessment_results`, keş sütun + avtomatik trigger (bölmə 2.2) |
| 8 | İşədüzəlmə jurnalı | `dma_employment_contacts` (dəyişməz) |
| 9 | Dashboard | Server-side aqreqasiya (dəyişməz) |
| 10 | Təkrar müraciət | `dma_config` + yeni trigger, RESERVE_LIST aktiv, cutover tarixi sənədləşdirilir (bölmə 5) |

---

## 1. Mövcud 10 cədvəl üzrə qərar (dəyişməz, V1/V2-dən)

### 1.1 Dəyişməz saxlanılır
`dma_programs`, `dma_candidates`, `dma_exam_sessions`, `dma_exam_bookings`, `dma_interview_sessions`, `dma_interview_bookings`, `dma_training_groups` (bir sütun əlavəsi istisna olmaqla), `dma_attendance_records`.

### 1.2 Genişləndirilir (nullable/defoltlu sütun əlavəsi, YEKUN siyahı)

| Cədvəl | Yeni sütun(lar) |
|---|---|
| `dma_applications` | `source text not null default 'FORM' check (source in ('FORM','DMA_REFERRAL','MANUAL','MANUAL_IMPORT'))` |
| `dma_applications` | `eligibility_override_reason text`, `eligibility_overridden_by text`, `eligibility_overridden_at timestamptz` |
| `dma_applications` | `final_certificate_score numeric` — **keş sütun**, əsas mənbə `dma_student_assessment_results` (bölmə 2.2) |
| `dma_training_groups` | `assessment_scheme_id bigint references dma_assessment_schemes(id)` |

`dma_application_status_history.note` sütunu **artıq mövcuddur** (V1-dən), struktur dəyişikliyi yoxdur, yalnız real istifadəyə verilir (bölmə 3.2).

### 1.3 Yeni cədvəllər (YEKUN)

1. `dma_class_sessions` (bölmə 2.1)
2. `dma_assessment_schemes`, `dma_assessment_components`, `dma_student_assessment_results` (bölmə 2.2)
3. `dma_employment_contacts` (dəyişməz)
4. `dma_config` (bölmə 5)
5. `dma_import_staging` (bölmə 4)

---

## 2. Yeni cədvəllərin dizaynı

### 2.1 `dma_class_sessions` — YEKUN (dərs statusu əlavə olundu)

**Yeni qayda (bu turdan):** "Dərs keçirilməyibsə, 0% davamiyyət kimi hesablanmamalıdır." Bu, ayrıca bir **dərs statusu** sütunu tələb edir.

```sql
-- YALNIZ TƏKLİF, İCRA EDİLMƏYİB
create table public.dma_class_sessions (
  id                      bigint generated always as identity primary key,
  training_group_id       bigint not null references public.dma_training_groups(id),
  session_date            date not null,
  session_status          text not null default 'HELD'
    check (session_status in ('HELD','CANCELLED')),
  teacher_name            text,
  teacher_attended        boolean,            -- yalnız session_status='HELD' üçün mənalıdır
  expected_attendee_count integer,            -- avtomatik snapshot, YALNIZ INSERT zamanı, YALNIZ HELD üçün
  actual_attendee_count   integer,            -- əməkdaş tərəfindən əl ilə, YALNIZ HELD üçün doldurulur
  planned_topic           text,
  notes                   text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (training_group_id, session_date)
);

alter table public.dma_class_sessions enable row level security;

create or replace function public.dma_class_sessions_snapshot_expected()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- Dərs keçirilməyibsə (CANCELLED), gözlənilən/faktiki sayı SIFIRA
  -- YOX, NULL-A saxlayırıq -- "0%" YOX, "tətbiq olunmur" mənasını versin.
  if new.session_status = 'CANCELLED' then
    new.expected_attendee_count := null;
    new.actual_attendee_count := null;
    return new;
  end if;

  if new.expected_attendee_count is null then
    select count(*) into new.expected_attendee_count
    from public.dma_applications
    where training_group_id = new.training_group_id
      and current_status = 'ENROLLED';
  end if;
  return new;
end;
$$;

create trigger trg_class_sessions_snapshot_expected
before insert on public.dma_class_sessions
for each row execute function public.dma_class_sessions_snapshot_expected();

create trigger set_class_sessions_updated_at
before update on public.dma_class_sessions
for each row execute function public.dma_set_updated_at();

create policy "admins_can_manage_class_sessions"
on public.dma_class_sessions for all to authenticated
using ((select public.has_scope('dma')))
with check ((select public.has_scope('dma')));
```

**Hesablama qaydası (göstərilən zaman, saxlanmır) — YENİLƏNDİ:**

```
Əgər session_status = 'CANCELLED':
    göstər: "Dərs keçirilməyib" (heç bir faiz, 0% DEYİL)
Əgər session_status = 'HELD':
    absent_count   = expected_attendee_count - actual_attendee_count
    attendance_pct = round(actual_attendee_count * 100.0 / nullif(expected_attendee_count, 0), 1)
    (əgər actual_attendee_count hələ daxil edilməyibsə (NULL): "gözlənilir", faiz göstərilmir)
```

**Aqreqat hesabatlarda (qrup üzrə ortalama davamiyyət, Dashboard):** yalnız `session_status='HELD'` sətirlər nəzərə alınır, `CANCELLED` sətirlər həm sayğaca, həm cəmə daxil edilmir (istisna olunur, sıfır kimi sayılmır).

Qalan qaydalar (snapshot yalnız `INSERT`-də, sonrakı xaricolmaların keçmiş dərsə təsir etməməsi) **dəyişməz** qalır.

### 2.2 Qiymətləndirmə modeli — YEKUN (keş trigger-i əlavə olundu)

Cədvəl strukturları (`dma_assessment_schemes`, `dma_assessment_components`, `dma_student_assessment_results`) **əvvəlki versiyadan dəyişməz** qalır (bax əvvəlki bölmə, təkrar edilmir). Yalnız yekun balın yenilənmə mexanizmi İNDİ QƏTİLƏŞDİRİLİB:

**Qərar:** `dma_applications.final_certificate_score` — **keş sütundur**. Əsas mənbə həmişə `dma_student_assessment_results` (+ `dma_assessment_components`-dəki çəkilər) olaraq qalır. Nəticələr dəyişdikdə keş **avtomatik** yenilənir:

```sql
-- YALNIZ TƏKLİF, İCRA EDİLMƏYİB
-- Bu, dma_applications-ın MÖVCUD 4 trigger-inə YOX, YENİ dma_student_assessment_results
-- cədvəlinə qoyulan bir trigger-dir -- yalnız BİR sahəyə (final_certificate_score) UPDATE edir.
create or replace function public.recalculate_final_certificate_score()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_application_id bigint;
  v_score numeric;
begin
  v_application_id := coalesce(new.application_id, old.application_id);

  select sum(r.score / c.max_score * c.weight_pct)
  into v_score
  from public.dma_student_assessment_results r
  join public.dma_assessment_components c on c.id = r.component_id
  where r.application_id = v_application_id;

  update public.dma_applications
  set final_certificate_score = v_score
  where id = v_application_id;

  return coalesce(new, old);
end;
$$;

create trigger trg_recalculate_final_certificate_score
after insert or update or delete on public.dma_student_assessment_results
for each row execute function public.recalculate_final_certificate_score();
```

**Qeyd (hesablama məntiqi haqqında, şəffaflıq üçün):** yuxarıdakı `SUM` yalnız HAZIRDA QEYD OLUNMUŞ komponentləri cəmləyir — bütün komponentlər doldurulanda bu, düzgün yekun baldır; hələ tam doldurulmayıbsa, bu, "indiyədək toplanan çəkili bal"dır (proqres göstəricisi kimi oxuna bilər). Tam/natamamlıq statusu üçün ayrıca bir bayraq (`assessment_complete boolean`) **bu mərhələdə əlavə edilmir** — lazım olarsa V2.1-də asanlıqla əlavə edilə bilər.

**Qrup ↔ Sxem əlaqəsi:** dəyişməz, `dma_training_groups.assessment_scheme_id` bir dəfə təyin olunur, "sonrakı dəyişikliklər əvvəlki məzunların nəticələrinə təsir etmir" tələbi FK strukturu ilə təmin olunur (əvvəlki bölməyə bax).

---

## 3. DMA-referral namizədlər və Eligibility Override — YEKUN

### 3.1 "+ Yeni müraciət əlavə et" — YENİ MEMARLIQ QƏRARI: backend endpoint, birbaşa client-insert DEYİL

**Vacib arxitektural tapıntı:** V1 sxem araşdırmasına görə, `dma_applications`-a **`authenticated` rolu üçün heç bir INSERT GRANT/POLICY mövcud deyil** — yalnız `select` və `update` icazələri var (V1 Texniki Audit, RLS bölməsi). Bunun mənası: hazırda **yeganə** yol namizəd/müraciət yaratmaq `api/dma/apply.js`-dir, o da **service-role** açarı ilə, RLS-i keçərək işləyir. Admin panelin özü (brauzerdən `authenticated` client ilə) heç vaxt birbaşa `dma_applications`-a `insert` etmir.

**Bu, Tələb #4-ü ("MANUAL_IMPORT UI-də gizlətmək kifayət deyil, API/DB səviyyəsində bloklanmalıdır") HƏLL EDİR, əlavə RLS mexanizmi olmadan:**

- **"+ Yeni müraciət əlavə et"** YENİ bir backend endpoint-dir: `api/dma/manual-application.js` (təklif olunan ad). Bu, `api/dma/apply.js` ilə EYNİ FİN-tap-ya-yarat + eligibility-trigger axınından keçən, service-role ilə işləyən bir funksiyadır, AMMA:
  1. **Authenticated staff sessiyası tələb edir** — sorğu ilə gələn Supabase Auth token-i server-side yoxlanılır (`supabase.auth.getUser(token)`), `role='admin'` və `has_scope('dma')` təsdiqlənmədən heç nə etmir. (Bu, `api/dma/apply.js`-də YOXDUR — o, qəsdən açıqdır, ictimai formadır.)
  2. **`source` sahəsini ALLOWLİST edir:** yalnız `'DMA_REFERRAL'` və `'MANUAL'` qəbul edir. İstənilən başqa dəyər (o cümlədən `'MANUAL_IMPORT'`) **400 xətası** ilə rədd edilir — client-dən gələn `source` dəyəri heç vaxt birbaşa DB-yə ötürülmür, serverdə bir `if (!["DMA_REFERRAL","MANUAL"].includes(source)) return 400` yoxlaması var.
- **`api/dma/apply.js`** (mövcud, ictimai) `source`-u **HEÇ QƏBUL ETMİR** — həmişə `'FORM'` sərtdir (kod səviyyəsində sabit qiymət, client-dən gələn heç bir sahə ilə əvəzlənmir).
- **`source='MANUAL_IMPORT'`** yalnız bölmə 4-dəki **ayrıca, veb-də ekspozisiya olunmayan** miqrasiya skriptində istifadə olunur — bu skript **API endpoint deyil** (Vercel-də marşrut kimi deploy edilmir), yalnız məhdud girişli bir operator tərəfindən, birbaşa service-role açarı ilə, lokal/təhlükəsiz mühitdə işə salınan ayrıca bir proqramdır.

**Nəticə:** `MANUAL_IMPORT` dəyərinə "adi staff-ın çatması" memarlıq səviyyəsində **mümkün deyil** — nə UI-də seçim var, nə API-lərdən biri onu qəbul edir, nə də brauzerdən DB-yə birbaşa yazma yolu mövcuddur (`authenticated` üçün INSERT policy yoxdur). Bu, "sadəcə UI-də gizlətmək" DEYİL, üç aydın qatın (UI, API allowlist, DB-də insert-grant yoxluğu) birləşməsidir.

### 3.2 Eligibility Override — YALNIZ Admin/Manager, tam audit tarixçəsi ilə

**Yeni tələb:** override hüququ **yalnız Admin/Manager səviyyəsində**, adi DMA staff bunu edə bilməməlidir, RPC bunu **özü** yoxlamalıdır (UI-dəki düymənin gizlədilməsinə etibar etmədən).

**Access-control dizaynı:** mövcud `role`/`staff_scope` modelinə **YENİ bir JWT `app_metadata` bayrağı** əlavə olunur (heç bir mövcud claim-ə toxunmadan, sadəcə əlavə): `app_metadata.can_override_eligibility: true`. Yalnız Admin/Manager hesablarına bu bayraq əl ilə verilir (indiki iki istifadəçini əlavə etdiyimiz kimi, Supabase Auth Admin API/Dashboard ilə).

```sql
-- YALNIZ TƏKLİF, İCRA EDİLMƏYİB
create or replace function public.can_override_eligibility()
returns boolean
language sql stable set search_path = '' as $$
  select coalesce(
    (select public.is_admin())
    and (auth.jwt() -> 'app_metadata' ->> 'can_override_eligibility')::boolean is true,
    false
  );
$$;

revoke all on function public.can_override_eligibility() from public;
grant execute on function public.can_override_eligibility() to authenticated;
```

**RPC — DB-səviyyəli authorization yoxlaması ilə, tam audit sahələri ilə:**

```sql
-- YALNIZ TƏKLİF, İCRA EDİLMƏYİB
create or replace function public.record_eligibility_override(
  p_application_id bigint,
  p_new_status text,
  p_reason text
)
returns void
language plpgsql
security invoker      -- YÜKSƏLDİLMİŞ İCAZƏ YOXDUR -- çağıranın öz RLS-i tətbiq olunur
set search_path = ''
as $$
declare
  v_history_id bigint;
  v_old_status text;
  v_staff_email text;
begin
  -- 1) DB-SƏVİYYƏLİ AUTHORIZATION YOXLAMASI -- UI-dən asılı deyil.
  if not (select public.can_override_eligibility()) then
    raise exception 'NOT_AUTHORIZED: yalnız Admin/Manager eligibility override edə bilər';
  end if;

  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'REASON_REQUIRED: override üçün səbəb mütləqdir';
  end if;

  select current_status into v_old_status
  from public.dma_applications where id = p_application_id;

  v_staff_email := auth.jwt() ->> 'email';

  -- 2) Əsas dəyişiklik (mövcud RLS/trigger-lər olduğu kimi tətbiq olunur --
  --    application_status_change_trigger avtomatik history sətri yaradacaq,
  --    old_status/new_status/changed_at artıq bununla düzgün qeyd olunur).
  update public.dma_applications
  set current_status = p_new_status,
      eligibility_override_reason = p_reason,
      eligibility_overridden_by = v_staff_email,
      eligibility_overridden_at = now()
  where id = p_application_id;

  -- 3) Avtomatik yaranan history sətrini SƏBƏBLƏ tamamlayırıq
  --    (old_status, new_status, changed_at artıq trigger tərəfindən yazılıb --
  --    "əvvəlki və yeni qərar, tarix və vaxt" tələbi buna görə TRIGGER-DƏN gəlir,
  --    burada yalnız "kim və niyə" əlavə olunur).
  select id into v_history_id
  from public.dma_application_status_history
  where application_id = p_application_id
  order by changed_at desc, id desc
  limit 1;

  if v_history_id is not null then
    update public.dma_application_status_history
    set note = format('OVERRIDE by %s: %s', v_staff_email, p_reason)
    where id = v_history_id;
  end if;
end;
$$;

revoke all on function public.record_eligibility_override(bigint, text, text) from public;
grant execute on function public.record_eligibility_override(bigint, text, text) to authenticated;
```

**Audit tələbinin tam qarşılanması:**
- **Səbəb** → `p_reason`, həm `dma_applications.eligibility_override_reason`-da (son override-in sürətli görünüşü), həm `dma_application_status_history.note`-da (tam tarixçə, hər override üçün ayrıca sətir).
- **İcra edən şəxs** → `auth.jwt() ->> 'email'`, `eligibility_overridden_by` + history note-un içində.
- **Əvvəlki və yeni qərar** → `dma_application_status_history.old_status`/`new_status` (mövcud, avtomatik trigger tərəfindən artıq düzgün doldurulur — struktur dəyişikliyi yoxdur).
- **Tarix və vaxt** → `dma_application_status_history.changed_at` (mövcud, avtomatik) + `eligibility_overridden_at` (sürətli görünüş üçün əlavə).

**Niyə `SECURITY INVOKER` kifayətdir (DEFINER lazım deyil):** RPC daxilindəki `UPDATE` çağıranın öz `authenticated` roluyla işləyir və mövcud `admins_can_update_applications` RLS policy-sinə (`has_scope('dma')`) hələ də tabedir. Yeni `can_override_eligibility()` yoxlaması bunun ÜSTÜNƏ əlavə, DAHA DAR bir qapıdır — yəni "DMA scope-u olan, AMMA override icazəsi olmayan" bir staff bu RPC-ni çağıra bilməyəcək (funksiyanın özü rədd edəcək), halbuki adi status dəyişikliyini (öz mövcud yolu ilə) etməyə davam edə biləcək. Bu, minimal, təcrid olunmuş bir icazə təbəqəsidir.

---

## 4. Tarixi statusların trigger-lər tərəfindən dəyişdirilməsi — MİQRASİYA STRATEGİYASI (dəyişməz)

`source='MANUAL_IMPORT'` əsaslı, daimi bypass (`applications_set_eligibility()`, `applications_interview_attendance_result()` funksiyalarına 3 sətirlik şərt), `dma_import_staging` keçid cədvəli. **YENİ ƏLAVƏ (bu turdan):** idxal skripti `dma_applications.created_at`-i **idxal edilən ANIN yox, Sheets-dəki ƏSL tarixi müraciət tarixinin** özü ilə doldurmalıdır — bu, bölmə 5-dəki təkrar-müraciət cooldown hesablamasının tarixi olaraq DA DÜZGÜN işləməsi üçün vacibdir (aşağı bax).

---

## 5. Təkrar müraciət siyasəti — YEKUN

### 5.1–5.3 (dəyişməz): tarixi miqrasiya istisnası, aktiv-müraciət qaydası, 90 günlük cooldown, iki qatlı tətbiq (kod + DB trigger)

Bunlar əvvəlki versiyada təsvir olunduğu kimi qalır. **Yeganə dəyişiklik:** `RESERVE_LIST` artıq açıq sual DEYİL — **QƏTİ OLARAQ aktiv sayılır** (terminal statuslar siyahısında YOXDUR). Terminal statuslar (dəyişməz): `NOT_ELIGIBLE`, `EXAM_FAILED`, `EXAM_NO_SHOW`, `INTERVIEW_FAILED`, `INTERVIEW_NO_SHOW`, `DMA_REJECTED`, `EXPELLED`, `GRADUATED`, `DECLINED`.

### 5.4 Cutover tarixi — AYDINLAŞDIRILDI

**Konseptual aydınlıq:** "cutover" texniki olaraq **Faza 6-nın (bölmə 9, İmplementasiya Planı) canlıya çıxdığı andır** — yəni `applications_enforce_reapplication_policy` trigger-i Supabase-də AKTIV OLDUĞU AN. Bu tarixdən ƏVVƏL yaradılmış heç bir sətir (istər tarixi idxal, istər adi canlı müraciətlər) bu qaydaya görə YOXLANILMAYIB; bu andan SONRA yaradılan HƏR `source != 'MANUAL_IMPORT'` sətir yoxlanılır.

**Vacib texniki nüans (aydınlaşdırılmalı idi, indi izah olunur):** cooldown yoxlaması (`select max(created_at) ...`) **BÜTÜN mövcud sətirlərə** baxır, `source`-dan asılı olmadan — yəni **tarixi idxal edilmiş bir müraciət DƏ** gələcək bir canlı müraciət üçün "son müraciət tarixi" sayıla bilər. Bu, MƏQSƏDLİDİR: əgər bir namizəd 2 il əvvəl (Sheets-də) eyni proqrama müraciət edibsə və bu, `MANUAL_IMPORT` kimi düzgün tarixlə (bölmə 4-dəki YENİ tələb) idxal olunubsa, həmin şəxs ERP-də CANLI olaraq YENİDƏN müraciət etmək istəsə, sistem onun **əsl son müraciət tarixini** (2 il əvvəl) görəcək və 90 gün artıq keçdiyi üçün icazə verəcək. **Yalnız idxalın ÖZÜ (`source='MANUAL_IMPORT'` sətrinin yaradılması) bu yoxlamadan azaddır — idxal edilmiş sətirlər ÖZLƏRİ gələcək yoxlamalar üçün tammənalı "tarix nöqtəsi" olaraq qalır.**

**`dma_config`-a sənədləşdirmə məqsədli qeyd (funksional olaraq trigger-ə lazım deyil, amma audit/hesabat üçün faydalıdır):**

```sql
insert into public.dma_config (key, value, description) values
  ('erp_cutover_date', '<implementasiya zamanı təyin olunacaq tarix>',
   'Faza 6 (təkrar müraciət trigger-i) canlıya çıxdığı tarix -- sənədləşdirmə məqsədlidir, trigger məntiqinin özü bu tarixdən asılı deyil, yalnız deploy olunduğu andan hər insert-ə tətbiq olunur.');
```

### 5.5 Konfiqurasiya (dəyişməz)

`dma_config.reapplication_cooldown_days` (defolt 90), Supabase Table Editor ilə dəyişdirilə bilər.

---

## 6–8. (dəyişməz)

Proqram sheet-ləri (bölmə 6), Dashboard (bölmə 7) və ERD-nin qalan hissəsi (bölmə 8) əvvəlki versiyadan **dəyişməz** qalır. Yalnız ERD-yə `dma_class_sessions.session_status` sahəsi əlavə olunmalıdır (kosmetik, implementasiya sənədində əks olunacaq).

---

## 9. Açıq sual qalmadı

Əvvəlki 3 kiçik açıq sual (RESERVE_LIST, override icazəsi, keş mexanizmi) bu sənədlə **tam bağlandı**. Yeni, XIRDA texniki qeydlər (implementasiya sənədində ətraflı):
- `api/dma/manual-application.js`-in server-side auth yoxlaması (Supabase JWT token doğrulaması) implementasiya zamanı dəqiq kodlaşdırılmalıdır.
- Miqrasiya skriptinin **harada** işə salınacağı (lokal maşın, ayrıca CI job, əl ilə) — implementasiya mərhələsində qərarlaşdırılmalıdır, bu, arxitekturaya təsir etmir.

**Növbəti addım:** `audit/INSTUDY_ERP_V2_IMPLEMENTATION_PLAN.md` — bu arxitekturanın faza-faza, konkret DB/Backend/Frontend dəyişiklikləri, risklər, test ssenariləri, rollback planı və qəbul meyarları ilə.
