# 01 · Mahsulot strategiyasi

---

## 1.1 Muammo

O'zbekistonda rus tili **ish tili** (biznes, tibbiyot, IT-autsorsing, migratsiya). Millionlab odam
rus tilini *o'qiy oladi*, lekin **gapira olmaydi**. Sabab bitta:

> **Gapirish mashqi qimmat va qo'rqinchli.** Repetitor soatiga pul; guruhda 20 kishi bor, sizga
> 2 daqiqa tegadi; xato qilsangiz — uyalasiz.

Mavjud yechimlar shu muammoni yechmaydi:
- **YouTube / kanal / kitob** — passiv. Og'iz ochilmaydi.
- **Repetitor** — qimmat, kam takrorlash, feedback subyektiv.
- **Duolingo** — rus tili kursi bor, lekin **gapirishga** deyarli tegmaydi va o'zbek tilida yo'q.
- **ELSA Speak / Speak / Praktika** — faqat **ingliz** tili.

**Bo'shliq:** rus tilida gapirishni o'rgatadigan, o'zbek tilida tushuntiradigan, cheksiz sabrli,
arzon AI trenajor. Hozir bunday mahsulot yo'q.

---

## 1.2 Kim (ICP)

| Segment | Ulush (maqsad) | Nima uchun to'laydi |
|---|---|---|
| **P1 · Maktab/kollej o'quvchisi (13–18)** o'qituvchisi orqali keladi | 60% | O'qituvchi majbur qiladi; ota-ona to'laydi. |
| **P2 · Kattalar (20–35)**: ish/migratsiya/tibbiyot uchun rus tili | 25% | Konkret maqsad, o'zi to'laydi, tez natija kutadi. |
| **P3 · O'qituvchi / repetitor** | 15% (lekin **distribution kanali**) | 30 ta o'quvchining javobini tinglashdan qutuladi. |

**Eng muhim insayt:** o'qituvchi — mijoz emas, **kanal**. Bitta o'qituvchi 30 o'quvchi olib keladi.
Shuning uchun o'qituvchi UX'i o'quvchiniki qadar muhim, lekin **boshqa qonunlar bilan**: o'quvchiga
motivatsiya kerak, o'qituvchiga **vaqt tejash** kerak.

---

## 1.3 Raqobat va farqlanish

> Quyidagilar umumiy bilimga asoslangan pozitsion xarita, tekshirilmagan bozor tadqiqoti emas.

| Mahsulot | Kuchli tomoni | Bizga saboq |
|---|---|---|
| **Duolingo** | Odat qurish mexanikasi (streak, XP, ligalar) | Streak/XP **oling**, ligalar/pasaytirishni **olmang** (arXiv: tashlab ketishga olib keladi). |
| **ELSA Speak** | Fonema darajasidagi talaffuz feedback | Bizda Azure per-word accuracy **allaqachon bor** — ishlatilmayapti. Bu tayyor xandaq. |
| **Speak / Loora / Praktika** | AI bilan **erkin suhbat** (roleplay) | Bu bizdagi **eng katta bo'shliq**. Speaking mashqining eng qadrli shakli. |
| **Cambly / italki** | Jonli inson | Biz raqobatlashmaymiz — biz **odam oldiga chiqishdan oldingi** mashq maydonimiz. |
| **Busuu** | Community feedback | Keyinroq: o'quvchilar bir-birining javobiga ovozli izoh. |

### Farqlanish (moat) — 3 ta

1. **Til juftligi: RU o'rganish + UZ tushuntirish.** Hech kim buni qilmaydi. Feedback o'zbekcha
   berilsa, A1–B1 o'quvchi tushunadi; ruscha berilsa — tushunmaydi va tashlab ketadi.
2. **Orfoepiya va jonli/kitobiy uslub ajratmasi.** `ru_style: regular | live` allaqachon modelda bor.
   Rus tilining o'ziga xos muammosi (что → "што", его → "ево") — biz uni **maxsus tekshiramiz**.
   Global mahsulotlar buni qilmaydi.
3. **Sinf halqasi (classroom loop).** O'qituvchi → topshiriq → AI baholaydi → o'qituvchi faqat
   *chegaraviy holatlarni* ko'radi. Bu B2B2C tarqalish va retention.

**Pozitsiya bayoni:**
> *Govori — o'zbekzabon o'quvchi uchun rus tilida gapirishni mashq qiladigan AI trenajor.
> Cheksiz sabrli, har so'zning talaffuzini ko'rsatadi, o'zbekcha tushuntiradi.*

---

## 1.4 Mahsulot printsiplari (har bir dizayn qarorining hakami)

1. **Ovoz — birinchi sinf fuqarosi.** Har ekranda "gapirish" tugmasi 1 ta tapdan uzoq bo'lmasin.
2. **Xato — bepul.** Hech qachon jazo, hech qachon uyaltirish. Cheksiz qayta urinish.
3. **Avval kuch, keyin tuzatish.** Natijada strengths → 3 ta correction → "hammasi (N)".
4. **Qisqa feedback.** Uzun matn — kognitiv yuk. 1 ta gap + 1 ta harakat.
5. **Har raqamning ortida harakat bor.** "Grammatika 62" emas — "Grammatika 62 → *падежи* mashqi".
6. **O'qituvchining vaqti muqaddas.** Har ekran savolga javob bersin: *"Kimga hozir yordam kerak?"*
7. **Mobil — birlamchi.** Auditoriyaning 85%+ telefonda. Desktop — o'qituvchi uchun.
8. **To'liq kenglik.** Hech qachon `mx-auto max-w-*` sahifa ildizida.

