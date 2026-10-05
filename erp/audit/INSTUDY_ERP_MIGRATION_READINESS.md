# INSTUDY ERP — Google Sheets → ERP Miqrasiya Hazırlığı

**Status:** Read-only analiz. Heç bir miqrasiya, ALTER, INSERT icra edilməyib.
**Əsas mənbə:** [INSTUDY_ERP_TECHNICAL_AUDIT.md](INSTUDY_ERP_TECHNICAL_AUDIT.md) və [INSTUDY_ERP_DATABASE_SCHEMA.sql](INSTUDY_ERP_DATABASE_SCHEMA.sql).
**Qeyd:** Bu sənəd Google Sheets-in real strukturunu GÖRMƏYİB — yalnız ERP tərəfinin nəyi qəbul etməyə hazır/hazır olmadığını qiymətləndirir. Sheets-in öz sütun adları/formatı fərqli AI-ya təqdim edildikdə, aşağıdakı "uyğun table" xəritəsi ilə əl-ələ tutuşdurulmalıdır.

---

## 1. Kateqoriya → Table xəritəsi

| Sheets məlumat kateqoriyası | Uyğun ERP table/sütun | Hazırlıq | Qeyd |
|---|---|---|---|
| Ad, soyad, FİN, doğum tarixi, telefon, e-poçt, ünvan, təhsil | `dma_candidates` (full_name, fin, birth_date, whatsapp_phone, email, address, education) | **Hazır** | `fin` UNIQUE — idxaldan əvvəl Sheets-də dublikat FİN yoxlanmalıdır, əks halda hər dublikat sətir REDDOLUNACAQ (bax bölmə 3) |
| Tələbəlik/işçilik/VÖEN statusu | `dma_candidates.is_student/is_employed/has_active_voen`, `attended_dma_course_last_12_months` | **Hazır** | boolean tipdir; Sheets-də "Bəli/Xeyr" mətni varsa çevrilmə (mapping) lazımdır |
| Proqram üzrə müraciət | `dma_applications` (candidate_id, program_id) | **Hazır, DİQQƏTLƏ** | bax bölmə 2 — trigger-lər INSERT zamanı `eligibility_status`/`current_status`/`eligibility_reason`-u AVTOMATIK YAZIR, sizin idxal etdiyiniz tarixi status DƏYƏRİ ilə toqquşa bilər |
| Uyğunluq nəticəsi (əl ilə və ya avtomatik) | `dma_applications.eligibility_status`, `eligibility_reason` | **Qismən hazır** | eyni səbəbdən — trigger override edəcək (bax bölmə 2) |
| Pipeline statusu (hazırkı mərhələ) | `dma_applications.current_status` | **Qismən hazır** | CHECK constraint 27 dəyərlə məhduddur; Sheets-dəki status adları bu 27 dəyərə map edilməlidir, uyğun gəlməyən sətir tam INSERT-i REDDEDƏCƏK |
| İmtahan tarixi/balı | `dma_applications.exam_scheduled_at`, `exam_score` | **Hazır** | `exam_score` dəyişəndə trigger `current_status`-u YENİDƏN YAZIR (>=30 → INTERVIEW_INVITED, <30 → EXAM_FAILED) — tarixi "EXAM_PASSED" kimi bir status idxal etsəniz belə, sonradan balı yeniləsəniz trigger onu üstələyəcək |
| Müsahibə tarixi/nəticəsi/gəlib-gəlmədiyi | `dma_applications.interview_scheduled_at`, `interview_attended`, `interview_result` | **Hazır** | `interview_attended='NO'` yazsanız, trigger `interview_result`-u avtomatik `FAILED` edəcək — bu, tarixi "RESERVE" kimi bir nəticəni SİLƏ bilər (bax bölmə 2) |
| Qrup təyinatı | `dma_training_groups` + `dma_applications.training_group_id` | **Qismən hazır** | qrupu əvvəlcə `dma_training_groups`-a yaratmaq, sonra `id`-lərini `dma_applications`-a bağlamaq lazımdır (iki mərhələli idxal) |
| Davamiyyət tarixçəsi | `dma_attendance_records` | **Hazır** | `unique(training_group_id, application_id, session_date)` — eyni günə iki sətir idxal etsəniz, ikincisi rədd olunar (əgər sadə `insert`lə edilirsə) və ya `upsert` istifadə edilməlidir |
| Sertifikat nəticələri | — | **MISSING** | Heç bir cədvəl/sahə yoxdur. Miqrasiyadan əvvəl ya yeni cədvəl (`dma_certificates`) əlavə edilməli, ya da bu məlumat `general_note`-a sərbəst mətn kimi (keyfiyyətsiz) yazılmalıdır |
| İşədüzəlmə məlumatları | `dma_applications.employment_status/employment_note/employed_at` | **Hazır** | yalnız `ENROLLED`/`GRADUATED` statusundakılar üçün mənalıdır |
| Tarixi qeydlər / əlaqə tarixçəsi (çoxsaylı, tarixləşdirilmiş) | `dma_applications.general_note`, `interview_note` | **Uyğun deyil (struktur fərqi)** | ERP-də hər müraciət üçün YALNIZ BİR ümumi qeyd sahəsi var — tarixləşdirilmiş, çoxsaylı qeyd jurnalı (Sheets-də adətən "13.03 - zəng edildi, 15.03 - sənəd tələb olundu" formatında olur) strukturu YOXDUR. İdxal zamanı bu tarixçə ya bir sətirdə birləşdirilməli (mətn itkisi ilə), ya da yeni bir `dma_notes` cədvəli əlavə edilməlidir |
| Status dəyişikliklərinin öz tarixçəsi | `dma_application_status_history` | **Qismən uyğun** | bu cədvəl YALNIZ trigger vasitəsilə, REAL VAXTDA yazılır (`AFTER INSERT`/`AFTER UPDATE OF current_status`) — Sheets-dəki KEÇMİŞ tarixçəni bu cədvələ birbaşa yazmaq mümkündür (adi INSERT ilə), amma bu, gələcək analiz üçün "sistem" tərəfindən yaradılan sətirlərlə "əl ilə idxal edilən" sətirləri fərqləndirməyəcək (mənbəni ayıran sütun yoxdur) |

