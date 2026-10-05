# INSTUDY ERP V2 — Phase 0 Readiness Assessment

**Status:** Yalnız qiymətləndirmə sənədidir. **Heç bir kod, cədvəl, trigger, RLS, mövcud məlumat dəyişdirilməyib. Heç bir DDL/DML icra olunmayıb. Commit/push edilməyib.**
**Versiya:** v2 — sizin göndərdiyiniz canlı doğrulama nəticələri ilə yenilənib (ilk versiya yalnız kod/yerli fayl əsaslı idi).
**Tarix:** 2026-09-28
**Əsas mənbə:** V1-4 audit sənədləri + bu sənədin v1 versiyası + sizin göndərdiyiniz canlı Supabase nəticələri (aşağıda mənbə olaraq göstərilir).

**Status konvensiyası (dəyişməz):** VERIFIED-LIVE / VERIFIED-CODE / UNVERIFIED / BLOCKER. **Diqqət:** aşağıdakı VERIFIED-LIVE işarələri, sizin mənə göndərdiyiniz **yekun nəticələrə** (bəzi hallarda xam SQL çıxışı deyil, sizin xülasələndirdiyiniz nəticə) əsaslanır — mən özüm canlı sorğu göndərməmişəm, sizin dediklərinizi doğru qeyd edirəm.

---

## 🔑 ƏN VACİB YENİ TAPINTI: ERP hazırda TAM BOŞDUR

Bütün 10 `dma_*` cədvəli (o cümlədən `dma_programs`) **sıfır sətir** saxlayır (mənbə: sizin 2026-09-28 tarixli canlı sorğu nəticəniz, bölmə 2.8-dəki sayğac sorğusuna cavab). Bu, sənədin əvvəlki versiyasındakı risk qiymətləndirməsini **əsaslı şəkildə dəyişir**:

- **Real namizəd/müraciət məlumatı YOXDUR** — Phase 1-6-nın additiv DB dəyişiklikləri (yeni sütun/cədvəl/trigger) üçün "canlı datanın korlanması" riski demək olar **sıfırdır** (boş cədvələ sütun əlavə etməyin heç bir sətrə təsiri yoxdur).
- **`dma_programs` da boşdur** — yəni B4 ("proqramlar seed edilib") artıq "yoxlanılmalı sual" deyil, **təsdiqlənmiş fakt**: proqramlar **hələ seed edilməyib**. Bu, Phase 1-i BLOKLAMIR (Phase 1 proqram FK-sından asılı deyil), amma **istənilən real istifadədən (V2-dən asılı olmayaraq) ƏVVƏL** və mütləq **Faza 7-dən (miqrasiya) ƏVVƏL** tamamlanmalıdır.
- Bunun mənası: hazırkı ERP heç kim tərəfindən hələ **real istifadə edilməyib** — bu, sizin özünüzün ilkin izahınızla üst-üstə düşür ("gözlənilən vəziyyətdir").

---

## Yeniləndi: B1 — TƏSDİQLƏNDİ (VERIFIED-LIVE)

**Sizin nəticəniz:** `dma_applications` üçün `authenticated` roluna **table-level INSERT GRANT verilib**, AMMA **INSERT RLS policy YOXDUR**. Bütün 10 cədvəldə RLS aktivdir. Mövcud SELECT/UPDATE policy-ləri `has_scope('dma')` istifadə edir.

**Texniki nəticə (Postgres RLS-in standart davranışına əsasən):**

> Bir cədvəldə RLS **aktivdirsə**, və müəyyən bir əməliyyat (bu halda `INSERT`) üçün **heç bir policy təyin edilməyibsə**, o rol üçün həmin əməliyyat **defolt olaraq rədd edilir** — table-level `GRANT`-in mövcudluğundan ASILI OLMAYARAQ. `GRANT` yalnız "bu icazə PRİNSİPCƏ mümkündür" deyir, RLS isə "hansı KONKRET sətirlərə/hansı ŞƏRTLƏ" sualını cavablandırır — policy yoxdursa, cavab "heç birinə" olur.

**Nəticə: B1 TAM TƏSDİQLƏNDİ.** `authenticated` rolu (yəni admin panelə giriş edən HƏR staff, `role`/`staff_scope`-dan asılı olmayaraq) hazırda **PostgREST/Supabase client vasitəsilə `dma_applications`-a birbaşa `insert` edə BİLMİR** — nə adi DMA staff, nə də Admin/Manager. Yeganə mövcud yazma yolu **service-role** açarı ilə işləyən backend-dir (`api/dma/apply.js`), o da RLS-i tamamilə **bypass** edir (service_role-un `bypassrls` atributu var).

