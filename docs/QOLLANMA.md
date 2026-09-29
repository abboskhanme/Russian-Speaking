# Govori — foydalanuvchi qo'llanmasi

Govori (govorim.uz) — rus tilida gapirishni ovoz orqali mashq qilish uchun ilova.
O'quvchi vazifani o'qiydi, javobini ovoz bilan yozib yuboradi, sun'iy intellekt (AI)
uni baholaydi, o'qituvchi esa baholarni tekshiradi.

Qo'llanma to'rt qismdan iborat: **Admin uchun**, **O'qituvchi uchun**,
**O'quvchi uchun** va **Savol-javoblar**. O'zingizga tegishli qismni o'qing.

---

## 1. Kirish

### 1.1 Uchta rol

| Rol | Kim | Nima qiladi |
|---|---|---|
| **O'quvchi** | Rus tilini o'rganuvchi | Vazifalarga ovozli javob beradi, natijalarini ko'radi |
| **O'qituvchi** | Guruh olib boruvchi ustoz | Guruh ochadi, vazifa yaratadi va beradi, javoblarni tekshiradi |
| **Admin** | Platforma egasi | O'qituvchilarni qo'shadi, rasmiy kontentni yaratadi, sozlamalarni boshqaradi |

Har bir rol o'z paneliga tushadi: o'quvchi — o'quvchi ilovasiga, o'qituvchi —
o'qituvchi paneliga, admin — admin paneliga. Boshqa rolning sahifasini ochib bo'lmaydi.

### 1.2 Tizimga kirish (parol yo'q)

Govori'da parol yo'q. Kirish har doim telefon raqami va Telegram orqali keladigan
6 xonali kod bilan bo'ladi.

1. govorim.uz saytini oching va **Kirish** ni tanlang.
2. Telefon raqamingizni kiriting (+998 dan keyingi 9 ta raqam).
3. **Kodni olish** tugmasini bosing.
4. **Telegram'da oching** tugmasini bosing — Govori boti ochiladi.
5. Birinchi marta bo'lsa: botda **START** ni bosing va **o'z raqamingizni** yuboring
   (kontakt ulashish). Kod shu yerga keladi.
   Keyingi safarlarda kod botga to'g'ridan-to'g'ri keladi.
6. Kodni saytga kiriting va **Tasdiqlash** ni bosing.

<!-- SCREENSHOT: Kirish sahifasi — telefon raqam maydoni va "Kodni olish" tugmasi -->
<!-- SCREENSHOT: "Kodni tasdiqlang" oynasi — "Telegram'da oching" tugmasi va 6 ta katak -->

Bilish kerak:

- Botga **faqat o'z raqamingizni** yuboring. Boshqa odamning kontaktini yuborsangiz
  yoki Telegram'dagi raqam kiritilgan raqamga mos kelmasa, kod bekor qilinadi.
  **Raqamni qaytadan kiritish** tugmasini bosib, boshidan boshlang.
- Kodni qayta so'rash uchun **Kodni qayta yuborish** tugmasi bor. Tugma bir necha
  soniya kutib turadi — qancha qolgani tugmada yoziladi.
- Kodni ko'p marta noto'g'ri kiritsangiz, kirish bir necha daqiqaga yopiladi.
  Ekranda necha daqiqa kutish kerakligi yoziladi.

### 1.3 Bepul va Premium

