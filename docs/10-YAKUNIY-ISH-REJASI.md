# 10 · Yakuniy ish rejasi — qolgan hamma narsa

> `08-REWRITE-PLAN.md` — **nima qilinishi kerakligi** (o'zgarmaydi).
> Bu hujjat — **qolgani qanday tartibda tugatilishi**. Ziddiyat bo'lsa, faza
> ta'rifi uchun 08 ustun, ketma-ketlik uchun bu hujjat.
>
> Boshlangan sana: **2026-08-17**. Boshlang'ich holat: `be77d47` — build QIZIL edi.

---

## Nega aynan shu tartib

Uchta cheklov tartibni belgilaydi, va ular muzokaraga ochiq emas:

1. **Build yashil bo'lmasa, hech narsa isbotlanmaydi.** Qizil build ustida
   yozilgan har qanday test — umid, o'lchov emas. Shuning uchun S1 birinchi.
2. **AI'ga tegishdan oldin uni o'lchaydigan narsa kerak.** `05-ROADMAP` ning eng
   to'g'ri qarori shu edi va kuchda qoladi: golden set graderni **almashtirgandan
   keyin emas, u bilan birga** keladi (S2).
3. **Prodga tegadigan hamma narsa — foydalanuvchi bilan.** *(2026-08-23 da
   sababi o'zgardi, qoidasi emas.)* Egasining qarori: prod ma'lumoti
   **ko'chirilmaydi**, server **noldan** quriladi — ya'ni "50 foydalanuvchi
   zaxirasiz" xavfi endi mavzu emas. Lekin qoida kuchda qoladi: o'rnatishning
   o'zi tashqariga qaragan, qaytarib bo'lmaydigan amal (DNS, TLS, Let's Encrypt
   soatlik limiti, haqiqiy Telegram bot). U **bloklangan** deb belgilanadi,
   yashirilmaydi. Tayyorgarlik esa to'liq bajarildi: `deploy/INSTALL.md` va
   lokal toza o'rnatish simulyatsiyasi.

---

## Sprintlar

| # | Sprint | Nimani yopadi (08 bo'yicha) | Holat |
|---|---|---|:--:|
| **S1** | **AI provayder zanjiri** | Faza **3.4** — pipeline'ning yagona ishlamayotgan qismi | ✅ |
| **S2** | **Grader golden set + CI darvozasi** | Faza **1.4 · 1.5 · 1.6** | ✅ |
| **S3** | **Test va infratuzilma qarzi** | **2.5 · 3.10 · 4.1 · 4.2 · 4.11** ✅ | ✅ |
| **S4** | **Yangi funksiyalar (flag ortida)** | **6.1 · 6.2 · 6.3 · 6.5 · 6.7 · 6.8** ✅ · **6.6** 🟡 (skelet) | ✅ |
| **S5** | **Zaxira skriptlari, tozalash, hujjatlar, yakuniy QA** | **0.5** ✅ (zaxira **va** tiklash, sinalgan) · 7.x · **prodga tayyorlik** ✅ | 🟡 |
| **S6** | **Prodga tayyorlik qattiqlashtirishi** *(2026-08-23 kechasi, rejada yo'q edi)* | Sirlar · CORS · token bekor qilish · vendor timeout · rate limit · readiness · log · cutover minalari · ErrorBoundary · uchala rol uchun E2E · kontrast | ✅ |
| **S8** | **Uch rol bo'yicha yakuniy audit va tuzatish** *(2026-09-29)* | Pastdagi "S8" bo'limi — 7 ta P0, ~30 ta P1 | ✅ |
| **S7** | **Noldan o'rnatish** *(egasining 2026-08-23 qarori)* | `INSTALL.md` · `bootstrap-admin.sh` · `smoke.sh` · `preflight.sh` rejimlari · sertifikat zanjiri | ✅ |

> **S4 — yakuniy holat (2026-08-23).** Sprint yopildi. Uch band reja yozganidan boshqacha chiqdi,
> va uchalasi ham **o'lchov bilan** aniqlandi:
>
> **6.8 allaqachon qurilgan ekan** — `ProfileService.BuildAchievements`, 21 nishon, **jadvalsiz**
> (nishonlar saqlanmaydi, hisoblanadi). Jonli tekshirildi. Reja "boshlanmagan" deb yozgan edi.
>
> **6.7 yarmi qurilgan edi** — o'qituvchi sinf xatolarini ko'rardi, "1 tap → remediation topshiriq"
> yo'q edi. Yetishmayotgan yarmi qurildi, va **xarita qo'lda yozilmadi**: bazadagi haqiqiy
> `corrections` lug'ati sanab chiqildi (`word_order` 127 · `relevance` 1 · `style` 1) va xarita
> sifatida "shu xato eng ko'p sodir bo'lgan savol" olindi — nol taxminli. Chegara **3 ta turli
> o'quvchi** (hodisa emas, odam: bitta gapchan javob bir turdagi 5 ta tuzatish keltirishi mumkin).
>
> **6.2 ning butun asosi noto'g'ri edi.** `docs/01` uni "Azure ma'lumoti tayyor" deb asoslaydi.
> Vendor'ning xom javobi o'lchandi: `ru-RU` uchun fonema **nomlari bo'sh** keladi (455/455), va bu
> scripted rejimda ham o'zgarmaydi — aynan bir xil so'rov `en-US` ga yuborilganda 14/14 nomlangan
> IPA qaytdi. Ya'ni bu so'rov shakli emas, **lokal cheklovi**; Microsoft hujjati ham shuni aytadi
> (fonema nomi va prosodiya faqat `en-US`).
> Shuning uchun funksiya **boshqa signal ustiga** qurildi: ball emas, **oqibat** — «мышка» so'radik,
> «мишка» eshitildi, *sichqoncha* / *ayiqcha*. Bu vendor inventaridan mustaqil va o'quvchi uchun
> tushunarliroq. Pozitsion ballar bezak sifatida qo'shildi va **hech qachon shart emas**.
> Yo'l-yo'lakay o'lchangan ikkinchi narsa: scripted rejimda `Lexical` **reference matnni** qaytaradi,
> aytilganini emas (6/6) — shuning uchun scripted javobning matni hech qayerda o'qilmaydi.
>
> **6.6 — skelet.** Egasining qarori: merchant hisobi hozircha yo'q. Jadvallar, tariflar, obuna
> holati, to'lov oqimining UI'si qurildi; provayder adapteri **stub** va u hech qachon muvaffaqiyat
> qaytarmaydi. Premium endi bitta manbadan hisoblanadi (`is_premium` **yoki** faol obuna), va
> o'qituvchi bergan premium regressiya qilmagani jonli isbotlandi.

---

### S1 · AI provayder zanjiri — Faza 3.4

**Muammo:** admin panelda tugallangan AI/STT ekrani bor va **ortida hech narsa
ulanmagan**. Har bir real provayder — `NotImplementedException` tashlaydigan
stub, `IsConfigured` esa `false`. Natijasi: Assessment pipeline har bir
topshiriqni **kechiktiradi**, urinishlar abadiy `pending` qoladi, ilova
umuman baholay olmaydi. Kalitlar `.env` da **allaqachon bor**.

**Qaror (mahsulot, 2026-08-13):** yagona provayder emas, **tartiblangan zanjir +
avtomatik fallback**. Admin tartib beradi (`anthropic,gemini,openai`); sozlangan
**va** javob bergan birinchi backend xizmat qiladi; `evaluations.llm_model` ga
**haqiqatda baholagan** model yoziladi — sozlangan nom emas, chunki fallback
ishlaganda u yolg'on gapiradi.

| # | Qadam | DoD |
|---|---|---|
| 1.1 | Seam: `bool IsConfigured` → `ValueTask<bool> IsConfiguredAsync(ct)` | Build yashil |
| 1.2 | `Govori.Platform.csproj`: logging abstractions, `Microsoft.Extensions.Http`, `Anthropic` 12.40.0 | Restore o'tadi |
| 1.3 | Grader backendlar: Anthropic (rasmiy SDK) · Gemini (REST) · OpenAI/Azure OpenAI (bitta backend) | Umumiy JSON kontrakt, C6 kosmetik tuzatish filtri |
| 1.4 | STT backendlar: Azure Speech (**unscripted**, `Lexical`, fonema+prosodiya) · Whisper (faqat matn) | webm→16k mono WAV transkod, ikkala image'da ffmpeg |
| 1.5 | `AiConfigSource` — `app_settings` ustidan (tri-state + ~30s kesh bitta joyda) | Ikkala kompozitsiya ildizida ro'yxatdan o'tadi |
| 1.6 | DI: stublar o'rniga backendlar + zanjir provayderlari; provayderlar **scoped** | `Program.cs` ×2 |
| 1.7 | Sozlamalar yuzasi: `grader_chain`, `stt_chain`, `anthropic_api_key`, `anthropic_model` + admin ekrani | Zanjir tartibi tahrirlanadi, sirlar faqat yoziladi |
| 1.8 | Testlar: zanjir birlik testlari + integratsiya + jonli smoke | Quyidagi to'rt qoida test bilan qotiriladi |

**Zanjir kodlaydigan to'rt qoida — har biri sabab bilan:**

- **O'tkazib yuborilgan ≠ yiqilgan.** Kalitsiz backend jimgina o'tkazib
  yuboriladi; sozlangani yiqilsa — nomi bilan loglanadi. Ikkovini
  aralashtirish yo har bir topshiriqda "Claude sozlanmagan" spamini beradi,
  yo vendor uzilishini yashiradi.
- **Bekor qilish hech qachon fallback'ni ishga tushirmaydi.** Bekor qilingan
  so'rov — chaqiruvchi ketdi degani; zanjirni qayta urinish hech kim
  o'qimaydigan javob uchun uchta vendorga hisob yozadi.
- **Konfiguratsiya — bir yugurish uchun bitta snapshot.** Aks holda bitta
  yugurish bir provayderda boshlanib, boshqasining kalitida tugashi mumkin.
- **STT fallback ataylab yo'qotishli.** Talaffuz bahosini faqat Azure qaytaradi,
  shuning uchun Whisper'ga tushish bandni matn-only ga (5 emas, 4 mezon)
  tushiradi — urinishni yiqitgandan ko'ra yaxshiroq. Gapirgan o'quvchi ball
  olishi kerak.

---

### S2 · Grader golden set + CI darvozasi — Faza 1.4–1.6

**Nega hozir:** grader endi almashtirildi. "Yangi grader eskisidek yaxshi"
degan gap — hozircha **da'vo**; golden set uni **o'lchovga** aylantiradi.

| # | Qadam | DoD |
|---|---|---|
| 2.1 | Golden set formati + `expected.yaml` sxemasi (`docs/02 §2.7`) | Fayl bor, kelishilgan |
| 2.2 | Golden set testi — real API, sekin marshrut, ataylab CI'ning tez yo'lidan tashqarida | Lokalda ishlaydi |
| 2.3 | CI darvozasi: golden < 90% → PR bloklanadi | Sun'iy regressiya bilan tekshirilgan |

> ⚠️ **Ochiq cheklov:** 08 §1.4 "40 klip" talab qiladi. **Real o'quvchi audiosi
> mening ixtiyorimda yo'q** va uni o'ylab topib bo'lmaydi — soxta klip soxta
> ishonch beradi. Shuning uchun bu sprint **golden set'ning butun mashinasini**
> quradi (format, yuklovchi, ballash, chegara, CI darvozasi) va uni bor
> materialdan to'ldiradi; 40 ta real klip — foydalanuvchi bilan to'ldiriladigan
> bo'shliq, va u shunday deb yoziladi.

---

### S3 · Test va infratuzilma qarzi

| # | Qadam | Nega bu qarz |
|---|---|---|
| 3.1 | **2.5** Testcontainers | Integratsiya testlari umumiy dev Postgres'ga uriladi va qatorlarni o'zgartiradi — bitta parallel yugurish ikkovini ham buzadi |
| 3.2 | **3.10** TTFS instrumentatsiyasi | "p95 < 20s" hech qachon **o'lchanmagan**; o'lchovsiz maqsad — maqsad emas |
| 3.3 ✅ | **4.2** OpenAPI hujjati + kontrakt darvozasi | `shared/api/types.ts` qo'lda yozilgan; backend kontrakti jimgina siljisa, frontend buni kompilyatsiyada emas, prodda biladi. **Yopildi generatsiya bilan emas** — qo'lda yozilgan fayl qoladi (izohlari saqlab qolishga arziydigan bilim), va `npm run check:contract` uni `backend-dotnet/openapi.json` ga solishtiradi. Hujjat host'ning **o'z** `JsonSerializerOptions` idan chiqadi, ya'ni nomlar wire bilan tekshiruv orqali emas, **konstruksiya** orqali bir xil; CI avval hujjatni qayta yaratib eskirmaganini isbotlaydi, keyin darvozani yuritadi. |
| 3.4 | **4.11** Vitest + Playwright golden path + `axe` | CI hozir faqat `tsc` + `vite build` — ya'ni "kompilyatsiya bo'ldi" dan boshqa hech narsani isbotlamaydi |
| 3.5 | **4.1** Bundle budjeti CI'da | O'quvchi initial JS ≤ 180KB gz — budjetsiz u faqat o'sadi |

---

### S4 · Yangi funksiyalar — **feature flag ortida**

> ✅ **Yopildi 2026-08-23.** Quyidagi jadval — dastlabki **reja** va u tarix sifatida qoladi;
> haqiqatda nima chiqqani yuqoridagi "S4 — yakuniy holat" izohida. Uch band rejadan farq qildi
> (6.8 allaqachon qurilgan edi · 6.7 yarmi · 6.2 ning asosi noto'g'ri edi), 6.6 esa skelet
> holida to'xtadi — merchant hisobi egasida yo'q.
>
> Arxitektor tuzatishi 08 dan o'zgarmaydi: **cutover bularni kutmaydi.**
> Cutover funksiyalarga bog'lansa — u hech qachon sodir bo'lmaydi. Deploy ≠ release.
> *(Bu qoida 2026-08-23 da sinovdan o'tdi: funksiyalar cutover'dan **oldin** tugadi, lekin
> o'rnatish baribir ularni kutmasdan bajarilishi mumkin — hammasi flag ortida, sukut o'chiq.)*

Tartib — qiymat/xarajat bo'yicha, eng arzon foydadan boshlab:

| # | Feature | Nega shu joyda |
|---|---|---|
| 4.1 | **6.1 F5 · Xato-replay drill (SRS UI)** | `ReviewItem` modeli **allaqachon bor** — faqat UI yetishmaydi. Eng arzon foyda. |
| 4.2 | **6.3 F3 · Kunlik 5 daqiqa** | Yangi jadval yo'q; mavjud kontentdan yig'iladi |
| 4.3 | **6.8 Achievement backend** | Kichik, o'zi yetarli, gamifikatsiya allaqachon bor |
| 4.4 | **6.2 F2 · Fonema drill + minimal juftliklar** | `minimal_pairs`, `drills` — additive jadvallar |
| 4.5 | **6.7 F6 · Sinf insaytlari** | O'qituvchi paneli tayyor; bu unga qatlam |
| 4.6 | **6.5 F1 · Roleplay / AI Suhbat** 🎯 | `ConversationPage` hozir **statik stub**. Endi zanjir bor — LLM ulanadi. Turn limiti, kunlik byudjet, arzon model: xarajat portlashi qayd etilgan xavf |
| 4.7 | **6.6 Payments** | Eng kattasi va yagona **tashqi bog'liqligi bor** ishi — oxirida |

---

### S5 · Zaxira skriptlari, tozalash, hujjatlar, yakuniy QA

| # | Qadam | Chegara |
|---|---|---|
| 5.1 | **0.5** Zaxira skriptining bug'ini tuzatish: `set -o pipefail`, hajm tekshiruvi, **faqat tasdiqlangandan keyin o'chirish**, offsite | Sun'iy buzilgan dump bilan tekshiriladi. **Kod** — prodda ishga tushirish emas |
| 5.2 | `docs/` ni haqiqatga moslashtirish; 08 dagi holat jadvali yangilanadi | Kod hujjatga mos |
| 5.3 | Yakuniy QA: to'rtala suite + `tsc` + `vite build` + mobil/desktop × light/dark | Skrinshot bilan |

---

### S8 · Uch rol bo'yicha yakuniy audit (2026-09-29)

Egasining so'rovi: *"loyihani tugatish kerak, nimalar qolgan — har taraflama tekshir, admin,
teacher, student taraflama"*. To'rtta auditor (o'quvchi · o'qituvchi · admin · backend) jonli
stack'ni headless brauzer va API orqali yurib chiqdi; oltita agent tuzatdi, integratsiya va QA —
arxitektor. Topilgan narsalar testlar yashil bo'lgan holda **mahsulotni ishlatib bo'lmas** qilib
turgan edi — ya'ni bular faqat ilovani haqiqatan ishlatib ko'rilganda chiqdi.

**P0 — launch'ni to'xtatib turgan 7 ta narsa, hammasi yopildi:**

| # | Muammo | Nima qilindi |
|---|---|---|
| 1 | Chrome/Android'dan yozilgan javob **hech qachon** saqlanmagan: `audio/webm;codecs=opus` MinIO imzosini buzardi → 500 | `ContentTypes.Essence` saqlash qatlamida — barcha chaqiruvchilar uchun |
| 2 | Vazifa ekranida **savolning o'zi** ko'rinmagan, AI esa yashirin prompt bo'yicha baholagan | `StudentTaskResponse` += prompt, ko'rsatma, media, tayyorlanish/javob vaqti; ekran ularni ko'rsatadi |
| 3 | O'qituvchi topshirig'i **boshqa vazifani** ochgan (assignment id ↔ question id) | To'g'ri id + noma'lum id'da jim fallback o'rniga halol "mavjud emas" |
| 4 | Toza o'rnatishda **o'qituvchi yaratib bo'lmaydi** | `POST /api/admin/teachers` (telefon + ism) + rol almashtirish + "O'qituvchi qo'shish" |
| 5 | **Rasmiy (public) modul** yaratib/nashr qilib bo'lmaydi → yangi serverda katalog bo'sh | Admin "Kontent" bo'limi, `visibility: public` faqat admin uchun |
| 6 | O'qituvchi vazifalari **hech qachon nashr bo'lmagan** | Modul nashri vazifalarni ham nashr qiladi; vazifa bo'yicha kalit va holat |
| 7 | Rate-limit `X-Forwarded-For` orqali aylanib o'tilgan (OTP taxmin qilish, pullik guest yo'llar) | nginx sarlavhani qayta yozadi, API oxirgi hop'ni oladi; telefon bo'yicha OTP cooldown + xato limiti |

**P1 (asosiylari):** Telegram bot tokeni log'larga ochiq yozilardi · SRS takrorlash hech qachon
avtomatik rejalashtirilmagan · streak hech qachon tushmagan (iyuldagi "🔥 15") · baholash xatosi
o'quvchiga xom inglizcha matn · natija ekrani yo'q edi · taklif havolasi `/j/:code` o'lik ·
placement ro'yxatdan keyin taklif qilinmagan · recorder faqat o'zbekcha · soxta Pro narxi va
sertifikat va'dasi · o'qituvchi premium bera olmagan · takroriy topshiriq · topshiriq/guruh
boshqaruvi yo'q · kontentni tahrirlash/o'chirish yo'q · o'qituvchi rasmiy katalogdagi sinf ishini
ko'rmagan · bildirishnomalar deyarli yo'q · admin chiqish/profil yo'q · Adminlar ro'yxati yo'q ·
`/drill`ga kirish yo'li yo'q.

**Qabul qilingan qarorlar** — `docs/ASSUMPTIONS.md` (har biri bir qatorda bekor qilinadi).
**Egasining qarorlari** (2026-09-29): push — tugagach `origin/dotnet-rewrite`; boshlang'ich
kontent seed qilinmaydi; C3/C6 — launch'dan keyin; brend rangi o'zgarmaydi (16 ta light-mavzu
kontrast tuguni qabul qilingan cheklov).

**O'lchov (2026-09-29):** backend build **0 warning / 0 error**, to'rtala suite **553 passed,
0 failed, 4 skipped** (430 dan) · frontend **356 vitest** (189 dan), **Playwright 14/14** qayta qurilgan stack'da, build yashil, bundle
**142.2 / 180 KB gz** (o'sish — asosan uch tildagi yangi matnlar entry chunk'da) · Playwright birinchi yugurishda **haqiqiy xato** topdi: navbat nishoni sahifa uzunligini ko'rsatardi (125 o'rniga "100") — `GET /api/submissions/review-count` bilan tuzatildi ·
`check:contract` **0 xato** (OpenAPI qayta generatsiya qilindi; emitter `[JsonIgnore]`
maydonlarni endi hujjatga chiqarmaydi).

**Launch oldidan yopildi (2026-09-30):** o'qituvchi rasmiy katalogdan topshiriq bera oladi va
berilgan vazifa shu o'quvchi uchun ochiladi (muddat tugaguncha, cheklovi — `max_attempts`) ·
placement baholab bo'lmasa soxta ball o'rniga 503 va "keyinroq" · ishlamaydigan orfoepiya kaliti
admin panelidan olindi · kun Toshkent yarim tunida almashadi (`ProductDay`). O'lchov: backend
**591 passed, 0 failed**, frontend **367 vitest**, kontrakt 0 xato.

**Ochiq (keyingi raund):** ~~guruhni boshqa o'qituvchiga o'tkazish yo'q~~ · ~~admin audit trail
yo'q~~ · ~~model izohlari serverda aralash tilda~~ · ~~anonim `/api/guest/assess`~~ · ~~presigned
URL'lar MinIO root kaliti bilan imzolanadi~~ · ~~ketma-ketlik qulfi faqat UI'da~~ — **oltitasi S9 da
yopildi (pastda)**. Qolgani: kirish bitta Telegram botga bog'liq (Google tugmasi UI'da yo'q —
`GOOGLE_CLIENT_ID` egasidan kerak).