**Bunun V2 memarlığına təsiri:**
- V2 Target Architecture-in 3.1-ci bölməsindəki əsas fərziyyə ("adi staff `MANUAL_IMPORT`-a çata bilməz, çünki birbaşa insert yolu yoxdur") **DƏQIQ DOĞRUdur** — indi fərziyyə deyil, təsdiqlənmiş fakt.
- **Yeni tövsiyə (BLOCKER deyil, sərtləşdirmə tövsiyəsi):** hazırkı vəziyyət "təsadüfən təhlükəsizdir" — qoruma **policy-nin yoxluğuna** əsaslanır, aktiv bir qadağaya deyil. Əgər gələcəkdə kimsə diqqətsizcə `dma_applications`-a bir `INSERT` policy əlavə etsə (məsələn "+ Yeni müraciət əlavə et"-i səhvən birbaşa client-insert kimi implementasiya etməyə çalışsa), stray GRANT artıq mövcud olduğu üçün bu, DƏRHAL, HEÇ BİR ƏLAVƏ ADDIM olmadan `authenticated`-ə tam INSERT açar. **Tövsiyə:** Phase 1-də, ehtiyat tədbiri kimi, bu "istifadə olunmayan" GRANT-i açıq şəkildə geri almaq (`REVOKE INSERT ON dma_applications FROM authenticated;`) — bu, mövcud SIFIR funksionallığı dəyişmir (onsuz da RLS bloklayır), sadəcə gələcək səhvlərə qarşı əlavə bir sədd qoyur. **Bu, YENİ bir DDL təklifidir, Implementation Plan-ın Faza 1-inə əlavə oluna bilər** (mən bunu indi ETMİRƏM, yalnız təklif edirəm).

---

## Yenilənmiş Verification Checklist (bölmə 2, statuslar)

| # | Sorğu | Əvvəlki status | Yeni status | Mənbə |
|---|---|---|---|---|
| 2.1 Sütun strukturu | UNVERIFIED | **UNVERIFIED (dəyişməyib)** | Xam nəticə göndərilməyib |
| 2.2 Constraint-lər | UNVERIFIED | **UNVERIFIED (dəyişməyib)** | Xam nəticə göndərilməyib |
| 2.3 Trigger-lər (tam siyahı) | UNVERIFIED | **QİSMƏN VERIFIED-LIVE** | "Bütün 10 cədvəldə RLS aktivdir" təsdiqləndi, AMMA trigger-lərin DƏQİQ siyahısı (hansı cədvəldə neçəsi) hələ göndərilməyib |
| 2.4 Trigger funksiyalarının kodu | UNVERIFIED | **UNVERIFIED (dəyişməyib)** | Xam nəticə göndərilməyib — **Faza 7-dən əvvəl MÜTLƏQ lazımdır** (aşağı bax) |
| 2.5 RLS policy-lər | UNVERIFIED | **VERIFIED-LIVE (əsas hissəsi)** | `dma_applications`-da INSERT policy yoxdur; SELECT/UPDATE policy-ləri `has_scope('dma')` istifadə edir. (Qalan 9 cədvəlin policy-lərinin EYNİ naxışda olduğu, sizin ümumi ifadənizə əsasən, YÜKSƏK EHTİMALLA doğrudur, amma sətir-sətir təsdiqlənməyib) |
| 2.6 Grant-lər | UNVERIFIED | **VERIFIED-LIVE (`dma_applications` üçün)** | `authenticated` → `dma_applications`: INSERT grant VAR (bax yuxarı). Digər 9 cədvəlin grant cədvəli göndərilməyib |
| 2.7 RPC icazələri | UNVERIFIED | **UNVERIFIED (dəyişməyib)** | Xam nəticə göndərilməyib |
| 2.8 Sətir sayları | UNVERIFIED | **VERIFIED-LIVE** | **Bütün 10 cədvəl 0 sətir** |
| 2.9 `dma_programs` siyahısı | UNVERIFIED | **VERIFIED-LIVE (dolayı)** | `dma_programs` 0 sətir olduğu üçün (2.8-dən) siyahının BOŞ olduğu artıq bəllidir, ayrıca sorğuya ehtiyac qalmadı |

---

## Data Migration Prerequisites (B4, B5 — YENİDƏN TƏSNİF EDİLDİ)

Sizin tələbinizə uyğun olaraq, bunlar artıq **"Phase 1 BLOCKER"** deyil — **"Data Migration Prerequisites"**dir, yəni Faza 7-dən (və ümumiyyətlə real istifadədən) əvvəl tamamlanmalı, AMMA Phase 1-in additiv sxem dəyişikliklərini HEÇ CÜR bloklamayan tələblərdir:

