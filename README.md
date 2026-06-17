# RusSpeak — Rus tili speaking platformasi

IELTS Speaking uslubidagi, faqat rus tiliga moslangan speaking mashq platformasi.
O'qituvchi savol kiritadi → o'quvchi gapirib javob beradi (ovoz yoziladi) → AI tahlil qiladi va baho/feedback beradi.

Arxitektura tafsilotlari: [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## Stek

- **Frontend:** React + TypeScript + Vite + Tailwind CSS
- **Backend:** Python FastAPI + SQLAlchemy + Celery
- **DB:** PostgreSQL · **Navbat/kesh:** Redis · **Fayllar:** MinIO (S3-mos)
- **AI:** OpenAI Whisper (STT) + Google Gemini (matn tahlili)

## Ishga tushirish (Docker)

1. Env faylni tayyorlang:
   ```bash
   cp .env.example .env
   ```
   `.env` ichida **`OPENAI_API_KEY`** va **`GEMINI_API_KEY`** ni kiriting.
   Production'da `SECRET_KEY` ni o'zgartiring.

2. Servislarni ko'taring:
   ```bash
   docker compose up --build
   ```

3. DB jadvallarini yarating (birinchi marta):
   ```bash
   docker compose exec backend alembic revision --autogenerate -m "init"
   docker compose exec backend alembic upgrade head
   ```

4. Manzillar:
   - Frontend: http://localhost:5173
   - API docs (Swagger): http://localhost:8000/docs
   - MinIO konsoli: http://localhost:9001 (login: `minioadmin` / `minioadmin`)

## Oqim

1. **O'qituvchi** ro'yxatdan o'tadi (role: teacher) → savol yaratadi (text/rasm/video) → publikatsiya qiladi.
2. **O'quvchi** (role: student) savolni ochadi → ovoz yozadi → yuboradi.
3. Backend audioni MinIO'ga saqlaydi → Celery worker: Whisper (transkripsiya) → Gemini (baho).
4. O'quvchi natijani ko'radi: ballar, transkripsiya, tuzatishlar, feedback.

## Loyiha tuzilishi

```
backend/   FastAPI app, modellar, API, Celery worker, AI servislar
frontend/  React SPA (sahifalar, recorder, API klient)
docker-compose.yml
ARCHITECTURE.md
```

## Keyingi qadamlar (Faza 2)

- Akustik tahlil: беглость (sur'at/pauza) — Whisper timestamp'laridan.
- Talaffuz baholash (forced alignment + GOP).
- Teacher dashboard: o'quvchilar progressi, statistika.
- Testlar (savollar to'plami = IELTS Part 1/2/3).