### S9 · "Keyingi raund" yopildi (2026-10-21)

Boshlang'ich holat `fed68aa`; birinchi qadam — baseline o'lchovi: backend **591 passed, 0 failed**,
frontend **367 vitest**, kontrakt 0 xato (hujjatdagi raqamlar bilan aynan bir xil).

| # | Nima edi | Nima qilindi |
|---|---|---|
| 0 | **`minio/minio` va `minio/mc` Docker Hub'dan yo'qolgan** — dev ham, prod o'rnatish ham `pull access denied` da to'xtardi | `pgsty/minio` / `pgsty/mc` release teglari (o'sha AGPL manba; `curl` bor, healthcheck o'zgarmadi) |
| 1 | Ketma-ketlik qulfi faqat UI'da | Submit 403 qaytaradi (402 dan keyin); assignment va review navbati ochadi; ekran yozishdan **oldin** aytadi |
| 2 | Anonim `/api/guest/{demo,assess,tts}` | `Govori.Guest` moduli butunlay olib tashlandi; guest placement qoldi |
| 3 | Presign/S3 — MinIO root kaliti | `minio-init` idempotent `govori-app` foydalanuvchisi + faqat bucket'ga siyosat; prod `S3_APP_*` siz ishga tushmaydi; `preflight.sh`, `ProductionSecrets`, `restore.sh` ham |
| 4 | Fikr-mulohaza har doim o'zbekcha | `preferred_language` (uz/ru/en) graderga uzatiladi, `lang` saqlanadi; uz prompt bayt-ma-bayt o'zgarmagan; CEFR yorliqlari 4 ekranda UI tilida |
| 5 | Guruhni o'tkazib bo'lmaydi | `POST /api/admin/groups/{id}/transfer` + admin UI; nima ko'chishi `ASSUMPTIONS.md` da |
| 6 | Admin audit trail yo'q | `admin_audit_log` (trigger bilan append-only), bitta endpoint filtri, `/admin/audit` ekrani; sirlar hech qachon yozilmaydi |