---

## 2. KRİTİK RİSK: trigger-lər idxal zamanı sizin göndərdiyiniz dəyərləri override edə bilər

Bu, miqrasiyanın **ən böyük texniki riskidir** və ətraflı izaha layiqdir.

`dma_applications` cədvəlində **4 trigger** var (tam kod [INSTUDY_ERP_DATABASE_SCHEMA.sql](INSTUDY_ERP_DATABASE_SCHEMA.sql)-də):

1. **`trg_applications_set_eligibility`** (BEFORE INSERT) — hər yeni sətirdə `eligibility_status`, `current_status`, `eligibility_reason`-u namizədin `has_active_voen`/`is_student`/`is_employed`/`attended_dma_course_last_12_months`/yaşına görə **YENİDƏN HESABLAYIR** və SİZİN GÖNDƏRDİYİNİZ dəyəri **YAZIR ÜZƏRİNƏ** (bu, `NEW.*`-i INSERT-dən əvvəl dəyişən standart Postgres trigger davranışıdır — sizin INSERT sorğusunda bu sütunlara nə versəniz versin, trigger onu əvəz edəcək).
   - **Nəticə:** əgər Sheets-də bir namizəd tarixi olaraq "ELIGIBLE" statusunda idisə, amma bugünkü tarixlə yaşı artıq 35-i keçibsə, idxal zamanı trigger onu **"MANUAL_REVIEW_REQUIRED"** edəcək — tarixi doğru status YOX OLACAQ.
2. **`trg_applications_score_status`** (BEFORE UPDATE, yalnız `exam_score` dəyişəndə) — bal daxil edilsə/dəyişsə, `current_status`-u avtomatik dəyişir. Əgər idxal INSERT-də birbaşa `exam_score`-u dolu göndərirsə, bu trigger **INSERT-ə TƏSİR ETMİR** (yalnız UPDATE-ə bağlıdır) — amma sonradan hər hansı bir səbəbdən `exam_score` sahəsinə toxunulsa (məsələn ikinci idxal cəhdi, ya da admin UI-dən sadə bir redaktə), status yenidən yazılacaq.
3. **`trg_applications_interview_attendance_result`** (BEFORE INSERT OR UPDATE) — `interview_attended='NO'` olan HƏR sətirdə `interview_result`-u **məcburi `FAILED`** edir. Sheets-də "Gəlmədi, amma ehtiyat siyahısına salındı" kimi nüanslı bir tarixi nəticə varsa, bu, idxal zamanı sadəcə "FAILED"-ə düşəcək.
4. **`initial_application_status_trigger`** (AFTER INSERT) — hər INSERT-də `dma_application_status_history`-ə "yaradıldı" sətri yazır. Zərərsizdir, amma minlərlə tarixi sətir idxal edərkən minlərlə "saxta" tarixçə sətri yaradacaq (bax bölmə 4).

