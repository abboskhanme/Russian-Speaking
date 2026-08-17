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
3. **Prodga tegadigan hamma narsa — foydalanuvchi bilan.** 50 ta real
   foydalanuvchi bitta droplet'da yashaydi va zaxirasi yo'q. Cutover, prod
   backup, prod hash bilan login — bularning hech biri kechasi yolg'iz
   bajariladigan ish emas. Ular **bloklangan** deb belgilanadi, yashirilmaydi.

---

## Sprintlar

| # | Sprint | Nimani yopadi (08 bo'yicha) | Holat |
|---|---|---|:--:|
| **S1** | **AI provayder zanjiri** | Faza **3.4** — pipeline'ning yagona ishlamayotgan qismi | ✅ |
| **S2** | **Grader golden set + CI darvozasi** | Faza **1.4 · 1.5 · 1.6** | ✅ |
| **S3** | **Test va infratuzilma qarzi** | **2.5 · 3.10 · 4.1 · 4.11** ✅ · **4.2** ⬜ | 🟡 |
| **S4** | **Yangi funksiyalar (flag ortida)** | **6.1 · 6.5** ish jarayonida; 6.2 · 6.3 · 6.6 · 6.7 · 6.8 ⬜ | 🟡 |
| **S5** | **Zaxira skriptlari, tozalash, hujjatlar, yakuniy QA** | **0.5 (kod qismi)** ✅ · 7.x | 🟡 |

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
> ishonch beradi. Shuning uchun bu sprint **jgoldenning butun mashinasini**
> quradi (format, yuklovchi, ballash, chegara, CI darvozasi) va uni bor
> materialdan to'ldiradi; 40 ta real klip — foydalanuvchi bilan to'ldiriladigan
> bo'shliq, va u shunday deb yoziladi.

---

### S3 · Test va infratuzilma qarzi

| # | Qadam | Nega bu qarz |
|---|---|---|
| 3.1 | **2.5** Testcontainers | Integratsiya testlari umumiy dev Postgres'ga uriladi va qatorlarni o'zgartiradi — bitta parallel yugurish ikkovini ham buzadi |
| 3.2 | **3.10** TTFS instrumentatsiyasi | "p95 < 20s" hech qachon **o'lchanmagan**; o'lchovsiz maqsad — maqsad emas |
| 3.3 | **4.2** OpenAPI → TS klient | `shared/api/types.ts` qo'lda yozilgan; backend kontrakti jimgina siljisa, frontend buni kompilyatsiyada emas, prodda biladi |
| 3.4 | **4.11** Vitest + Playwright golden path + `axe` | CI hozir faqat `tsc` + `vite build` — ya'ni "kompilyatsiya bo'ldi" dan boshqa hech narsani isbotlamaydi |
| 3.5 | **4.1** Bundle budjeti CI'da | O'quvchi initial JS ≤ 180KB gz — budjetsiz u faqat o'sadi |

---

### S4 · Yangi funksiyalar — **feature flag ortida**

> Arxitektor tuzatishi 08 dan o'zgarmaydi: **cutover bularni kutmaydi.**
> Cutover funksiyalarga bog'lansa — u hech qachon sodir bo'lmaydi. Deploy ≠ release.

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

## 🔴 Bloklangan — foydalanuvchisiz bajarilmaydi

Bular unutilgani uchun emas, **ataylab** qilinmagan. Har biri sabab bilan:

| Faza | Nega bloklangan |
|---|---|
| **0.1–0.4, 0.6, 0.7 · Prod zaxirasi** | `134.209.240.56` ga kirishni talab qiladi. Zaxira olish — jonli mashinada bajariladigan amal; egasi yonida bo'lishi kerak. **Skript** tuzatiladi (5.1), **ishga tushirish** — yo'q. Bu hamon eng katta xavf: 50 ta real foydalanuvchi dunyoda bitta joyda. |
| **2.7 · Real prod hash bilan login** | Prod dump'iga bog'liq → Faza 0 ga bog'liq |
| **5.x · Cutover server yarmi** | Jonli prodni almashtiradi. Qaytarib bo'lmaydigan, tashqariga qaragan amal — hech qanday sharoitda yolg'iz bajarilmaydi |
| **7.9 · `TEACHER-PANEL-PLAN.md` + `dev-role.sh`** | C3/C6 **mahsulot qaroriga** bog'liq — texnik emas, egasining qarori |

---

## Har sprint uchun DoD

- [ ] `dotnet build Govori.sln -c Release` — **0 warning, 0 error** (Docker'da)
- [ ] To'rtala suite: Unit · Arch · Characterization · Integration — 0 failed
- [ ] `tsc --noEmit` + `vite build` yashil
- [ ] Mobil (375px) + desktop (1440px) × light + dark tekshirildi
- [ ] `docs/` yangilandi
- [ ] Prod ma'lumotiga **tegilmadi**