**Yo'l-yo'lakay topilgan:** demo dump'dan seed qilingan dev baza baseline'dan keyingi 9 ta
migratsiyasiz qolardi va **har bir kirish 500** berardi — `09-DOCKER.md` ga qadam qo'shildi.

**O'lchov (2026-10-21, barcha birlashmalardan keyin):** backend build **0 warning / 0 error**,
to'rtala suite **631 passed, 0 failed, 4 skipped** · frontend **398 vitest**, `tsc`, build yashil,
bundle **145.0 / 180 KB gz** · kontrakt **0 xato** · jonli tekshiruv: haqiqiy kalitlar bilan
Azure STT → OpenAI grader uchidan-uchiga (TTS bilan yaratilgan ruscha javob, ball 77, izoh
o'quvchi tilida); Gemini o'sha kuni vendor tomonda 503 ("high demand") — zanjir OpenAI'ga o'tdi.

### S10 · Launch tayyorgarligi + dizayn raundi (2026-10-21/22)

Ikki audit (texnik/mahsulot va 41 ekranli vizual) natijasida. Har yo'nalish alohida worktree'da,
keyin `dotnet-rewrite` ga birlashtirilib, har birlashmadan keyin to'liq suite yurgizildi.

**Infratuzilma va xavfsizlik**

| # | Nima edi | Nima qilindi |
|---|---|---|
| 1 | **Stored XSS**: javob mijoz e'lon qilgan Content-Type bilan saqlanardi, bucket ilova origin'idan beriladi | Submit faqat `audio/*` (+ audio-only `video/webm|mp4`) qabul qiladi, aks holda 415; bucket location'da `CSP: sandbox` |
| 2 | CI `.NET` kodida hech qachon yurmagan (faqat `main`) | CI `dotnet-rewrite` da ham; "0 test yurdi" himoyasi; Dependabot, CodeQL, NuGet/npm high zaiflik darvozasi; topilgan high advisory'lar yopildi |
| 3 | Audio zaxiralanmasdi, zaxira yiqilsa hech kim bilmasdi | `mc mirror` snapshot'lar (o'qish-only kalit), tekshiruv, alert webhook + heartbeat, `restore.sh --audio`; ixtiyoriy Sentry (`SENTRY_DSN`), `/health/ready` tashqariga |
| 4 | AI xarajatiga umumiy chegara yo'q | Kunlik/oylik cap ($10/$200 sukut), admin "AI pauza", Sozlamalarda sarf; cap'da yangi AI chaqiruvi yo'q |
| 5 | Ilova CSP'siz, favicon/OG/robots yo'q | Majburiy CSP (unsafe-inline'siz), favicon to'plami, OG rasm, allow-list `robots.txt` |

**Dizayn raundi** — audit topilmalarining 10 tasi va 9 xatosi: o'quvchi motivatsiyasi (seriya,
hafta nuqtalari, kunlik maqsad halqasi, XP bosqichi, modul yo'li, maskot reaksiyasi, konfetti);
`/task` menyusiz to'liq ekran (bitta mikrofon, pastki panel, HTTPS/ruxsat xabarlari); har rol
uchun bitta `RoleLayout` + `Page` (bitta sarlavha, 920/1200px kengliklar); til (jim yozuv
baholanmaydi, "None" bandlari, 23 plural kalit, kirishda til tanlash); yagona sana/telefon formati,
`DateField`, to'lqinli `AudioPlayer`; funksiya bayroqlari `/me` da (o'chiq funksiya o'quvchiga
ko'rinmaydi, 404 tekshiruvlari yo'q); admin `DataTable` va Sozlamalar tablari; o'qituvchi/admin
dashboard'lari, muvaffaqiyatsiz baholashni qayta yuborish (`POST /api/submissions/{id}/regrade`),
taklif sahifasida QR. O'zbekcha apostroflar `‘`/`’` ga keltirildi — Onest'da U+02BB/02BC glif yo'q.

