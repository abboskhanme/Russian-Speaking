# 04 · IA, navigatsiya va ekran spetsifikatsiyasi

---

## 4.1 Axborot arxitekturasi

### O'quvchi — **3 ta** asosiy joy (hozirgi 7 tadan)

```
┌── Bosh sahifa (Главная)
│     Bugungi 5 daqiqa · streak · davom etayotgan modul · so'nggi natija
│
├── Mashq (Практика)              ← barcha gapirish yo'llari SHU YERDA
│     ├─ Modullar (kurslar)
│     ├─ Topshiriqlar (o'qituvchidan, muddat bilan)
│     ├─ Suhbat / Roleplay        ← YANGI
│     ├─ Eshit va takrorla (Shadowing)
│     └─ Takrorlash (Xato drill / SRS)
│
└── Progress (Прогресс)
      CEFR pozitsiya · radar · trend · yutuqlar · reyting
```

**Nima uchun 7 → 3.** Hozirgi sidebar: Bosh, Mashq, Modullar, Shadowing, Reyting, Progress, Aloqa.
"Modullar / Shadowing / Takrorlash" — bular **joylar emas, mashq turlari**. Ular «Mashq» ichida
yashashi kerak. "Reyting" — Progress ichida tab. "Aloqa" — sozlamalar/footer.

Mobil: bottom nav (3 ta) + markazda **FAB «Gapirish»** → to'g'ridan-to'g'ri bugungi mashqqa.
Desktop: chap sidebar (3 ta) + o'ng kontekst paneli (xl'da).

### O'qituvchi — savol bo'yicha bo'lingan, obyekt bo'yicha emas

```
├── Обзор       «Bugun kimga yordam kerak?» — chegaraviy javoblar, muddati o'tganlar
├── Контент     Modullar · Vazifalar · Mavzular · Ssenariylar
├── Классы      Guruhlar · O'quvchilar · Topshiriqlar (bulk assign)
├── Ответы      Tekshirish navbati (faqat AI ishonchsiz bo'lganlar birinchi)
└── Аналитика   Jurnal · Sinf insaytlari · Eksport
```

**Asosiy o'zgarish:** «Ответы» — 500 ta javob ro'yxati emas, **navbat**. AI ishonchli baholaganlar
avtomatik "OK". O'qituvchi faqat **ishonch pastligi**, **shikoyat**, yoki **keskin tushish**
bo'lganlarni ko'radi. Bu o'qituvchining haftalik 3 soatini qaytaradi.

### Admin
`Обзор · Пользователи (o'qituvchi+o'quvchi bitta jadval, filtr bilan) · Контент · AI va sozlamalar · Ops`

---

## 4.2 Asosiy oqim 1 — Vazifaga javob berish (yadro)

```
[Vazifa kartasi]
   Sarlavha · CEFR badge · uslub (Обычный/Живой) · davomiylik · qolgan urinishlar
   Media (rasm/video) — to'liq kenglikda, 16:9
   Shart (instruction) — ajratilgan, tint fonda
   [Tayyorman →]
        ↓
[Tayyorgarlik]  30s countdown halqa · Govo(idle) · «Fikringni yig'ib ol»
   [O'tkazib yuborish] har doim mavjud
        ↓
[Yozuv]  Govo(listening) — ichida jonli waveform
   Katta doira tugma (96px) · timer · maks vaqt bar
   [To'xtatish] → [Tinglash] [Qayta yozish] [Yuborish]
        ↓
[Baholash]  Govo(thinking) + BOSQICH INDIKATORI (§4.6)
   5s: transkript ekranga chiqadi (SSE) — kutish "bo'sh" emas
        ↓
[Natija]  → §4.3
```