- Har bir **rasmiy** modulning (admin yaratgan, hammaga ko'rinadigan modul)
  **dastlabki 3 ta vazifasi bepul**. Keyingilari uchun Premium kerak.
- O'qituvchi o'z guruhi uchun yaratgan modullar **to'liq bepul** — ularda Premium
  qulfi yo'q.
- **Onlayn to'lov hali ulanmagan.** Premiumni hozircha faqat ikki yo'l bilan olish
  mumkin: o'qituvchi o'z o'quvchisiga beradi yoki admin istalgan o'quvchiga beradi.

---

## 2. Admin uchun

### 2.1 Birinchi kun — tartib bilan

Yangi o'rnatilgan platformada **hech narsa yo'q**: modul ham, vazifa ham,
o'qituvchi ham. O'quvchi kirsa, bo'sh ro'yxatni ko'radi. Shuning uchun birinchi
kuni quyidagilarni shu tartibda bajaring.

1. **Kiring.** Birinchi admin hisobini serverni o'rnatgan mutaxassis sizning
   telefon raqamingizga ochib beradi. Keyin 1.2 bo'limdagi kabi kirasiz —
   tizim sizni admin paneliga olib boradi.
2. **Rasmiy modul yarating** (2.2 bo'lim).
3. **O'qituvchi qo'shing** (2.3 bo'lim).
4. **Sozlamalar → Aloqa havolalari** ni to'ldiring (2.7 bo'lim). Bu havolalar
   o'quvchining "Yordam markazi" oynasida chiqadi. Yangi platformada ular bo'sh.
5. Oddiy telefon bilan o'quvchi sifatida ro'yxatdan o'ting, bitta javob yuboring
   va baho kelishini kuting. Bu hamma narsa ishlayotganini tekshirishning yagona
   ishonchli yo'li.

Admin panelining menyusi: **Boshqaruv · O'qituvchilar · O'quvchilar · Kontent ·
Tariflar · Sozlamalar**. Telefonda ikkitasi qisqa yoziladi: "Bosh" va "Ustozlar".
Profilingiz yuqoridagi avatar (rasm) orqali ochiladi.

<!-- SCREENSHOT: Admin paneli — "Boshqaruv" sahifasi va menyu -->

### 2.2 Kontent — rasmiy modul yaratish

Rasmiy modulni **har bir o'quvchi** ko'radi — guruhi bo'lmasa ham.

1. **Kontent** bo'limini oching.
2. Katalog bo'sh bo'lsa, **Birinchi modulni yaratish** ni bosing. Aks holda
   **+ Yaratish** ni bosing. "Yangi modul" nomli qoralama modul ochiladi.
3. **Modul nomi**, **Tavsif** va **Daraja** (A1–C1) ni to'ldiring, **Saqlash** ni bosing.
4. **Ko'rinish** bo'limida **Rasmiy (barcha o'quvchilar)** tanlanganini tekshiring.
   Admin yaratgan modul avtomatik shu holatda bo'ladi.
   - **Guruh** — faqat modul muallifining guruhlaridagi o'quvchilar ko'radi.
   - **Shaxsiy** — o'quvchilarga ko'rinmaydi.
5. **+ Yangi vazifa** bilan vazifa qo'shing (vazifa maydonlari 3.5 bo'limda).
   Yoki **Mavjuddan tanlash** bilan modulsiz vazifani qo'shing.
6. **Nashr qilish** ni bosing. Modul nashr qilinganda **undagi qoralama vazifalar
   ham nashr qilinadi**.

<!-- SCREENSHOT: Modul muharriri — "Ko'rinish" tanlovi va "Nashr qilish" tugmasi -->

Bilish kerak:

- Vazifalar tartibi muhim: har rasmiy modulning **birinchi 3 tasi** bepul.
- Nashr qilingan, lekin ichida nashr qilingan vazifasi yo'q modulni o'quvchilar
  ko'rmaydi. Muharrir buni ogohlantirish bilan aytadi.
- Kontent ro'yxatida admin **barcha** modullarni ko'radi: har birida muallifi va
  "Rasmiy / Guruh / Shaxsiy" belgisi bor.
- Rasmiy modulni faqat admin yarata oladi. O'qituvchida bu tanlov yo'q.

### 2.3 O'qituvchi qo'shish

1. **O'qituvchilar** bo'limini oching.
2. **O'qituvchi qo'shish** ni bosing.
3. **Ism va familiya** hamda **Telefon raqami** ni kiriting, **Qo'shish** ni bosing.
4. O'qituvchiga ayting: u govorim.uz'ga **shu raqam bilan** kiradi, kod Telegram'ga
   keladi. Parol kerak emas.

Agar bu raqam allaqachon **o'quvchi**ga tegishli bo'lsa, oyna so'raydi:
"Bu raqam o'quvchi ... ga tegishli — o'qituvchiga aylantirilsinmi?". Tasdiqlasangiz,
o'quvchi o'qituvchiga aylanadi. Uning javoblari va tarixi o'chmaydi.

Agar raqam allaqachon o'qituvchi yoki admin hisobiga tegishli bo'lsa, qo'shib bo'lmaydi.

### 2.4 Rollarni o'zgartirish

Odamni ro'yxatdan tanlang va **Boshqarish** ni bosing. Rol tugmalari:

| Hozirgi rol | Tugma | Natija |
|---|---|---|
| O'quvchi | **O'qituvchiga aylantirish** | Keyingi safar ilovani ochganda o'qituvchi paneliga tushadi |
| O'qituvchi | **O'quvchiga aylantirish** | O'qituvchi paneli yopiladi, vazifalari o'chmaydi |
| O'qituvchi | **Admin qilish** | To'liq admin huquqlari. Faqat ishonchli odamga bering |
| Admin | **O'qituvchiga tushirish** | O'qituvchilar → **Adminlar** yorlig'ida |

Har bir o'zgarish oldidan oqibati yozilgan tasdiqlash oynasi chiqadi.

Tizim rad etishi mumkin bo'lgan holatlar:

- **"Bu oxirgi admin"** — platformada kamida bitta admin qolishi shart.
- **"O'z rolingizni o'zgartira olmaysiz"** — buni boshqa admin qiladi.
- **"Bu o'qituvchida N ta guruh bor"** — guruhi bor o'qituvchini o'quvchiga aylantirib
  bo'lmaydi. Avval guruhlar o'chirilishi kerak. Guruhni boshqa o'qituvchiga o'tkazish
  imkoniyati yo'q. Faqat kirishni to'xtatmoqchi bo'lsangiz, hisobni faolsizlantiring (2.5).

### 2.5 O'quvchilar va o'qituvchilar ro'yxati

Ikkala bo'limda: ism yoki telefon bo'yicha qidirish, eng yangilari tepada,
50 tadan ko'rsatiladi (**Yana ko'rsatish**).

**Boshqarish** oynasida:

- **Ismni saqlash** — ismni tuzatish.
- **Faol hisob** — o'chirsangiz, odam tizimga kira olmaydi. **Qaytarib bo'ladi**:
  qayta yoqsangiz, hamma narsasi joyida. Ro'yxatda "Faolsizlantirilgan" deb yoziladi.
- **Premium** (faqat o'quvchida) — cheksiz vazifalarni ochadi yoki yopadi.
  To'lov bilan bog'liq emas.
- **Hisobni o'chirish** (Xavfli zona) — **ortga qaytarib bo'lmaydi**.

Faolsizlantirish va o'chirish farqi:

| | Faolsizlantirish | O'chirish |
|---|---|---|
| Qaytarsa bo'ladimi | Ha | Yo'q |
| O'quvchining javoblari, baholari, XP'si | Saqlanadi | Butunlay o'chadi |
| O'qituvchining guruhlari, modullari, vazifalari | Saqlanadi | Butunlay o'chadi |

O'chirish uchun oynada odamning ismini **aynan yozishingiz** kerak — shundan keyingina
**Butunlay o'chirish** tugmasi ishlaydi. Shubha bo'lsa, faolsizlantiring.

### 2.6 Boshqaruv — raqamlar

- **Odamlar**: o'qituvchilar va o'quvchilar soni.
- **Kontent**: jami vazifalar va nashr etilganlari. Ostida nechta qoralama hech kimga
  ko'rinmayotgani yoziladi.
- **Faollik**: jami javoblar va baholanganlar ulushi (%). Ostida:
  "N ta javob hozir baholanmoqda" (navbatda) va
  "N ta javob baholashda xato bilan tugadi" (AI yoki texnik nosozlik).
  Xato bilan tugaganlar ko'paysa, AI sozlamalarini tekshiring (2.7).

### 2.7 Sozlamalar

Har bir bo'limning o'z saqlash tugmasi bor. Bir bo'limni saqlash boshqasiga ta'sir qilmaydi.

**AI baholash** va **Nutqni matnga o'girish**

- **Baholash zanjiri** / **Nutqni matnga o'girish zanjiri** — xizmatlar (backendlar)
  ro'yxati. Ular shu tartibda sinaladi: birinchi sozlangan va javob bergan xizmat ishlaydi.
  Tartibni o'q tugmalari bilan o'zgartirasiz.
- Har bir xizmat yonida "sozlangan" (kaliti bor) yoki "sozlanmagan" (kaliti yo'q,
  o'tkazib yuboriladi, xarajat yo'q) yoziladi.
- **Tanlangan va ishlayotgan — boshqa-boshqa narsa.** Bo'lim sarlavhasidagi
  **"Hozir ishlayapti: ..."** belgisi haqiqatda qaysi xizmat ishlayotganini ko'rsatadi.
  Masalan, zanjirda birinchi qo'ygan xizmatingizning kaliti bo'lmasa, keyingisi ishlaydi.
  Belgi "hech biri tayyor emas" desa, javoblar baholanmaydi.
- **Kalitlar hech qachon ko'rsatilmaydi** — faqat "o'rnatilgan · ..." yoki
  "o'rnatilmagan" yoziladi.
- Kalit maydonini **bo'sh qoldirsangiz — mavjud kalit o'zgarmaydi**. Yangi kalit
  kiritsangizgina almashadi.
- **Tekshirish** tugmasi kaliti bor har bir xizmatga bitta haqiqiy so'rov yuboradi.
  **Bu pul sarflaydi.**
- **Orfoepiya tekshiruvi** — baholashda urg'u va talaffuz qoidalarini ham tekshirish.
- Oxirida **AI sozlamalarini saqlash** ni bosing.

<!-- SCREENSHOT: Sozlamalar — "Hozir ishlayapti" belgisi va baholash zanjiri -->

**Funksiyalar** (har biri alohida yoqiladi)

| Kalit | Nimani yoqadi |
|---|---|
| **Xatolar ustida ishlash** | O'quvchi qiynalgan savollarini ma'lum kunlardan keyin qayta ishlaydi |
| **AI Suhbat** | Ssenariy bo'yicha AI bilan suhbat. Har bir gap AI'ga pul turadi |
| **Sinf insaytlari — "Mashq ber"** | O'qituvchi Analitikada xatoni qilgan o'quvchilarga bir tegishda mashq beradi |
| **Kunlik 5 daqiqa** | O'quvchining bosh sahifasida kunlik sessiya: isinish → 1 vazifa → 1 takror |
| **To'lovlar** | Premium sotib olish oqimi. Yoqilsa ham, to'lov tizimi ulanmaguncha hech kim sotib ololmaydi |
| **Tovushlar mashqi** | Minimal juftliklar mashqi (masalan, ikki o'xshash so'z) |

Chegaralar:

- **Tovushlar mashqi — kunlik urinishlar** — bir o'quvchiga kuniga nechta urinish.
- **Bitta suhbatdagi eng ko'p tur** va **Bir o'quvchiga kunlik tur** — AI Suhbat
  xarajatini cheklaydi. Kunlik hisob Toshkent vaqti bilan soat 05:00 da yangilanadi.

Oxirida **Funksiyalarni saqlash** ni bosing.

**Aloqa havolalari**

- **Telegram — qo'llab-quvvatlash** va **Telegram — kanal**.
- Format: `https://t.me/...`, `t.me/...` yoki `@nom`.
- **Havolalarni saqlash** ni bosing.

### 2.8 Tariflar

**Onlayn to'lov hali ulanmagan.** Sahifa buni ochiq yozadi ("Provayder: ulanmagan").

- **Tariflar** yorlig'i: **Yangi tarif** — Nomi, Kod, Narxi (so'm), Muddati (kun, 1–366),
  Izoh, Faol. Tariflarni oldindan tayyorlab qo'yish mumkin, lekin o'quvchilar ularni
  hali sotib ololmaydi.
- Tarifni o'chirib bo'lmasa (u bo'yicha obuna bo'lgan), uni **Nofaol** qiling.
- **Obunalar** yorlig'i: kimda obuna borligi. Hozircha bo'sh bo'ladi.
- Premium berish shu yerda emas: **O'quvchilar → Boshqarish → Premium**.

### 2.9 Profil va chiqish

Yuqoridagi avatarni bosing. U yerda: ism, telefon raqamni almashtirish
(yangi raqamga Telegram kodi keladi), til, ko'rinish (yorug'/qorong'i),
bildirishnomalar va **Chiqish**.

---

## 3. O'qituvchi uchun

Menyu: **Bosh · Klasslar · Navbat · Kontent · Analitika**. O'rtadagi katta tugma —
**Navbat**; unda tekshirilmagan javoblar soni ko'rinadi. Profilingiz yuqoridagi
avatar orqali ochiladi.

Admin sizni qo'shgandan so'ng, o'z telefon raqamingiz bilan kiring (1.2 bo'lim).

