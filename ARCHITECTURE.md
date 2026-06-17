# RusSpeak — Rus tili speaking platformasi (Arxitektura)

> IELTS Speaking uslubidagi, lekin faqat rus tiliga moslangan speaking mashq platformasi.
> O'qituvchi savol kiritadi → o'quvchi gapirib javob beradi (ovoz yoziladi) → AI tahlil qiladi va baho/feedback beradi.

---

## 1. Mahsulot ko'lami (MVP)

**Rollar:**
- **Teacher (o'qituvchi)** — hozircha bitta. Savollar yaratadi, o'quvchilar javobini va AI bahosini ko'radi.
- **Student (o'quvchi)** — savollarni ko'radi, gapirib javob beradi, AI feedback oladi.

**Savol turlari (3 toifa):**
| Tur | Tarkib | O'quvchi nima qiladi |
|-----|--------|----------------------|
| `text` | Matnli savol/topshiriq | Matnni o'qib, gapirib javob beradi |
| `image` | Rasm + topshiriq | Rasmni tasvirlab/izohlab gapiradi |
| `video` | Video + topshiriq | Videoni ko'rib, izohlab gapiradi |

Har uchala turda ham **yakuniy natija — ovozli javob** (audio recording).

**Asosiy oqim:**
```
O'quvchi savolni ochadi → ovoz yozadi (MediaRecorder) → upload →
backend audioni saqlaydi → fon vazifa (Celery) →
  Whisper (STT, ruscha matn + so'z vaqtlari) →
  LLM (Claude) ruscha matnni tahlil qiladi (grammatika, leksika, izchillik) →
  (ixtiyoriy) akustik tahlil (sur'at, pauza, talaffuz) →
baho + feedback saqlanadi → o'quvchi natijani ko'radi
```

---

## 2. Texnologik stek

### Frontend
- **React 18 + TypeScript + Vite**
- **Tailwind CSS + shadcn/ui** — mobile-first responsive (telefon + desktop)
- **TanStack Query** — server state / fetching / cache
- **Zustand** — yengil client state (recorder holati va h.k.)
- **React Router** — routing
- **React Hook Form + Zod** — formalar va validatsiya
- **MediaRecorder API + Web Audio API** — brauzerda ovoz yozish, waveform vizualizatsiya

### Backend
- **Python 3.12 + FastAPI** — async, AI integratsiyasi uchun ideal, avtomatik OpenAPI docs
- **SQLAlchemy 2.0 + Alembic** — ORM va migratsiyalar
- **Pydantic v2** — validatsiya / schema
- **Celery + Redis** — uzoq davom etadigan AI vazifalari uchun navbat (STT + LLM sekin ishlaydi, HTTP so'rovini bloklamaslik kerak)
- **JWT (access + refresh) + bcrypt** — autentifikatsiya

### Ma'lumotlar
- **PostgreSQL 16** — asosiy DB
- **Redis** — Celery broker + cache + status
- **S3-mos object storage** — audio/video/rasm fayllari (Cloudflare R2 / AWS S3 / self-hosted MinIO)

### AI qatlami
- **STT:** Whisper (`large-v3`) — ruscha transkripsiya + so'z darajasidagi timestamp'lar.
  Variant A: OpenAI Whisper API (tez start). Variant B: self-hosted `faster-whisper` (arzon, maxfiy).
- **Matn tahlili:** **Claude** (`claude-opus-4-8` yoki `claude-sonnet-4-6`) — structured output (JSON) bilan rubrik bo'yicha baho + xato tuzatishlari.
- **Akustik tahlil (Faza 2):** so'z timestamp'laridan beглость (sur'at = so'z/min, pauzalar, filler so'zlar). Talaffuz uchun forced-alignment + GOP (Goodness of Pronunciation).

---

## 3. Baholash rubrikasi (IELTS asosida, rus tiliga moslangan)

Har bir javob 4 mezon bo'yicha **0–9 band**:

| Mezon | Ruscha nomi | Nimani o'lchaydi |
|-------|-------------|------------------|
| Fluency & Coherence | Беглость и связность | Sur'at, pauzalar, fikrlar bog'liqligi |
| Lexical Resource | Лексический запас | Lug'at boyligi, so'z tanlash to'g'riligi |
| Grammatical Range | Грамматика | Grammatik tuzilmalar xilma-xilligi va aniqligi |
| Pronunciation | Произношение | Talaffuz (Faza 2 — akustik) |

→ **Overall band** = 4 mezon o'rtachasi (0.5 ga yaxlitlanadi, IELTS kabi).

**LLM qaytaradigan tuzilma:**
```json
{
  "scores": { "fluency": 6.5, "lexical": 6.0, "grammar": 5.5, "pronunciation": 6.0, "overall": 6.0 },
  "summary": "Umumiy izoh (ruscha + o'zbekcha)",
  "strengths": ["..."],
  "improvements": ["..."],
  "corrections": [
    { "original": "я идти в магазин", "corrected": "я иду в магазин", "type": "grammar", "explanation": "..." }
  ],
  "vocabulary_suggestions": ["..."]
}
```

---

## 4. Ma'lumotlar modeli (PostgreSQL)

```
users
  id (uuid, pk), email (uniq), password_hash, full_name,
  role (enum: teacher|student), is_active, created_at

questions
  id (uuid, pk), teacher_id (fk users),
  type (enum: text|image|video),
  title, prompt_text,
  media_url (image/video uchun, S3 key),
  level (enum: A1..C2, nullable),
  prep_time_sec (tayyorgarlik vaqti),
  answer_time_limit_sec (max javob vaqti),
  is_published (bool), created_at

submissions
  id (uuid, pk), student_id (fk users), question_id (fk questions),
  audio_url (S3 key), audio_duration_sec,
  status (enum: pending|processing|done|failed),
  error_message (nullable), created_at, completed_at

transcripts
  id (pk), submission_id (fk, uniq), text,
  language, word_timestamps (jsonb), stt_model, created_at

evaluations
  id (pk), submission_id (fk, uniq),
  fluency_score, lexical_score, grammar_score, pronunciation_score, overall_band,
  feedback (jsonb),           -- summary, strengths, improvements
  corrections (jsonb),        -- xato tuzatishlari
  llm_model, created_at
```

Indekslar: `submissions(student_id, created_at)`, `submissions(question_id)`, `submissions(status)`, `questions(type, is_published)`.

---

## 5. API yo'nalishlari (REST, `/api/v1`)

**Auth:** `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `GET /auth/me`

**Questions (teacher):**
- `POST /questions` — savol yaratish
- `POST /questions/{id}/media` — rasm/video upload (presigned URL)
- `GET /questions` — ro'yxat (filter: type, level)
- `PATCH /questions/{id}`, `DELETE /questions/{id}`

**Questions (student):** `GET /questions?published=true`, `GET /questions/{id}`

**Submissions:**
- `POST /submissions/upload-url` — audio upload uchun presigned URL
- `POST /submissions` — javobni qayd etish (audio_url bilan) → Celery task
- `GET /submissions/{id}` — status + natija (polling)
- `GET /submissions?student_id=` — o'quvchi tarixi
- `GET /submissions?question_id=` — teacher uchun javoblar

**Real-time status:** `GET /submissions/{id}/events` (SSE) — `processing → done` holatini live ko'rsatish (polling alternativasi).

---

## 6. Audio oqimi (muhim detal)

1. Brauzer `MediaRecorder` bilan yozadi → **Opus/WebM** (kichik hajm, sifatli).
2. Frontend `POST /submissions/upload-url` orqali **presigned PUT URL** oladi.
3. Audio to'g'ridan-to'g'ri **object storage**'ga yuklanadi (backend bypass — tezroq, arzonroq).
4. Frontend `POST /submissions` bilan S3 key'ni yuboradi.
5. Worker audioni oladi, kerak bo'lsa `ffmpeg` orqali WAV 16kHz monoga konvert qiladi (Whisper uchun) → STT → LLM.

---

## 7. Komponent diagrammasi

```
┌─────────────┐     HTTPS      ┌──────────────┐
│  React SPA  │──────────────▶│   FastAPI    │
│ (Vite/TS)   │◀──────SSE─────│   (API)      │
└──────┬──────┘                └──────┬───────┘
       │ presigned PUT                │ enqueue
       ▼                              ▼
┌─────────────┐                ┌──────────────┐     ┌──────────┐
│ Object Store│◀───────────────│   Redis      │────▶│  Celery  │
│ (S3/R2/MinIO)│   audio olish  │  (broker)    │     │  Worker  │
└─────────────┘◀───────────────┴──────────────┘     └────┬─────┘
       ▲                         ┌──────────────┐         │
       │                         │ PostgreSQL   │◀────────┤
       └─────────────────────────┴──────────────┘         │
                                  ┌──────────────┐         │
                                  │ Whisper STT  │◀────────┤
                                  ├──────────────┤         │
                                  │ Claude (LLM) │◀────────┘
                                  └──────────────┘
```

---

## 8. Loyiha tuzilishi (monorepo)

```
russian-speaking/
├── docker-compose.yml          # postgres, redis, minio, backend, worker, frontend
├── ARCHITECTURE.md
├── backend/
│   ├── app/
│   │   ├── main.py             # FastAPI app
│   │   ├── core/               # config, security, deps
│   │   ├── models/             # SQLAlchemy
│   │   ├── schemas/            # Pydantic
│   │   ├── api/v1/             # routerlar
│   │   ├── services/           # storage, stt, llm, scoring
│   │   ├── workers/            # Celery tasks
│   │   └── db/                 # session, base
│   ├── alembic/
│   ├── pyproject.toml
│   └── Dockerfile
└── frontend/
    ├── src/
    │   ├── components/  pages/  features/
    │   ├── lib/         hooks/  api/
    │   └── App.tsx
    ├── package.json
    └── Dockerfile
```

---

## 9. Fazalarga bo'lish (yo'l xaritasi)

**Faza 0 — Skelet:** monorepo, docker-compose, DB migratsiyalar, auth (teacher/student), CI.

**Faza 1 — Asosiy MVP:**
- Teacher: 3 turdagi savol yaratish (text/image/video) + media upload.
- Student: savolni ochish, ovoz yozish, yuborish.
- Whisper STT + Claude matn tahlili → baho + feedback.
- Natija sahifasi (transkripsiya, ballar, tuzatishlar).

**Faza 2 — Akustik tahlil:**
- Беглость metrikalari (sur'at, pauza, filler) — timestamp'lardan.
- Talaffuz baholash (forced alignment + GOP).
- Waveform + transkripsiyani sinxron pleyer.

**Faza 3 — Kengaytirish:**
- Testlar (savollar to'plami = IELTS Part 1/2/3 kabi).
- Teacher dashboard: progress, statistika.
- Ko'p o'qituvchi, guruhlar.

---

## 10. Asosiy texnik qarorlar (rationale)

- **FastAPI + Celery** — AI vazifalari 5–30s davom etadi; sync HTTP'da bloklash mumkin emas. Navbat majburiy.
- **Presigned upload** — audio/video backend orqali o'tmaydi → tezlik + arzonlik.
- **Whisper `large-v3`** — ruscha uchun eng yaxshi ochiq STT; so'z timestamp'lari beglость metrikasi uchun zarur.
- **Structured LLM output** — baho integratsiyasi ishonchli bo'lishi uchun JSON schema majburlanadi.
- **Object storage + Postgres ajratilgan** — fayllar DB'da emas; DB faqat metadata.
```
