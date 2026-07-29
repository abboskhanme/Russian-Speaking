# Characterization harness

**Purpose:** pin the exact numeric and cryptographic behaviour of the platform so
a refactor cannot quietly change a score, a password hash, or a token. This is the
safety net the audit said the project lacks (`docs/00-AUDIT.md` K10: 13 tests over
5 functions).

## How it works

```
   fixtures/*.json     ←── FROZEN GOLDENS. The specification, checked into the repo.
        │
        ▼
Govori.Characterization  ──reads the JSON──>  asserts the C# implementation agrees
```

The fixtures are **frozen golden snapshots owned by the C# tests**. They are not
generated, not derived from anything, and there is no generator to run — the JSON
files in `fixtures/` are themselves the source of truth. A failing characterization
test means the C# implementation drifted: **fix the code, not the fixture.**

Changing a fixture is changing the product's observable behaviour. Do it only as a
deliberate, reviewed decision — never to make a red test go green.

## Run it (Docker-only, nothing installed on the host)

The tests locate `fixtures/` by walking up from the test assembly, so they must be
run with the **repository root** mounted — mounting only `backend-dotnet/` makes
them fail spuriously.

```bash
docker run --rm -v "$PWD":/repo -w /repo mcr.microsoft.com/dotnet/sdk:9.0 \
  dotnet test backend-dotnet/tests/Govori.Characterization/Govori.Characterization.csproj
```

## What each fixture pins

| Fixture | Guards | Why it matters |
|---|---|---|
| `bcrypt_corpus.json` | password hashing + 72-byte truncation | Wrong → all existing users locked out |
| `jwt_vectors.json` | JWT claims + HS256 signature | Wrong → every session invalidated |
| `pron_math_cases.json` | `(x*4+pron)/5 − min(n*4,20)` | The score every student sees |
| `scoring_cases.json` | progress / band aggregation | Student-visible progress |
| `xp_cases.json` | `xp_for_band` curve | Gamification |
| `task_index_cases.json` | task ordering within a module | Lesson sequencing |
| `needs_premium_cases.json` | freemium gate (free attempts per module) | Monetization |
| `cosmetic_filter_cases.json` | dropping punctuation-only "corrections" | Correctness guard (STT has no punctuation) |
| `reference_match_cases.json` | shadowing on-topic gate (≥50%) | Shadowing XP |
| `phone_cases.json` | `+998XXXXXXXXX` normalization | Sign-up |