### 3.1 Bosh

Yuqorida uchta raqam: **Guruh**, **O'quvchi**, **Navbatda**.

**E'tibor talab qiladi** bo'limidagi kartalar:

| Karta | Ma'nosi | Bosilganda |
|---|---|---|
| "N ta javob tekshiruvingizni kutmoqda" | AI baholagan, siz hali ko'rmagan javoblar | Navbat |
| "N ta guruhga qo'shilish so'rovi" | O'quvchilar guruhga kirmoqchi | Klasslar → So'rovlar |
| "N o'quvchi X punkt tushdi" | Bahosi kamida 5 punkt pasaygan o'quvchilar | O'quvchi profili yoki ro'yxat |
| "Shu hafta sinf xatosi: ..." | Sinfda eng ko'p uchragan xato turi | Analitika |

Hech biri bo'lmasa: "Hozircha e'tibor talab qiladigan ish yo'q".

<!-- SCREENSHOT: O'qituvchi "Bosh" sahifasi — e'tibor kartalari -->

### 3.2 Klasslar

Uchta yorliq: **Guruhlar · So'rovlar · O'quvchilar**.

**Guruh ochish**

1. **+ Yangi guruh** ni bosing.
2. **Guruh nomi** ni yozing (masalan: Kechki-3), **Yaratish** ni bosing.
3. Guruh kodi avtomatik yaratiladi. U guruh kartasida "Kod: ..." deb ko'rinadi.