**Tövsiyə (mühakimə, tətbiq edilməyib):** Tarixi datanın idxalı üçün YA (a) idxaldan **əvvəl** bu 3 trigger-i müvəqqəti `DISABLE TRIGGER` etmək, sətirləri idxal etmək, sonra `ENABLE TRIGGER` ilə bərpa etmək (risk: yeni canlı müraciətlər idxal zamanı bu qorumadan məhrum qalar — idxal bir dəfəlik, qısa pəncərədə edilməlidir); YA DA (b) `applications_set_eligibility()` funksiyasına "əgər bu sətir idxal bayrağı ilə gəlirsə, override etmə" məntiqi əlavə etmək (kod dəyişikliyi tələb edir). Bunların hər ikisi **canlı sistemə toxunmadır**, bu auditin əhatəsindən kənardır — yalnız riski qeyd edirəm.

---

## 3. Dublikatın qarşısının alınması — mövcud mexanizmlər

| Səviyyə | Mexanizm | Əhatə |
|---|---|---|
| DB (cədvəl) | `dma_candidates.fin` UNIQUE | Eyni FİN ikinci dəfə `dma_candidates`-a yazıla bilmir (DB xətası: `23505 duplicate key`) |
| Tətbiq (API) | `api/dma/apply.js`-də əl ilə yoxlama: eyni `candidate_id`+`program_id` cütü `dma_applications`-da varsa, 409 xətası qaytarılır, INSERT edilmir | Yalnız bu API-dən keçəndə işləyir |
| DB (cədvəl) | `dma_attendance_records` unique(training_group_id, application_id, session_date) | Eyni gün üçün ikinci davamiyyət sətri (upsert-lə) yenilənir, dublikat yaranmır |
| DB (cədvəl) | `dma_interview_sessions` unique(program_id, starts_at) | Eyni proqram+vaxt üçün ikinci slot yaradıla bilmir |
| **YOXDUR** | `dma_applications`-da `(candidate_id, program_id)` üçün DB-səviyyəli UNIQUE constraint | **Əgər idxal `api/dma/apply.js`-i keçib birbaşa SQL/RPC ilə edilsə, dublikat müraciət YARANA BİLƏR** — bu, miqrasiya skripti üçün ayrıca diqqət tələb edir (idxaldan əvvəl `select distinct` və ya öz tətbiq-səviyyəli yoxlaması) |
| **YOXDUR** | `dma_exam_bookings`/`dma_interview_bookings`-da dublikat rezervasiya üçün DB-səviyyəli qorunma | Yalnız RPC-lərin öz məntiqi (əvvəlki aktiv rezervasiyanı `CANCELLED` edib yenisini yaradır) qoruyur — birbaşa `INSERT` bunu keçər |

---

## 4. Digər texniki risklər

