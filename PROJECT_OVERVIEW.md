# «Говори по-русски» (RusSpeak) — Loyihaning to'liq tarifi

> Dizayn brifi. Yangi UI/dizayn yaratish uchun mo'ljallangan — barcha rollar, ekranlar,
> oqimlar, his-tuyg'u (cozy / non-childish), ranglar va o'zaro ta'sir qoidalari.

## 1. Loyiha nima haqida (bir jumlada)

Bu — **rus tilini gapirishni (speaking) mashq qilish uchun AI platformasi**. IELTS Speaking
imtihoni uslubida qurilgan, lekin faqat rus tiliga moslangan. O'qituvchi savol beradi →
o'quvchi mikrofonga **gapirib javob beradi (ovozi yoziladi)** → sun'iy intellekt javobni
tahlil qiladi va **baho + maslahat (feedback)** qaytaradi.

Maqsadi: o'quvchi qo'rqmasdan, cheksiz mashq qilib, gapirish ko'nikmasini oshirishi.
Hech qanday "jazo" yo'q — xato qilsa ham bemalol qayta urinadi.

---

## 2. Kim foydalanadi (rollar)

Platformada **3 xil foydalanuvchi** bor, har biriga alohida interfeys kerak:

| Rol | Kim | Asosiy ishi |
|-----|-----|-------------|
| **Student (o'quvchi)** | Rus tilini o'rganuvchi (asosan o'smirlar) | Savollarga ovozli javob beradi, baho oladi, mashq qiladi, progressini kuzatadi |
| **Teacher (o'qituvchi)** | Repetitor / o'qituvchi | Savol va topshiriq yaratadi, guruh ochadi, o'quvchilar javobini ko'radi, baho qo'yadi, izoh yozadi |
| **Admin** | Platforma egasi | O'qituvchi va o'quvchilarni boshqaradi, umumiy statistika |

---

## 3. Asosiy ish oqimi (eng muhim jarayon)

```
O'quvchi savolni ochadi
   → (tayyorgarlik vaqti) → mikrofonga gapiradi (ovoz yoziladi, jonli to'lqin/waveform ko'rinadi)
   → javobni yuboradi
   → AI ishlaydi (kutish ekrani, mascot + animatsiya):
        • Ovoz → matn (transkripsiya)
        • Talaffuzni baholash (har bir so'z bo'yicha)
        • Grammatika / lug'at / izchillikni tahlil qilish
   → NATIJA ekrani:
        • Umumiy ball (0–9 band, IELTS kabi)
        • 4 mezon bo'yicha ballar
        • Avval KUCHLI tomonlar (rag'batlantirish), keyin tuzatishlar
        • Har bir so'z talaffuzi rangli (yashil/sariq/pushti)
        • Konfetti animatsiyasi (birinchi marta ball ochilganda)
```

**Muhim dizayn falsafasi (tadqiqotdan):**
- Xato qilish **jazolanmaydi** — qayta urinish cheksiz va bepul (ruhiy bosim yo'q).
- Feedback **qisqa** bo'lishi kerak (uzun matn ortiqcha yuk beradi). Tuzatishlar **eng ko'pi
  3 ta** ko'rsatiladi, qolgani "hammasini ko'rsatish (N)" tugmasi ostida.
- Avval **kuchli tomonlar**, keyin xatolar — o'quvchini cho'chitmaslik uchun.
- Har bir ball yoniga **"qanday yaxshilash" harakati** qo'shiladi (faqat raqam emas).

---

## 4. Baholash tizimi (rubrika)

Har bir javob **0–9 band** (IELTS shkalasi) bo'yicha, 4 mezon:

| Mezon | Ruscha | Nimani o'lchaydi |
|-------|--------|------------------|
| Fluency & Coherence | Беглость и связность | Gapirish ravonligi, pauzalar, fikr bog'liqligi |
| Lexical Resource | Лексический запас | Lug'at boyligi |
| Grammar | Грамматика | Grammatik to'g'rilik va xilma-xillik |
| Pronunciation | Произношение | Talaffuz (har bir so'z darajasida) |

→ **Umumiy band** = o'rtacha, 0.5 ga yaxlitlanadi.

Feedback **uch tilda** beriladi: ruscha + o'zbekcha (interfeys uz/ru/en).

---

## 5. Mavjud sahifalar / ekranlar (real holat)

### O'quvchi (Student) ekranlari
- **Главная (Bosh sahifa)** — sokin, kam elementli: bitta asosiy "focus" karta + 3 ta
  statistika + eslatmalar + so'nggi javoblar.
- **Savollar ro'yxati** (StudentQuestions) — javob berish mumkin bo'lgan savollar.
- **Savolga javob berish** (AnswerQuestion) — ovoz yozish ekrani (recorder + jonli waveform).
- **Natija** (SubmissionResult) — ball, transkripsiya, tuzatishlar, har so'z talaffuzi.
- **Topshiriqlar** (Assignments) — o'qituvchi bergan, muddatli vazifalar.
- **Progress (Прогресс) hubi** — radar grafik (mezonlar bo'yicha), ball trendi (sparkline),
  yutuqlar (achievements), reyting, takrorlash.
- **Mashq: Shadowing** (Listen-and-repeat) — tayyor ruscha iboralarni eshitib, takrorlab
  aytish; faqat talaffuz baholanadi.
- **Review (Takrorlash)** — zaif ko'nikmalar bo'yicha interval takrorlash (SRS).
- **Reyting** (Leaderboard) — haftalik + umumiy (sizning atrofingizdagi 5 kishi, raqobat
  bosimisiz).
- **Premium ma'lumot** sahifasi.

### O'qituvchi (Teacher) ekranlari
- **Обзор (Dashboard)** — umumiy ko'rinish, tezkor havolalar.
- **Savollar** (TeacherQuestions) — savol yaratish/tahrirlash, nusxalash.
- **Savol yaratish** (CreateQuestion) — 3 tur: matn / rasm / video + topshiriq matni +
  namuna javob (AI yaratishi mumkin).
- **Mavzular** (Topics).
- **Topshiriqlar** (Assignments) — muddat bilan, alohida o'quvchiga yoki butun guruhga.
- **Guruhlar** (Groups) + **Guruh hubi** (GroupDetail) — 2 ta oddiy tab (Ученики / Задания),
  kim bajardi (yashil) / kim bajarmadi (qizil).
- **O'quvchilar** (Students) — qidirish, premium berish/olib qo'yish.
- **Javoblar** (Submissions) — o'quvchilar javoblarini ko'rish, **qo'lda izoh + ball qo'yish**
  (AI bahosini bekor qilish).
- **Журнал (Gradebook)** — sinf jurnali, analitika, CSV eksport.

### Admin ekranlari
- Dashboard, O'quvchilar, O'qituvchilar, Testlar.

### Umumiy
- Login / Register (email/parol + **Google bilan kirish**), Sozlamalar, Bildirishnomalar,
  Til almashtirgich (uz/ru/en), 404.

---

## 6. O'yinlashtirish (Gamification) — o'smirlar uchun

- **XP (ballar)** — har javob/mashq uchun.
- **Streak (kunlik seriya)** + **streak freeze** (muzlatish, har 5 kunda beriladi) + yumshoq
  "streak repair". **Seriya yo'qolganda hech qachon uyaltirmaydi.**
- **Yutuqlar (achievements/badges)** — birinchi javob, 7 kunlik seriya, band bosqichlari va h.k.
- **Haftalik reyting** (yumshoq, faqat qo'shni 5 kishi; ligalar/tushirish YO'Q — bu
  demotivatsiya qiladi).
- **Kunlik maqsad** (daily goal).
- **Konfetti / mascot** — yutuq paytlari, ball ochilganda (nozik, bolalarcha emas).

---

## 7. Biznes-model (freemium)

- O'quvchi **3 ta bepul urinish** oladi (`FREE_ATTEMPT_LIMIT=3`).
- Keyin paywall (402) — lekin **qiymat ko'rsatilgandan keyin** (ball olgach), oldin emas.
- **Premium** — hozircha to'lov tizimi yo'q; **o'qituvchi yoki admin qo'lda beradi**.
  To'lov (Payme/Click) keyinroq qo'shiladi.

---

## 8. Dizayn yo'nalishi (juda muhim!)

1. **"Cozy, cute-but-not-childish"** — iliq, yoqimli, ammo bolalarcha emas. Duolingo
   uslubidagi: dumaloq geometrik shakllar, bir xil burchak radiuslari, cheklangan rang
   palitrasi, oddiy shakllardan tuzilgan personaj (mascot).
2. **To'liq kenglik qoidasi** — har bir sahifa/bo'lim **butun ekran kengligini egallaydi**;
   hech qachon markazga siqib qo'yilmaydi (sahifa ildizida `mx-auto max-w-*` ishlatilmaydi).
3. **Mobile-first** — telefon birinchi, keyin desktop. Modallar telefonda to'liq balandlik,
   bosishda `active:scale` his-tuyg'usi.
4. **Font:** Nunito (iliq, dumaloq).
5. **Rang tokenlari:** brand palette + success/warn/danger; iOS uslubidagi ranglar; dark
   mode imkoniyati.
6. **Loading skeletonlar** (to'liq sahifa spinner emas).
7. **Mascot** — do'stona bo'sh holatlar (empty states), nishonlash lahzalari, streak alangasi.
8. **A11y** — faqat rang bilan emas (ikona + rang), fokus holatlari, kontrast.
9. **O'quvchi UI ataylab soddalashtirilgan** — kam tartibsizlik: pastki navigatsiya faqat
   **3 ta** (Главная / Практика / Прогресс).
10. **O'qituvchi navigatsiyasi:** Обзор / Задания / Группы / Ответы / Журнал.

---

## 9. Texnik stek (kontekst uchun)

- **Frontend:** React 18 + TypeScript + Vite + Tailwind CSS + shadcn/ui, TanStack Query,
  Zustand, React Router, i18n (uz/ru/en).
- **Backend:** Python FastAPI + SQLAlchemy + Celery + Redis.
- **AI:** Azure Speech (ovoz→matn + talaffuz baholash), Gemini (band baholash, RU+UZ feedback).
- **Saqlash:** PostgreSQL (metadata), S3/MinIO (audio fayllar).
- **Ovoz:** brauzer MediaRecorder API + jonli waveform (canvas).