**Yo'l-yo'lakay:** dev seed'da demo o'quvchining baholangan javobi yo'q edi (e2e yangi bazada
yiqilardi) — `33-dev-student-history.sql`; `35-progress-sample-data.sql` yangi volume'da dump'da
yo'q 4 foydalanuvchiga FK xatosi bilan init'ni to'xtatadi (**ochiq — egasining qarori**);
menyu `/me` tilni almashtirganda eski tilda qolardi — tuzatildi, `<html lang>` ham endi tilga ergashadi.

**O'lchov (2026-10-22, hammasi birlashgandan keyin):** backend build **0 warning / 0 error**,
to'rtala suite **721 passed, 0 failed, 4 skipped** · frontend **512 vitest** (ketma-ket 2 marta),
`tsc`, build yashil, bundle **160.4 / 180 KB gz** · kontrakt 0 xato (16 ogohlantirish) ·
NuGet zaif paket 0, `npm audit --omit=dev` high 0 · `openapi.json` qayta yaratilganda farq yo'q.

## 🔴 Bloklangan — foydalanuvchisiz bajarilmaydi

Bular unutilgani uchun emas, **ataylab** qilinmagan. Har biri sabab bilan:

| Faza | Nega bloklangan |
|---|---|
| ~~**0.1–0.4, 0.6, 0.7 · Prod zaxirasi**~~ | **Mavzudan chiqdi (2026-08-23)**: prod ma'lumoti ko'chirilmaydi, ya'ni qutqariladigan 50 foydalanuvchi yo'q. Zaxira **yo'qolmadi, ko'chdi** — o'rnatishdan **keyingi** ish bo'ldi: `deploy/INSTALL.md` 9.1 (kundalik cron o'sha kechaning o'zida) va `deploy/README.md` §"After the install". `preflight.sh` `live` rejimga o'tgach zaxira yo'qligini yana FAIL qiladi. |
| ~~**2.7 · Real prod hash bilan login**~~ | **Mavzudan chiqdi (2026-08-23)**: ko'chiriladigan hash yo'q. Login umuman parolsiz (telefon + Telegram OTP, `password_hash` NULL) va parolsiz **admin** kirishi lokal simulyatsiyada uchidan-uchiga sinaldi: OTP → token → `role=admin` → `/api/admin/stats` 200, tokensiz 401. |
| **5.5 · O'rnatishning server yarmi** | Tashqariga qaragan, qaytarib bo'lmaydigan amal: DNS, Let's Encrypt (soatiga 5 muvaffaqiyatsiz urinish limiti), haqiqiy Telegram bot, egasining o'z telefon raqami birinchi admin uchun. **Tayyorgarlik tugadi** — `deploy/INSTALL.md`, `bootstrap-admin.sh`, `smoke.sh`, va bo'sh volume'dan boshlangan lokal simulyatsiya yashil. Qolgani — droplet. |
| ~~**7.9 · C3/C6 qarori**~~ | **Qaror qilindi (2026-09-29, egasi): launch'dan keyin.** 5 ta kuratsiya ssenariy qoladi. `TEACHER-PANEL-PLAN.md` ataylab qilingan omissiyalar yozuvi sifatida saqlanadi. |

