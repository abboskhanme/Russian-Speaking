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
| **S4** | **Yangi funksiyalar (flag ortida)** | **6.1 · 6.5** ✅; 6.2 · 6.3 · 6.6 · 6.7 · 6.8 ⬜ | 🟡 |
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