**Qoidalar:**
- Yozuv **hech qachon yo'qolmaydi**: `IndexedDB`ga saqlanadi, internet uzilsa navbatga tushadi.
- "Qayta urinish" har doim, cheksiz (premium'da), hech qanday jazo.
- Vazifa matni yozuv paytida **ekranda qoladi** (scroll qilib ko'rish mumkin).

## 4.3 Asosiy oqim 2 — Natija (mahsulotning qiymat momenti)

```
┌────────────────────────────────────────────────────────────┐
│  ◯ 74        Govo(proud)          ← count-up 900ms, keyin konfetti
│  Уровень A2                        ← level_score, mutlaq band YASHIRIN
│                                                            │
│  «Тебя легко понять.»              ← 1 jumla, ≤ 12 so'z    │
├────────────────────────────────────────────────────────────┤
│  ✅ Yaxshi bo'ldi                                           │
│   · Gapirish sur'ating tabiiy                              │
│   · «потому что» bog'lovchisini to'g'ri ishlatding         │
├────────────────────────────────────────────────────────────┤
│  🎙 Sening javobing                                         │
│   Я ~~вчера~~ ходи́л в магази́н и купи́л хлеб.               │
│   ↑ har so'z rangli + chiziq uslubi · tap → fonema + 🔊    │
│   [▶ Audiongni eshit]  [▶ Namuna javob]                    │
├────────────────────────────────────────────────────────────┤
│  ✏️ Tuzatamiz (3 tadan 7 tasi)                              │
│   я идти в магазин  →  я иду́ в магази́н                    │
│   «Ketmoqda» hozirgi zamon: идти → иду.                    │
│   [Barchasini ko'rsatish (7)]                              │
├────────────────────────────────────────────────────────────┤
│  Mezonlar                                                   │
│   Ravonlik      ████████░░  78   [Yaxshilash →]            │
│   Lug'at        ██████░░░░  64   [Yaxshilash →]            │
│   Grammatika    █████░░░░░  52   [Mashq qilish →]          │
│   Talaffuz      ███████░░░  71   [Drill →]                 │
├────────────────────────────────────────────────────────────┤
│  [Qayta urinish]              [Keyingi vazifa →]           │
└────────────────────────────────────────────────────────────┘
```

**Har bir raqamning ortida harakat bor.** «Grammatika 52» → tap → *родительный падеж* drill'i,
o'sha **shu javobdagi** xatodan yaratilgan. Bu — mahsulotning eng kuchli halqasi:
**xato → drill → qayta urinish → o'sish.**

Yashiringan (lekin saqlanadi): `overall_band` (mutlaq C2). Faqat Progress sahifasida
"Mutlaq daraja" sifatida, kichik matnda.

## 4.4 Asosiy oqim 3 — Roleplay (YANGI, F1)

```
[Ssenariy tanlash]  8–12 ta karta: «В аптеке» · «Собеседование» · «У врача» · «В такси»
   Har birida: CEFR, davomiylik (~4 daq), maqsad («Дозировку узнать»)
        ↓
[Suhbat]  AI birinchi gapiradi (TTS) → o'quvchi javob beradi (yozuv) → AI javob beradi …
   · Ekranda: 2 ta pufak (AI / sen) + transkript
   · [Yordam] tugmasi: 3 ta taklif iborasi (past darajada)
   · [Tugatish] har doim
   · 6–10 turn
        ↓
[Yakun]  Suhbat bo'yicha: maqsadga yetdingmi? · ravonlik · 3 ta foydali ibora
   · Har turn'ning talaffuzi ko'rish mumkin
   · [Yana urinish] (boshqa yo'nalishda)
```

**Texnik:** turn-based (real-time full-duplex emas — narx va murakkablik). Har turn = 1 ta
`Attempt(kind=roleplay)`. AI javobi qisqa (≤ 2 jumla), o'quvchi darajasiga moslashadi.
**Xavfsizlik:** ssenariy prompt'i qattiq, o'quvchi transkripti data sifatida kiritiladi.

## 4.5 Asosiy oqim 4 — Kunlik 5 daqiqa (F3)

Bosh sahifada **bitta** katta karta:

```
┌─────────────────────────────────┐
│  Govo(idle)                     │
│  Bugungi 5 daqiqa               │
│  🔥 12 kun                       │
│  ● ○ ○   3 qadam                │
│  [Boshlash →]                   │
└─────────────────────────────────┘
```

3 qadam, avtomatik yig'iladi:
1. **Isinish** — 3 ta shadowing iborasi (30s)
2. **Gapirish** — 1 ta vazifa, darajaga mos (3 daq)
3. **Tuzatish** — 1 ta drill, kechagi xatodan (1.5 daq)

Tugagach: streak +1, XP, Govo `celebrate`. **Bu — retention mashinasi.**

## 4.6 Kutish ekrani (TTFS ni "his qilinadigan" qiladi)

Bo'sh spinner **taqiqlanadi**. SSE bosqichlari ko'rsatiladi:

```
   Govo(thinking)

   ✓ Ovozing eshitildi          1.2s
   ✓ Matnga aylantirildi        4.1s
     ┌ «я вчера ходил в магазин и…»   ← DARHOL ko'rsatiladi
   ⟳ Talaffuzni tekshiryapman
   ○ Grammatikani ko'ryapman
```

Bu psixologik jihatdan 20 soniyani 8 soniyaday his qildiradi. Real TTFS ham qisqaradi (§02 §2.4).

## 4.7 Onboarding (aktivatsiya, TTFV < 5 daq)

```
1. Til tanlash (uz/ru/en)                     ← 5s
2. «Nima uchun rus tili?»  (ish · o'qish · migratsiya · o'zim uchun)   ← personalizatsiya
3. Joylashtiruv (F4): 3 ta savol, 2 daqiqa    ← DARHOL gapirtiriladi, ro'yxatdan oldin!
4. Birinchi ball + Govo(proud)                ← ⭐ QIYMAT MOMENTI
5. «Natijangni saqlash uchun ro'yxatdan o't»  ← ro'yxatdan o'tish SHU YERDA
6. Kunlik maqsad tanlash (5/10/20 daq)
```

> **Eng muhim o'zgarish:** ro'yxatdan o'tish **birinchi ballan keyin**. Hozir `GuestDemo.tsx`
> bor — u aynan shu funksiya, lekin oqimning markazida emas. Uni markazga qo'yamiz.

## 4.8 O'qituvchi: «Bugun kimga yordam kerak?» (Обзор)

```
┌── E'tibor talab qiladi ────────────────────┐
│  ⚠︎ 3 ta javob — AI ishonchi past          │  → tekshirish navbati
│  📉 2 o'quvchi 2 haftada 15 punkt tushdi   │  → profil
│  ⏰ 5 topshiriq muddati bugun tugaydi       │  → eslatma yuborish (1 tap)
└────────────────────────────────────────────┘
┌── Shu haftaning sinf xatolari (F6) ────────┐
│  родительный падеж      12 o'quvchi        │  [Remediation topshirish →]
│  ударение: «звони́т»     9 o'quvchi         │  [Drill topshirish →]
└────────────────────────────────────────────┘
```

**Bir tap = bitta harakat.** O'qituvchi ro'yxatlarni varaqlamaydi — tizim unga nima qilish kerakligini
aytadi.

## 4.9 Ekranlar ro'yxati (hozirgi → maqsad)

| Hozirgi | Maqsad | Holat |
|---|---|---|
| `StudentHome` | `Home` — Kunlik 5 daqiqa markazda | ♻️ qayta ishlanadi |
| `StudentQuestions` + `StudentModules` + `StudentAssignments` + `Shadowing` + `Review` | **`Practice`** — bitta sahifa, 5 ta tab | 🔀 birlashtiriladi |
| — | **`Roleplay`** + `RoleplaySession` | ✨ yangi |
| — | **`Drill`** (fonema / minimal juftlik) | ✨ yangi |
| — | **`Placement`** | ✨ yangi |
| `AnswerQuestion` | `AnswerTask` | ♻️ |
| `SubmissionResult` (1124 q.) | `AttemptResult` + 6 widget | ✂️ bo'linadi |
| `StudentProgress` + `Leaderboard` | `Progress` (tab: Ko'nikmalar · Yutuqlar · Reyting) | 🔀 |
| `TeacherDashboard` | `TeacherOverview` — harakat markazi | ♻️ to'liq |
| `TeacherSubmissions` | `ReviewQueue` — navbat, ro'yxat emas | ♻️ to'liq |
| `TeacherQuestions` + `TeacherBlocks` + `TeacherTopics` | `Content` (tab) | 🔀 |
| `TeacherGroups` + `TeacherStudents` + `TeacherAssignments` | `Classes` (tab) | 🔀 |
| `TeacherGradebook` + `TeacherReview` | `Analytics` (+ `ClassInsights`) | 🔀 |
| `AdminTeachers` + `AdminStudents` | `Users` (bitta jadval + rol filtri) | 🔀 |
| `Contact` | Sozlamalar ichiga / footer | ⬇️ |
| `PremiumInfo` | `Plans` (+ Payme/Click) | ♻️ |

**Natija:** o'quvchi uchun 11 ta sahifa → **6 ta**. O'qituvchi uchun 10 ta → **5 ta**.
Kod kamayadi, tushunish osonlashadi, mobil navigatsiya nihoyat mumkin bo'ladi.

## 4.10 Ekran maketi qoidalari

- Har sahifa: `PageHeader` (sarlavha + harakat) → kontent. Breadcrumb yo'q (chuqurlik ≤ 2).
- Sahifa ildizi **to'liq kenglik**. Ichkarida grid: `.split` (1.7fr / 310px) yoki `.g3`.
- Birlamchi harakat: desktop'da o'ng-yuqori, mobilda pastki yopishqoq bar.
- Bo'sh yuza dushman emas — natija va yozuv ekranlarida ≥ 40%.
- Jadval mobilda **kartochkaga** aylanadi (horizontal scroll emas).
</content>
</invoke>