1. **`dma_application_status_history` "çirklənməsi":** minlərlə tarixi müraciətin toplu idxalı, `initial_application_status_trigger` vasitəsilə eyni sayda "sistem yaratdı" sətri yaradacaq, bunlar real tarixi keçidlərlə qarışacaq (mənbəni ayıran sütun yoxdur — bax bölmə 1).
2. **`updated_at` "donmuş" sütunlar:** `dma_exam_sessions`, `dma_interview_sessions`, `dma_training_groups`, `dma_attendance_records`-da `updated_at`-i yeniləyən trigger yoxdur (VERIFIED, audit sənədi bölmə 1.5). İdxal zamanı bu sütuna hər hansı tarix versəniz, sonradan sətir dəyişsə belə bu tarix **donub qalacaq** — "son dəyişiklik vaxtı" kimi etibarlı deyil.
3. **Pagination/limit yoxdur:** admin panelin bütün siyahı səhifələri (`admin/index.html`, `candidates`, `graduates` və s.) `dma_applications`-ı **limitsiz**, tam join-lərlə yükləyir (`.order("created_at",{ascending:false})`, `.limit()` heç yerdə tapılmadı — VERIFIED). Tarixi minlərlə sətrin idxalından sonra bu, admin panelin **yavaşlamasına** səbəb ola bilər — bu, kodun dəyişdirilməsini tələb edən ayrı bir performans işidir, miqrasiyanın özünün texniki riski kimi qeyd olunur.
4. **`dma_programs` üçün idxaldan əvvəl əl ilə seed lazımdır:** proqramların özü (slug, ad) admin UI-dən yaradıla bilmədiyi üçün (bax audit sənədi, bölmə 1.1), miqrasiyadan ƏVVƏL bütün proqramlar (Backend, Frontend, HR, Data, Mühasibatlıq, Kompüter Operatoru və s.) birbaşa SQL/Table Editor ilə `dma_programs`-a yazılmalıdır ki, `dma_applications.program_id` FK-si uğursuz olmasın.
5. **Sənəd/fayl saxlanması yoxdur:** Sheets-də şəxsiyyət vəsiqəsi skanı, sənəd linki və s. varsa, ERP-də bunun üçün heç bir yer (storage bucket, fayl sahəsi) **MISSING** (audit sənədi, bölmə 4).
6. **`dma/apply` → `dma/exam`/`dma/interview` keçidinin çatdırılma mexanizmi naməlumdur** (audit sənədi, bölmə 4) — bu, köhnə datanın deyil, YENİ canlı axının bir hissəsidir, amma miqrasiya planlaşdırarkən "namizəd necə bildiriş alacaq" sualının fərqli (məsələn köhnə WhatsApp/email prosesi davam edəcəkmi) cavablandırılması lazımdır.
7. **Schema faylının mənbəyi:** `INSTUDY_ERP_DATABASE_SCHEMA.sql` canlı bazadan bir dəfə çıxarılıb yenidən yazılmış fayla əsaslanır, bu sessiyada CANLI SORĞU İLƏ TƏKRAR TƏSDİQLƏNMƏYİB. Miqrasiyaya başlamazdan əvvəl, faktiki strukturun bu sənədlə **1:1 üst-üstə düşdüyünü** təsdiqləmək üçün aşağıdakı SQL-i (yalnız-oxuyan) Supabase SQL Editor-da işlətmək tövsiyə olunur:

```sql
-- Yalnız oxuyur, heç nə dəyişmir
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name like 'dma_%'
order by table_name, ordinal_position;

select conrelid::regclass as table_name, conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where connamespace = 'public'::regnamespace
  and conrelid::regclass::text like 'dma_%'
order by table_name, conname;

select event_object_table, trigger_name, action_timing, event_manipulation, action_statement
from information_schema.triggers
where trigger_schema = 'public' and event_object_table like 'dma_%'
order by event_object_table, trigger_name;

-- Real sətir sayları (NOT VERIFIED statuslarını təsdiqləmək üçün)
select 'dma_programs' t, count(*) from public.dma_programs
union all select 'dma_candidates', count(*) from public.dma_candidates
union all select 'dma_applications', count(*) from public.dma_applications
union all select 'dma_application_status_history', count(*) from public.dma_application_status_history
union all select 'dma_exam_sessions', count(*) from public.dma_exam_sessions
union all select 'dma_exam_bookings', count(*) from public.dma_exam_bookings
union all select 'dma_interview_sessions', count(*) from public.dma_interview_sessions
union all select 'dma_interview_bookings', count(*) from public.dma_interview_bookings
union all select 'dma_training_groups', count(*) from public.dma_training_groups
union all select 'dma_attendance_records', count(*) from public.dma_attendance_records;
```

---

## 5. Xülasə tövsiyələri (mühakimə, icra edilməyib)

1. Yuxarıdakı doğrulama SQL-ini işə salıb sxemi 1:1 təsdiqləyin — bu, digər AI-nın işini "VERIFIED" məlumatla başlamasına imkan verəcək.
2. `dma_programs`-ı əvvəlcə əl ilə seed edin.
3. Trigger-lərin idxal zamanı override problemini (bölmə 2) həll etmək üçün konkret qərar verin (müvəqqəti disable, yoxsa kod dəyişikliyi).
4. Çoxsaylı tarixi qeyd (bölmə 1) və sertifikat (MISSING) üçün, lazımdırsa, yeni cədvəl dizaynı ayrıca müzakirə olunmalıdır — bu sənəd yalnız BOŞLUĞU göstərir, HƏLLİ təklif etmir (tapşırığa uyğun olaraq).
5. Dublikat FİN-lər üçün Sheets-i idxaldan əvvəl əl ilə/skriptlə təmizləyin (DB bunları avtomatik rədd edəcək, amma hansı sətrin uduzacağı sizin idxal sırasından asılı olacaq).