**O'quvchilarni taklif qilish**

1. Guruhni oching (**Ochish**) va **A'zo qo'shish** ni bosing.
2. **Taklif havolasi** yoki **Qo'shilish kodi** ni **Nusxa** qiling va o'quvchilarga yuboring.
3. O'quvchi havolani ochadi yoki kodni kiritadi — so'rovi sizga keladi.
   O'quvchini telefon raqami bilan o'zingiz qo'sha olmaysiz — faqat havola yoki kod orqali.

**So'rovlarni tasdiqlash**

- **So'rovlar** yorlig'ida **Tasdiqlash** / **Rad** ni bosing. Yoki taklif sahifasidagi
  **Kutayotganlar** ro'yxatida **Guruhga qo'shish** / **Rad etish** ni bosing.
- Tasdiqlanmaguncha o'quvchi guruh a'zosi emas. Uning ekranida "So'rov yuborildi" turadi.

**Guruh sozlamalari** (guruh sahifasidagi **Sozlama**)

- **Nomni saqlash** — guruh nomini o'zgartirish.
- **Qo'shilish kodini yangilash** — kod begona joyga tarqalgan bo'lsa. Eski kod va
  havola darhol ishlamay qoladi. A'zolar va kutayotgan so'rovlar saqlanadi.
- **Chiqarish** — o'quvchini guruhdan chiqarish. Uning javoblari va baholari saqlanadi.
- **Guruhni o'chirish** (Xavfli zona) — a'zoliklar va guruhning ochiq topshiriqlari
  o'chadi, o'quvchilarning javoblari va baholari qoladi. Ortga qaytarib bo'lmaydi.
  Tasdiqlash uchun guruh nomini yozasiz.

Guruh darajasini (A1, B1...) belgilash imkoniyati yo'q.

**O'quvchilar** yorlig'i barcha guruhlaringizdagi o'quvchilarni ko'rsatadi. Har birining
yonidagi o'q bahosi ko'tarilayotganini (↑), tushayotganini (↓) yoki o'zgarmayotganini (→)
bildiradi. Baholangan javobi 4 tadan kam bo'lsa, o'q chiqmaydi.

### 3.3 Topshiriq berish

Topshiriq berish mumkin bo'lgan joylar: guruh kartasidagi **Topshiriq berish**,
guruh sahifasidagi **+ Topshiriq berish**, o'quvchi profilidagi **Topshiriq berish**.

1. **Vazifa** — vazifa yoki butun modulni tanlang. Faqat **nashr qilingan** kontent
   ko'rinadi. Ichida nashr qilingan vazifasi yo'q modul kulrang bo'ladi.
2. **Kimga** — guruh (o'quvchi profilidan kirsangiz — o'sha bitta o'quvchi).
3. **Muddat** — ixtiyoriy. Bo'sh qoldirsangiz, muddatsiz.
4. **Urinish** — **Cheksiz**, 1, 2, 3 yoki 5 ta. Har bir vazifa uchun alohida hisoblanadi.
   Baholanmay qolgan (texnik xato bilan tugagan) urinish hisobga olinmaydi.
5. **"N o'quvchiga topshirish"** tugmasini bosing.

Natija aniq yoziladi, masalan: "4 ta o'quvchiga berildi, 2 tasida allaqachon bor edi".
Vazifa o'quvchida ochiq bo'lsa, ikkinchi marta berilmaydi.

Muhim:

- Faqat **o'zingiz yaratgan** vazifa va modullarni bera olasiz. Rasmiy katalog
  vazifalari bu ro'yxatda yo'q.
- Topshiriq qilib beradigan vazifangiz **nashr qilingan modul ichida** bo'lsin.
  Modulsiz yoki qoralama moduldagi vazifani berish mumkin, lekin o'quvchi uni
  ochganda "Bu vazifa mavjud emas" ko'radi.

**Berilgan topshiriqni o'zgartirish** — guruh sahifasi → **Faol topshiriqlar** →
qatordagi menyu:

- **Muddatni o'zgartirish** — yangi sana yoki **Muddatsiz**. O'tgan vaqtni tanlab bo'lmaydi.
- **Topshiriqni bekor qilish** — o'quvchilar uni endi ko'rmaydi. Berilgan javoblar
  va baholar saqlanadi. Vazifa o'quvchiga alohida (profil orqali) berilgan bo'lsa,
  guruh sahifasidan bekor qilib bo'lmaydi.

### 3.4 Navbat — javoblarni tekshirish

Navbatda AI baholagan, lekin siz hali ko'rmagan har bir javob turadi — faqat
guruhlaringizdagi o'quvchilarniki. **Hech narsa avtomatik tasdiqlanmaydi.**
Baholashda xato bilan tugagan javoblar navbatga tushmaydi.

Filtrlar: **Hammasi** va **Past ball** (60 va undan past).

Tez tekshirish (ro'yxatning o'zida):

- **Audio** — javobni tinglash.
- **Tasdiqlash** — AI bahosiga rozisiz. Javob navbatdan chiqadi.
- **Tahrir** — batafsil sahifani ochadi.

Batafsil sahifada:

1. Audioni tinglang.
2. **Transkript** ni o'qing — AI eshitgan so'zlar. So'zlar talaffuz aniqligiga qarab
   rangli va tagi chizilgan: yaxshi / o'rtacha / past.
3. **AI baholari** ni ko'ring (Ravonlik, Grammatika, Talaffuz, Lug'at).
   Ularni alohida o'zgartirib bo'lmaydi.