---

## 1.5 Metrikalar (North Star + sog'liq)

**North Star: haftada gapirilgan daqiqalar (Weekly Speaking Minutes / WSM).**
XP emas, session emas — **haqiqiy og'iz ochish vaqti**. U yagona metrikaki, o'sishi o'rganishni
kafolatlaydi va uni "farm" qilib bo'lmaydi.

| Guruh | Metrika | Boshlang'ich maqsad |
|---|---|---|
| Aktivatsiya | Ro'yxatdan → 1-ball olish (TTFV) | < 5 daqiqa, ≥ 60% |
| Retention | D7 / D30 (o'quvchi) | 35% / 18% |
| Engagement | WSM / faol o'quvchi | ≥ 25 daq/hafta |
| **Natija** | 8 haftada `level_score` o'sishi | +8 punkt (median) |
| Tezlik | Yuborish → ball (p95) | **< 20 s** (hozir ~30–45 s) |
| Birlik iqtisodi | AI xarajati / urinish | < $0.012 |
| Kanal | Faol o'qituvchi boshiga faol o'quvchi | ≥ 12 |
| O'qituvchi | Har hafta gradebook ochish | ≥ 70% |

> **Natija metrikasi (`level_score` o'sishi) — mahsulotning haqiqiy va'dasi.** Uni o'lchamaslik =
> "o'ynatadigan, lekin o'rgatmaydigan" mahsulot qurish.

---

## 1.6 Biznes-model

**Bugungi:** 3 ta bepul urinish (`FREE_ATTEMPT_LIMIT`) + har modulning birinchi 3 vazifasi bepul
(`FREE_TASKS_PER_MODULE`), keyin premium; premiumni **o'qituvchi/admin qo'lda beradi**.

**Maqsad (Faza 3+):**

| Plan | Narx (taxminiy) | Nima kiradi |
|---|---|---|
| **Bepul** | 0 | Kuniga 3 urinish, shadowing cheksiz, ball + qisqa feedback. |
| **Pro** | ~35 000 so'm/oy | Cheksiz urinish, roleplay, fonema drill, batafsil feedback, review SRS. |
| **Sinf (o'qituvchi)** | ~o'quvchi boshiga 20 000 so'm/oy | Pro + gradebook + guruh analitikasi + bulk assign. |
| **Maktab / markaz** | shartnoma | Sinf + SSO + brending + eksport. |

**To'lov:** Payme + Click (O'zbekiston realligi). Karta saqlash → avto-yangilanish.
**Telegram** — bozorning asosiy kanali: eslatma, streak, "bugungi 5 daqiqa" bot orqali.

**Paywall qoidasi (o'zgarmas):** paywall **faqat qiymat ko'rsatilgandan keyin** chiqadi —
o'quvchi birinchi ballini olib, "har so'zim rangli!" deganidan **keyin**. Hech qachon oldin.

---

## 1.7 Mahsulot bo'shliqlari → yangi imkoniyatlar

Auditdan kelib chiqqan holda, quyidagilar bizni "yaxshi MVP"dan "top mahsulot"ga o'tkazadi:

| # | Feature | Nega | Murakkablik |
|---|---|---|---|
| **F1** | **Roleplay: AI bilan ovozli suhbat** (10 ta ssenariy: shifokorda, ishga suhbat, do'konda…) | Speaking mashqining oltin standarti. Eng katta raqobat bo'shlig'i. | Yuqori |
| **F2** | **Fonema drill + minimal juftliklar** (ы/и, ш/щ, твёрдый/мягкий) | Azure ma'lumoti tayyor. ELSA-darajali qiymat, past narx. | O'rta |
| **F3** | **Kunlik 5 daqiqa** — bitta yaxlit sessiya: shadowing → 1 vazifa → 1 drill | Odat qurish. WSM'ni to'g'ridan-to'g'ri oshiradi. | O'rta |
| **F4** | **Joylashtiruv testi (placement)** — 2 daqiqa, CEFR aniqlanadi | Personalizatsiya + aktivatsiya. | Past |
| **F5** | **Xato-replay drill** (SRS UI) | `ReviewItem` modeli **bor**, UI yo'q. Yarim tayyor. | Past |
| **F6** | **Sinf insaytlari** — "shu hafta 12 o'quvchi *родительный падеж*da qoqildi → 1 tap bilan remediation topshiriq" | O'qituvchini bog'lab qo'yadi. | O'rta |
| **F7** | **Real-time natija (SSE)** + kutish ekranida "AI nima qilyapti" | 20–40s kutish — eng zaif nuqta. | Past |
| **F8** | **Telegram bot** (eslatma, streak, mikro-shadowing) | O'zbek bozorida push ≠ Telegram. | O'rta |
| **F9** | **PWA + offline navbat** | Mobil internet uzilsa yozuv yo'qolmasin. | O'rta |
| **F10** | **Payme/Click** | Pul. | O'rta |

Ketma-ketlik → [`05-ROADMAP.md`](./05-ROADMAP.md).
</content>
</invoke>