---

## 🎨 Kontrast — YOPILDI (qolgani: brend to'ldirishi, egasining qarori)

Holat: `axe` **680 → 16** `serious/color-contrast` node. `critical` = **0**.
O'lchov: 22 ekran × light/dark × mobil(390)/desktop(1440) = **88 skan**, har
biri `wcag2a+wcag2aa+wcag21a+wcag21aa`. `color-contrast` dan boshqa hech qanday
qoida buzilmaydi.

| Bosqich | Node | Nima qilindi |
|---|:--:|---|
| Boshlanish | **680** | — |
| `--muted` AA ga + `--faint` matn tokeni bo'lishdan to'xtadi | **177** | −503 |
| Semantik siyohlar + `--primary-ink` (ekranlar, `widgets/Nav`, admin dashboard) | **40** | −137 |
| `--primary-ink` (`shared/ui` Tabs + Badge) | **16** | −24 |

Har uch raqam **haqiqatan yugurtirilgan skanning** natijasi, oraliq baholash emas.

### Oldingi tahlildagi ikki xato — o'lchash bilan tuzatildi

**1. Fon noto'g'ri tanlangan edi.** Yuqoridagi eski jadval `--bg` ga qarab
o'lchagan va `--muted` uchun `0.550` yetarli degan. Aslida matn `--primary-tint`
(#ffe6d7) ustida ham turadi va **bog'lovchi fon o'sha** — AA shifti L **0.526**.
Shuning uchun `0.520`. Dark `--muted` ham 4.47:1 edi (`--surface-3` da) — eski
tahlil buni umuman ko'rmagan, chunki `--bg` da u 6.39 ko'rinadi.

**2. Savol noto'g'ri qo'yilgan edi.** "Uchta kulrang **va** AA birga bo'lmaydi"
— bu **rost**: `--ink-soft` L 0.450, AA shifti 0.526, ya'ni butun qonuniy band
0.076 kenglikda — bitta qadamga joy bor, ikkitaga yo'q. Lekin WCAG 1.4.3
**matn**ni boshqaradi, tokenni emas. `--faint` ning 73 ta iste'molchisidan
**59 tasi `<Text color="faint">`** edi — ya'ni so'z. Shuning uchun `--faint`
qayta bo'yalmadi, **matn tokeni bo'lishdan to'xtadi**: so'zlar `--muted` ga
ko'chdi, `--faint` o'z ochiq qiymatini dekoratsiya uchun saqladi (aria-hidden
glif, qulf/chevron/o'q belgisi, disabled OTP katagi — 1.4.3 nofaol
boshqaruvlarni istisno qiladi). Uchta daraja saqlandi, chunki uchinchisi endi
matn tashimaydi.

### Yakuniy qiymatlar (hammasi o'lchangan, taxmin emas)

| Token | Edi | Bo'ldi | Eng yomon nisbat | Izoh |
|---|---|---|:--:|---|
| light `--muted` | `0.600` #887e76 (3.32) | `0.520` #71675f | **4.61** | bog'lovchi fon `--primary-tint` |
| dark `--muted` | `0.680` #9e978f (4.47) | `0.700` #a49d95 | **4.81** | bog'lovchi fon `--surface-3` |
| `--faint` (ikkala mavzu) | — | **o'zgarmadi** | — | endi matn tashimaydi |
| light `--warn-ink` | `0.550` (4.29) | `0.530` #8b6400 | **4.68** | |
| light `--accent` | `0.545` (4.32) | `0.530` #4e61c4 | **4.63** | |
| light `--danger` | `0.605` (3.52) | `0.540` #bd3743 | **4.64** | oq yorliq ham 4.14→5.01 |
| light `--info` | `0.600` (3.33) | `0.520` #206ea6 | **4.65** | |
| dark `--accent` | `0.680` (4.38) | `0.695` | **4.54** | |
| dark `--danger` | `0.680` (4.14) | `0.705` | **4.56** | |
| `--success-ink` | *yangi* | `0.505` #007b3f | **4.65** | `--success` FILL bo'lib qoladi |
| `--primary-ink` | *yangi* | `0.535 0.165 40` #b93f02 | **4.65** | `--primary` FILL bo'lib qoladi |

`--success` va `--primary` **to'qlashtirilmadi** — ular asosan to'ldirish
(progress bar, tugma yuzi, logotip, talaffuz belgisi). Ularni matn uchun
to'qlashtirish har bir to'ldirishni buzardi. O'rniga `--warn-ink` pretsedenti
kengaytirildi: **`--primary` = to'ldirish, `--primary-ink` = so'z.** Brend
identiteti bir piksel ham o'zgarmadi.

`--primary-ink` xromasi 0.185 emas, **0.165** — sRGB bu yorqinlikda 0.185 ni
ushlolmaydi, ko'k kanal 0 ga qadaladi va e'lon qilingan qiymat renderlanган
qiymatdan farq qila boshlaydi.

### Qolgan 16 node — hammasi BITTA narsa, va u egasining qarori

O'lchov aniq: 88 skanning qolgan **16** nodesi **istisnosiz** bitta holat —
**brend rangi FON bo'lgan, ustida ochiq matn turgan** joylar. Kulrang yo'q,
`--faint` yo'q, semantik token yo'q, **dark mavzuda esa umuman yo'q**.

| Element | Matn | Fon | Nisbat | Kerak | Node |
|---|---|---|:--:|:--:|:--:|
| Asosiy tugma ("Boshlash", "+ Yaratish") | `--primary-on` #fffdfb | `--primary` #ed622a | **3.24** | 4.5 | 8 |
| Faol filtr tabletkasi ("Hammasi") | `--primary-on` #fffdfb | `--primary` #ed622a | **3.24** | 4.5 | 4 |
| Login/register sarlavha osti | `.heroSub` #fdede6 | `--primary` #ed622a | **2.88** | 4.5 | 4 |

**`--primary-ink` bu yerda yordam bermaydi** — muammo matnda emas, to'ldirishda.
AA uchun **fonning o'zi** to'qlashishi kerak:

> `--primary`: `oklch(0.665 0.185 40)` #ed622a → **`oklch(0.580 0.181 40)`** #cf4500
> — oq yorliq **3.24 → 4.59:1**.

Bu tugma yuzini va logotip ohangini o'zgartiradi, ya'ni **brend qarori**, texnik
emas. Shuning uchun tegilmadi. Egasi "ha" desa — `tokens.css` da bir qatorlik
ish; shunda `--primary-ink` ham keraksiz bo'lishi mumkin.

**Savol tor:** bu faqat **light mavzudagi to'ldirish**. Dark mavzuda muammo yo'q —
u yerda `--primary-on` qora siyoh (#190f0a) va yorqin apelsin ustida **7.12:1**.

### O'lchov qanday olingan (qayta yugurtiladigan)

88 skan = 22 ekran × {light, dark} × {390×844, 1440×900}, har biri
`axe-core` `wcag2a + wcag2aa + wcag21a + wcag21aa`. Skript sessiya
scratchpad'ida (`a11y/scan.mjs`) — `e2e/` ga tegilmadi. Autentifikatsiya
`e2e/auth.ts` bilan bir xil: `.env` konteynerga read-only ulanadi va HS256
token o'sha yerda mint qilinadi; sir tashqariga chiqmaydi.

Skrinshotlar (oldin/keyin, 5 ekran × light/dark) sessiya scratchpad'ida
`shots-a11y/`.

---

## Har sprint uchun DoD

- [ ] `dotnet build Govori.sln -c Release` — **0 warning, 0 error** (Docker'da)
- [ ] To'rtala suite: Unit · Arch · Characterization · Integration — 0 failed
- [ ] `tsc --noEmit` + `vite build` yashil
- [ ] Mobil (375px) + desktop (1440px) × light + dark tekshirildi
- [ ] `docs/` yangilandi
- [ ] Prod ma'lumotiga **tegilmadi**