4. **AI aniqlagan xato** va **AI izohi** ni o'qing.
5. Qaror qiling:
   - **Tasdiqlash** — AI bahosi qoladi.
   - **Qo'lda baholash** — **Umumiy ball** ni suring va/yoki **Izoh (o'quvchiga)**
     yozing, **Saqlash** ni bosing.

Sizning bahoingiz AI bahosi o'rniga hamma joyda ishlatiladi (jurnal, analitika,
o'quvchining natijasi). O'quvchi natijasida "O'qituvchi izohi" va "O'qituvchi bahosi"
ni ko'radi.

Audio 3 oydan keyin o'chiriladi. Transkript va baholar qoladi.

<!-- SCREENSHOT: Navbat — javob detali, transkript va "Qo'lda baholash" oynasi -->

### 3.5 Kontent — modullar va vazifalar

Ikki yorliq: **Modullar** va **Vazifalar**. Siz faqat o'z kontentingizni ko'rasiz.
Sizning modullaringizni faqat guruhlaringizdagi o'quvchilar ko'radi, va ular
Premiumsiz ham to'liq ochiq.

**Holatlar**

- **Qoralama** — hech kim ko'rmaydi. Yangi modul va modulsiz yangi vazifa qoralama
  bo'lib boshlanadi.
- **Faol** — nashr qilingan. O'quvchi vazifani faqat vazifa ham, modul ham faol
  bo'lganda ko'radi.

**Modul yaratish**

1. **Modullar** → **+ Yaratish**. "Yangi modul" ochiladi.
2. **Modul nomi**, **Tavsif**, **Daraja** → **Saqlash**.
3. **+ Yangi vazifa** yoki **Mavjuddan tanlash** (modulga biriktirilmagan vazifalar).
4. **Nashr qilish** — modul va undagi qoralama vazifalar nashr qilinadi.
5. Yashirish uchun: **Qoralamaga qaytarish**.

Modul ichidagi har bir vazifa qatorida Faol/Qoralama tugmasi bor.
**Olib tashlash** vazifani moduldan chiqaradi, lekin o'chirmaydi — u kutubxonaga qaytadi.

**Vazifa muharriri** (vazifani bosganda ochiladi)

| Maydon | Izoh |
|---|---|
| Sarlavha | Ro'yxatda ko'rinadigan nom |
| Shart (ruscha) | O'quvchiga beriladigan savol yoki topshiriq |
| Ko'rsatma (ixtiyoriy) | Qisqa yo'l-yo'riq, masalan "3–4 gap bilan javob bering" |
| Namuna javob (ixtiyoriy) | O'quvchi javob bergandan keyin ko'radi |
| Daraja | A1–C1 yoki "Yo'q" |
| Mavzu (ixtiyoriy) | Masalan: Do'kon |
| Tayyorlanish vaqti | Yo'q, 10 s, 30 s, 1 daq |
| Javob vaqti | 30 s, 45 s, 1 daq, 2 daq, 3 daq |
| Modul | Qaysi modulga tegishli yoki "Modulsiz" |
| Media | Rasm (JPEG/PNG/WebP) yoki video (MP4/WebM), 25 MB gacha |

- Vazifaga javoblar bo'lsa, muharrir ogohlantiradi: o'zgarish keyingi javoblarga
  ta'sir qiladi, oldingi baholar o'zgarmaydi.
- **Vazifani o'chirish** — vazifa ro'yxatlardan va o'quvchilarning modullaridan
  yo'qoladi. **O'quvchilarning javoblari va baholari saqlanadi.**
- **Modulni o'chirish** — undagi vazifalar ham o'chadi (javoblar va baholar saqlanadi).
  Ba'zan tizim modulni o'chirishni rad etadi. Unda uni qoralamaga qaytaring —
  o'quvchilar ko'rmay qoladi.

<!-- SCREENSHOT: Vazifa muharriri — maydonlar va "Media" tugmasi -->

### 3.6 Analitika

Yuqorida **Guruh** filtri (Barcha guruhlar yoki bittasi). Ikki yorliq:

**Insaytlar**

- **Sinf o'rtacha darajasi** va o'tgan oyga nisbatan o'zgarish.
- **Faol o'quvchi**, **Topshiriq bajarilishi**, **Haftalik mashq**, **Bu hafta baholandi**.
  "Hafta" — oxirgi 7 kun.
- **Ko'nikma taqsimoti** va **Haftalik faollik**.
- **Ko'p uchragan xatolar** — xato turi, nechta o'quvchi qilgani.