| # | Tələb | Status | Nə vaxt lazımdır |
|---|---|---|---|
| DM-1 (əvvəlki B4) | `dma_programs` bütün real proqramlarla (ad, slug, müddət) seed edilməlidir | **UNVERIFIED → İNDİ TƏSDİQLƏNDİ Kİ, HƏLƏ EDİLMƏYİB** (cədvəl boşdur) | Faza 7-dən ƏVVƏL. **Həm də V2-dən TAMAMILƏ ASILI OLMAYARAQ lazımdır** — proqramlar olmadan `dma_applications` heç yarana bilməz (FK), yəni bu, ERP-nin İLK real istifadəsinin ön şərtidir |
| DM-2 (əvvəlki B5) | Miqrasiya skripti `created_at`-i Sheets-dəki ƏSL tarixlə (idxal anı YOX) yazmalıdır | **UNVERIFIED (dizayn tələbi, implementasiya mərhələsində yoxlanılacaq)** | Faza 7-nin öz kodunda |
| DM-3 (yeni) | Sheets-dəki status adlarının 27 icazəli `current_status` dəyərinə xəritəsi | **UNVERIFIED** | Faza 7-dən əvvəl |
| DM-4 (yeni) | Sheets-dəki namizəd sayı/həcmi (performans planlaması üçün) | **UNVERIFIED** | Faza 7-dən əvvəl, bölmə 8-in performans qiymətləndirməsi üçün faydalı |

**Vacib fərq:** DM-1–DM-4-ün heç biri **Phase 1, 2, 3, 4, 5, 6, 8, 9**-u bloklamır (bunların heç biri mövcud data ilə işləmir/asılı deyil). Yalnız **Faza 7**-ni (və real production istifadəsini) bloklayır.

---

## Yenilənmiş bölmə 3-4 (Backup/Staging) — boş baza kontekstində

Boş bazada DDL əməliyyatlarının **data itkisi riski əməli olaraq sıfırdır** (silinəcək/korlanacaq heç bir sətir yoxdur). Buna görə:

- **B2 (tam backup):** **BLOCKER-dən "Güclü tövsiyə"yə ENDİRİLİR (Phase 1-6 üçün).** Səbəb: boş cədvəllərə `ADD COLUMN`/`CREATE TABLE`/yeni trigger-lərin nəzəri risk profili minimaldır, hər fazanın öz rollback SQL-i artıq sənədləşdirilib (Implementation Plan). Bununla belə, **schema-səviyyəli bir backup** (sxemin özünün, RLS/trigger/policy tərifinin, `pg_dump --schema-only` ilə) yenə də **tövsiyə olunur** — çünki Faza 6/7 MÖVCUD trigger funksiyalarını `CREATE OR REPLACE` edəcək, və bu əməliyyat üçün "əvvəlki kodu" əldə saxlamaq faydalıdır (bölmə 2.4-ün nəticəsi bunun üçün kifayət edəcək, ayrıca `pg_dump` məcburi deyil).
- **B2, Faza 7-dən (real data axmağa başlayanda) ƏVVƏL yenidən BLOCKER statusuna QAYIDIR** — o zaman artıq qorunacaq real namizəd məlumatı olacaq.
- **B3 (staging mühiti):** hələ də **tövsiyə olunur**, AMMA artıq "real datanı qorumaq" üçün YOX, "trigger/RLS məntiqini (xüsusən Faza 6-nın təkrar-müraciət qaydasını, çoxsaylı ssenari ilə) təhlükəsiz sınamaq" üçün — boş production-da bu ssenariləri sınamaq, sonradan silinməli test sətirləri yaratmaq deməkdir (bu da mümkündür, sadəcə staging daha təmizdir).

---

## Regresiya Test Siyahısı (bölmə 7) — boş baza qeydi

R1-R15 siyahısı (əvvəlki versiyada) **dəyişməz** qalır, AMMA vacib bir əməli qeyd: ERP boş olduğu üçün, R3-R14 kimi "mövcud namizəd/müraciət" tələb edən testlər HAZIRDA belə (V2-dən tamamilə asılı olmadan) icra edilə BİLMƏZ — əvvəlcə ən azı 1 proqram (DM-1) və bir neçə test namizədi/müraciəti yaradılmalıdır. **Tövsiyə:** Phase 1-dən əvvəl, DM-1-in kiçik bir hissəsi (1-2 real proqram) seed edilsin və 2-3 test müraciəti (`dma/apply` vasitəsilə, real FİN formatında, AMMA aydın "TEST" işarəli ad ilə) yaradılsın ki, R1-R15 baza xətti kimi icra edilə bilsin. Bu, DM-1-i qismən, tədricən başlatmaq deməkdir.