**"Mashq ber"** (admin yoqqan bo'lsa): xato qatoridagi tugma shu xatoni qilgan
o'quvchilarga mos vazifani biriktiradi.

1. **Mashq ber** ni bosing.
2. Oynada qaysi vazifa va nechta o'quvchiga berilishini ko'ring.
3. **Biriktirish** ni bosing. Bu amalni bekor qilib bo'lmaydi.

Tugma o'rnida sabab yozilishi mumkin: mos mashq topilmadi, xato juda kam
uchragan yoki mashq hammada allaqachon ochiq.

**Jurnal**

- Har bir o'quvchi: Ravonlik, Grammatika, Ball, Urinishlar soni.
- **CSV eksport** — jadvalni Excel'da ochiladigan faylga yuklab oladi.
  Fayl ekrandagi filtrga mos bo'ladi.

### 3.7 O'quvchi profili va Premium berish

O'quvchini ro'yxatdan bosing. Profilda: ko'nikmalar, so'nggi urinishlar,
baho yo'nalishi (masalan "↓ 8 punkt tushdi"), **Topshiriq berish** tugmasi.

**Premium berish**: profildagi **Premium** kalitini yoqing. Bu o'quvchida barcha
rasmiy modullarni ochadi. Muddati yo'q — o'chirmaguningizcha amal qiladi.
Faqat o'z guruhingizdagi o'quvchilarga bera olasiz.

### 3.8 Profil va bildirishnomalar

- **Profil** (yuqoridagi avatar): **Ma'lumot** (ism, telefon, **Guruhlarim**) va
  **Sozlamalar** (til, ko'rinish, bildirishnomalar, yordam, **Chiqish**).
- **Qo'ng'iroqcha** belgisi — ilova ichidagi xabarlar: yangi qo'shilish so'rovi va boshqalar.
  Xabarlarni tanlab o'chirish yoki **Barchasini tozalash** mumkin.
- **Bildirishnomalar** kalitini o'chirsangiz, sizga yangi xabarlar yozilmaydi.

---

## 4. O'quvchi uchun

Menyu: **Bosh · Mashq · AI Suhbat · Progress · Profil**. O'rtadagi katta mikrofon
tugmasi — **AI Suhbat**.

### 4.1 Ro'yxatdan o'tish

1. govorim.uz → **Ro'yxatdan o'tish**.
2. **Hisob**: ism va familiya, telefon raqam → **Davom etish**.
3. **Aloqa**: Telegram orqali kelgan kodni kiriting (1.2 bo'limdagi kabi) → **Tasdiqlash**.
4. **Manzil**: viloyat va tuman (majburiy), ko'cha va uy (ixtiyoriy) →
   **Tugatish va boshlash**.

Kirish sahifasida yangi raqam kiritsangiz ham ro'yxatdan o'tasiz: tizim ismingizni
so'raydi va yangi kod yuboradi.

**Ro'yxatdan o'tmasdan sinab ko'rish**: kirish sahifasidagi
"Tizimni sinab ko'rish · darajangizni bepul aniqlang" havolasi.

### 4.2 Dastlabki sinov (daraja aniqlash)

Ro'yxatdan o'tgach bir marta taklif qilinadi.

1. **Sinovni boshlash →** ni bosing.
2. 3 ta savolga ovoz bilan javob bering (har biriga 90 soniyagacha).
3. Natijada taxminiy darajangiz (masalan, A2) chiqadi. **Boshlash** ni bosing.

**Keyinroq — hozircha kirish** bilan o'tkazib yuborish mumkin.
Bu daraja faqat bir martalik taxmin. Profil va bosh sahifadagi daraja keyin
baholangan javoblaringiz o'rtachasidan hisoblanadi.

### 4.3 Guruhga qo'shilish

Ikki yo'l bor:

- **Taklif havolasi**: o'qituvchi yuborgan havolani oching. Tizimga kirmagan bo'lsangiz,
  avval kirasiz — so'rov o'zi yuboriladi.
- **Guruh kodi**: Bosh sahifadagi "Siz hali guruhda emassiz" kartasida kodni yozing
  va **Qo'shilish** ni bosing.

Shundan keyin "So'rov yuborildi · O'qituvchi tasdiqlashini kuting" chiqadi.
O'qituvchi tasdiqlagach, bosh sahifada **O'QITUVCHINGIZ** bloki paydo bo'ladi.
Guruh qatorini bossangiz, guruhdoshlar va guruh reytingi ochiladi.

Guruhdan chiqish: **Profil → Ma'lumot → Guruhdan chiqish**. Qayta qo'shilish uchun
yana kod kerak bo'ladi.

### 4.4 Bosh sahifa

- **Bugungi 5 daqiqa** kartasi (admin yoqqan bo'lsa) va **Boshlash** tugmasi (4.9).
  Bu funksiya o'chiq bo'lsa, **Boshlash** Mashq bo'limini ochadi.
- **O'QITUVCHINGIZ**: o'qituvchi, guruh va keyingi topshiriq (muddati bilan).
- **QISQACHA**: Daraja, Bu hafta (daqiqa), Streak (kunlar).

<!-- SCREENSHOT: O'quvchi bosh sahifasi -->

### 4.5 Mashq — modullar va topshiriqlar

**Mashq** bo'limida ikki yorliq: **Modullar** va **Topshiriqlar**.

**Modullar**: filtrlar — Hammasi, Davom etayotgan, Yakunlangan.
O'qituvchingiz yaratgan modullarda **O'QITUVCHI** belgisi bor.

Modulni oching — vazifalar ro'yxati chiqadi. Har bir vazifa holati:

| Belgi | Ma'nosi |
|---|---|
| Belgi (✓) va ball | Bajarilgan |
| **Boshlash** | Hozir bajarish mumkin bo'lgan vazifa |
| **Yopiq** | Oldingi vazifani bajarmaguningizcha ochilmaydi |
| **Pro** | Premium kerak (rasmiy modulning 4-vazifasidan boshlab) |

Vazifalar tartib bilan ochiladi: bittasini bajarsangiz, keyingisi ochiladi.
Modul to'liq bajarilganda "Modul yakunlandi!" sahifasi chiqadi: vazifalar soni,
o'rtacha ball, sarflangan vaqt va keyingi modul. Sertifikat berilmaydi.

**Topshiriqlar**: o'qituvchi bergan vazifalar — muddati, urinishlar soni
(masalan "1/3 urinish"), bajarilganda "Bajarildi" va ball.
Muddati o'tgan topshiriq qizil rangda "muddati o'tgan" deb belgilanadi.
Urinishlar tugasa, tugma o'rnida "Urinish qolmadi" yoziladi.

### 4.6 Vazifaga javob berish

1. Vazifani oching. **Shart** ni o'qing. Rasm yoki video bo'lsa, ko'ring.
   Yuqorida tayyorlanish va javob vaqti yozilgan.
2. **Yozishni boshlash** ni bosing. Birinchi marta brauzer mikrofonga ruxsat so'raydi —
   **Ruxsat berish** ni bosing.
3. Tayyorlanish vaqti bo'lsa, "Fikringni yig'ib ol" chiqadi va vaqt sanaladi.
   Tayyor bo'lsangiz, **Tayyorman** ni bosing. Vaqt tugasa, yozish o'zi boshlanadi.
4. Gapiring. Tugatgach **To'xtatish** ni bosing. Javob vaqti tugasa, yozish o'zi to'xtaydi.
5. **Eshitish** — yozuvni tinglang. Yoqmasa — **Qayta yozish**.
6. **Tayyor** ni bosing — javob yuboriladi.
7. "Javobingni baholayapman…" — odatda 10–20 soniya kuting.

<!-- SCREENSHOT: Vazifa ekrani — "Yozishni boshlash" tugmasi -->

**Natija ekrani**: umumiy ball va daraja, **Yaxshi bo'ldi**, **Sening javobing**
(tizim eshitgan matn), **Tuzatamiz** (xatolar va to'g'ri varianti),
**Mezonlar** (Ravonlik, Lug'at boyligi, Grammatika, Talaffuz).

- **Batafsil** — to'liq natija sahifasi.
- **Qayta urinish** — shu vazifaga yana javob berish.
- **Keyingi vazifa →** — keyingi ochiq vazifa.
- **O'tkazib yuborish →** — javob bermasdan keyingisiga o'tish.

Tizim "Sening javobing"da siz **aytgan** so'zlarni yozadi, xatolaringizni tuzatmaydi.
Bu ataylab shunday: xatoni ko'rishingiz uchun.

Premium vazifani ochsangiz, yozishdan **oldin** "Bu vazifa Premium bilan ochiladi"
chiqadi — javobingiz bekorga ketmaydi.

<!-- SCREENSHOT: Natija ekrani — ball, tuzatishlar va mezonlar -->

### 4.7 Natijalar

**Profil → Natijalar → Barcha natijalar**. Har bir javob ochilganda:

- **Yozib olingan javob** (audio). 3 oydan keyin audio o'chiriladi, qolgani saqlanadi.
- **Siz aytgan** — transkript.
- **Baho tafsiloti**, **AI izohi**, **Tuzatishlar**, **Namuna javob**.
- O'qituvchi tekshirgan bo'lsa: **O'qituvchi izohi** va **O'qituvchi bahosi**.

### 4.8 Xatolar ustida (takrorlash)

Admin yoqqan bo'lsa ishlaydi. Qiynalgan savollaringiz (biror mezon bo'yicha
past ball) shu yerga to'planadi va ma'lum kunlardan keyin (1, 3, 7, 16, 35 kun) qaytadi.

Qaytadigan savol bo'lsa, **Mashq** bo'limi tepasida **XATOLARING** kartasi chiqadi.

1. **Boshlash** ni bosing.
2. Savolga javobni qaytadan ayting va yozib oling, o'zingizni eshiting.
3. **Namunani ko'rsat** ni bosing va solishtiring.
4. O'zingizga baho bering: **Yaxshi aytdim** yoki **Yana takrorlayman**.

Bu yerdagi yozuvlar AI'ga yuborilmaydi va baholanmaydi — bu o'z-o'zini tekshirish.

### 4.9 Bugungi 5 daqiqa

Admin yoqqan bo'lsa, bosh sahifada chiqadi. Uch bosqich:

1. **Isinish** — uchta iborani ovoz chiqarib o'qing (yoki **Tinglash** ni bosib takrorlang).
   Hech narsa yozib olinmaydi. **O'qib bo'ldim** ni bosing.
2. **Gapirish** — bitta vazifa. **Gapirishga o'tish** ni bosing, javob bering,
   so'ng **Bugungi mashg'ulotga qaytish** ni bosing.
3. **Tuzatish** — "Xatolar ustida"dan bitta savol. Qaytadigan savol bo'lmasa,
   bu bosqich chiqmaydi.

Oxirida "Bugungi 5 daqiqa bajarildi" yoziladi.

### 4.10 Tovushlar mashqi

Rus tilida bitta tovush so'z ma'nosini o'zgartiradi. Bu mashqda o'xshash so'zlar
juftligini aytasiz, tizim qaysi so'z eshitilganini aytadi.

- Admin yoqqan va nutqni tanish xizmati ulangan bo'lishi kerak.
- Kuniga urinishlar soni cheklangan; ertasi kuni yangilanadi.
- Hozircha ilova menyusida bu mashqqa tugma yo'q. U **govorim.uz/drill** manzili
  orqali ochiladi.

### 4.11 AI Suhbat

Pastdagi o'rta tugma. Tayyor ssenariylar: **В аптеке**, **Собеседование**,
**У врача**, **В такси**, hamda **Erkin mavzu**. Boshqa ssenariy yo'q.

1. Ssenariyni tanlang. Yuqorida maqsad yoziladi (masalan: "Dori dozasini bilib ol").
2. AI matn bilan yozadi (ovozsiz).
3. **Javob berish** ni bosing, gapiring, **Yuborish** ni bosing. O'z ovozli
   xabaringizni **Eshitish** tugmasi bilan qayta tinglashingiz mumkin.
4. Suhbat o'zi tugaydi yoki **Tugatish** ni bosasiz.
5. Yakunda: maqsadga yetdingizmi, foydali iboralar va tuzatishlar.

Cheklovlar: bitta suhbatda va bir kunda gap soni cheklangan ("N navbat qoldi").
Kunlik limit tugasa, ertasi kuni ochiladi. AI Suhbat o'chirilgan yoki AI ulanmagan
bo'lsa, ekranda shu yoziladi.

### 4.12 Progress

Uch yorliq:

- **Ko'nikmalar** — hozirgi daraja, o'zgarish, Ravonlik/Talaffuz/Lug'at/Grammatika.
- **Yutuqlar** — ochilgan nishonlar (birinchi mashq, 7 kunlik seriya, 1000 XP va h.k.).
- **Reyting** — butun ilova bo'yicha XP reytingi: Haftalik, Oylik, Barcha vaqt.

**XP**: har bir baholangan javob uchun 25 XP gacha — ball qancha yuqori bo'lsa, XP shuncha ko'p.
Juda past baholangan javobga XP berilmaydi.

**Seriya (streak)** qoidalari:

- Baholangan javob yuborgan har bir kun seriyaga qo'shiladi.
- Bir kun o'tkazib yuborsangiz, seriya 1 dan qayta boshlanadi — agar
  **muzlatish** bo'lmasa.
- Har 5-kun ketma-ket mashq qilganingizda 1 ta **muzlatish** olasiz.
- O'tkazib yuborilgan har bir kun uchun bitta muzlatish avtomatik sarflanadi va
  seriya saqlanadi.
- Kun Toshkent vaqti bilan ertalab soat 05:00 da almashadi.

### 4.13 Profil

Uch yorliq: **Ma'lumot**, **Natijalar**, **Sozlamalar**.

- **Rasm**: JPG, PNG yoki WebP, 5 MB gacha.
- **Tahrirlash**: ism va manzil.
- **Telefon raqamni o'zgartirish**: **O'zgartirish** → yangi raqam → **Kod yuborish** →
  kod yangi raqamning Telegram'iga keladi → tasdiqlang. Raqam boshqa hisobda
  bo'lsa, o'zgartirib bo'lmaydi.
- **Interfeys tili**: O'zbek, Rus, Ingliz. Tanlov boshqa qurilmada ham saqlanadi.
- **Mavzu**: Yorug' yoki Qorong'i.
- **Bildirishnomalar**: o'chirsangiz, ilova ichidagi yangi xabarlar (yangi topshiriq,
  o'qituvchi tekshirdi, so'rov tasdiqlandi va h.k.) kelmaydi.
  Telefonga yoki Telegram'ga eslatma yuborilmaydi — xabarlar faqat ilova ichidagi
  qo'ng'iroqchada.
- **Yordam markazi**: Telegram guruh va Telegram admin havolalari.
- **Maxfiylik siyosati**.
- **Chiqish**.

Hisobni butunlay o'chirish uchun Telegram orqali adminga yozing.

### 4.14 Premium

**Profil → Premium haqida** yoki qulflangan vazifadagi **Premium haqida**.

- **Bepul reja**: har bir rasmiy modulning dastlabki 3 ta vazifasi.
- **Premium**: barcha modullardagi barcha vazifalar.
- **To'lov tizimi hali ulanmagan** — ilova orqali sotib bo'lmaydi.
  Premiumni o'qituvchingiz yoki admin beradi.
- O'qituvchi bergan Premium: "Premium — o'qituvchingiz bergan". Tugash sanasi yo'q.

---

## 5. Tez-tez so'raladigan savollar

**Kod Telegram'ga kelmayapti.**

1. **Telegram'da oching** tugmasini bosganingizni va botda **START** ni bosganingizni tekshiring.
2. Bot raqam so'rasa, **o'z** kontaktingizni yuboring.
3. Saytga kiritgan raqamingiz Telegram hisobingizdagi raqam bilan bir xil bo'lishi kerak.
   Farq qilsa, "Raqam mos kelmadi" chiqadi — boshidan boshlang.
4. "Kodning amal qilish muddati tugadi" chiqsa — **Kodni qayta yuborish**.
5. Hech kimga kod kelmayotgan bo'lsa (hamma uchun), bu serverdagi Telegram bot
   bilan bog'liq muammo. Admin texnik mutaxassisga murojaat qiladi.

**"Hisob bloklangan yoki faol emas".**
Admin hisobingizni faolsizlantirgan. Adminga yoki o'qituvchingizga murojaat qiling.

**Javob uzoq vaqt "Baholanmoqda…" turibdi.**
Bir daqiqadan keyin ekranda "Hali baholanmoqda" chiqadi. Javobingiz saqlangan —
natija keyinroq **Profil → Natijalar** da chiqadi. Qayta yuborish shart emas.

**"Baholanmadi" / "Javobni baholab bo'lmadi".**
Sababi yoziladi:

| Sabab | Nima qilish kerak |
|---|---|
| Baholash juda uzoq cho'zildi | **Qayta urinish** |
| Ovozni matnga aylantirib bo'lmadi | Balandroq, mikrofonga yaqinroq gapiring, qayta yozing |
| AI javobni baholay olmadi | **Qayta urinish**. Takrorlansa, adminga ayting |
| Texnik xatolik yuz berdi | **Qayta urinish**. Takrorlansa, adminga ayting |

Baholanmagan urinish topshiriqdagi urinishlar soniga kirmaydi.
Admin uchun: bunday javoblar ko'paysa, **Sozlamalar**dagi "Hozir ishlayapti" belgisini tekshiring.

**"Juda ko'p javob yuborildi".** Bir oz kuting va qayta yuboring.

**"Mikrofonga ruxsat berilmadi".**
Brauzer manzil satridagi qulf belgisini bosing → Mikrofon → Ruxsat berish.
Sahifani yangilang. Telefonda brauzer sozlamalarida ham mikrofonga ruxsat bo'lishi kerak.

**Vazifa qulflangan.**

- **Yopiq** — oldingi vazifani bajaring.
- **Pro** — Premium kerak. O'qituvchingizdan so'rang.
- "Bu vazifaga javob berib bo'lmaydi" — vazifa yopilgan, muddati o'tgan yoki
  urinishlar tugagan. O'qituvchingizga yozing.
- "Bu vazifa mavjud emas" — vazifa o'chirilgan yoki sizga ochiq emas.

**Guruh kodini unutdim.**
O'qituvchingizdan so'rang. O'qituvchi kodni **Klasslar** dagi guruh kartasida
("Kod: ...") yoki guruh → **A'zo qo'shish** sahifasida ko'radi. Kod tarqalib
ketgan bo'lsa, **Sozlama → Qo'shilish kodini yangilash** bilan yangisini oladi.

**"Kod noto'g'ri yoki guruh topilmadi".**
Kodni qayta tekshiring. O'qituvchi kodni yangilagan bo'lsa, eski kod ishlamaydi.

**Mashq bo'limida hech narsa yo'q.**
Hali nashr qilingan modul yo'q. Admin rasmiy modul yaratib, nashr qilishi kerak (2.2).

**Seriyam uzilib qoldi.**
Kun ertalab soat 05:00 da almashadi. Muzlatish bo'lmasa, o'tkazilgan kun seriyani uzadi.