---

## Yenilənmiş GO / NO-GO — FAZA-SPESİFİK

Əvvəlki versiyada tək bir "NO-GO" var idi. İndi, yeni məlumatlarla, vəziyyət fazalara görə **fərqlidir**:

| Faza | GO/NO-GO | Əsas şərt |
|---|---|---|
| **Faza 1** (əlavə sütunlar, `dma_config`, `can_override_eligibility`) | **GO** (şərtli) | B1 bağlandı, cədvəllər boşdur (risk minimal). Yeganə qalan addım: bölmə 2.1/2.2-nin (sütun/constraint) tam nəticəsini almaq, ideal olaraq Faza 1-dən əvvəl (bir neçə dəqiqəlik əlavə sorğu), amma bu, əməli olaraq BLOKLAYICI DEYİL, çünki `ADD COLUMN` əməliyyatları öz-özlüyündə təhlükəsizdir |
| **Faza 2** (manual-application endpoint, eligibility override) | **GO** (Faza 1-dən sonra) | Asılılıq yalnız Faza 1-ə (yeni sütunlar/funksiya) |
| **Faza 3** (`dma_class_sessions`) | **GO** (istənilən vaxt) | Müstəqil |
| **Faza 4** (qiymətləndirmə modeli) | **GO** (Faza 1-dən sonra) | `assessment_scheme_id` FK-si üçün Faza 1 lazımdır |
| **Faza 5** (`dma_employment_contacts`) | **GO** (istənilən vaxt) | Müstəqil |
| **Faza 6** (təkrar müraciət trigger-i) | **ŞƏRTLİ NO-GO** | Bölmə 2.2 (constraint-lər, xüsusən `current_status` CHECK-inin tam 27 dəyəri) və 2.4 (trigger funksiyalarının cari kodu — YOX, Faza 6 mövcud 4 trigger-ə TOXUNMUR, sadəcə YENİ bir trigger əlavə edir, ona görə 2.4 əslində Faza 6 üçün MÜTLƏQ deyil, YALNIZ Faza 7 üçündür — DÜZƏLİŞ: **Faza 6 əslində 2.2-nin tam nəticəsi ilə GO ola bilər**, aşağıdakı sətirə bax) |
| **Faza 6 (dəqiqləşdirilmiş)** | **GO** (bölmə 2.2 tam nəticəsi alındıqdan sonra) | Yalnız terminal-status siyahısının canlı CHECK constraint ilə tam uyğunluğunu təsdiqləmək lazımdır — bu, KİÇİK, tez əldə edilə bilən bir addımdır |
| **Faza 7** (tarixi miqrasiya) | **NO-GO** | DM-1 (proqram seed), DM-2/DM-3 (miqrasiya skriptinin dizaynı) tamamlanmayıb + bölmə 2.4 (trigger kodunun `CREATE OR REPLACE`-dən əvvəl tam görülməsi) MÜTLƏQDİR (bu, real trigger-ə toxunan yeganə fazadır) + B2 (real backup) bu mərhələdən əvvəl YENİDƏN tələb olunur |
| **Faza 8** (`updated_at` bug-fix) | **GO** (istənilən vaxt) | Müstəqil, sıfır risk |
| **Faza 9** (server-side Dashboard) | **GO** (digər fazalardan sonra, məntiqi olaraq) | Digər modulların datası olmalıdır ki, mənalı olsun |

### Yekun

**Phase 1 (və 2, 3, 4, 5, 8) üçün: GO.** Boş baza + B1-in təsdiqlənməsi, additiv dəyişikliklərin risk profilini kəskin aşağı salıb.

**Phase 6 üçün: GO, yalnız bölmə 2.2-nin (constraint) tam nəticəsindən sonra** (bir sorğu, sürətlə əldə edilə bilər).

**Phase 7 (tarixi miqrasiya) üçün: hələ NO-GO** — DM-1 (proqram seed) tamamlanmalı, miqrasiya skripti yazılmalı, VƏ bölmə 2.4-ün (trigger kodu) tam nəticəsi alınmalıdır ki, `CREATE OR REPLACE`-lər təhlükəsiz yazıla bilsin.

**Sizdən növbəti addım:** əgər Faza 1-dən başlamaq istəyirsiniz, mənə "başla" deməyiniz kifayətdir (mən hələ heç nə etməmişəm) — YA DA əvvəlcə bölmə 2.1/2.2/2.4 sorğularının qalan nəticələrini göndərə bilərsiniz ki, sənəd 100% tam VERIFIED-LIVE olsun. Hər iki yol da məqbuldur, seçim sizindir.
