# Characterization harness

**Purpose:** freeze the current Python behavior so the C# port can prove it did
not change anything by accident. This is the safety net the audit said the
project lacks (`docs/00-AUDIT.md` K10: 13 tests over 5 functions).

## How it works

```
generate_fixtures.py  ──imports──>  the REAL backend/app modules
        │
        ▼
   fixtures/*.json     ←── the contract. One source of truth, two languages.
        │
        ▼
Govori.Characterization  ──reads the same JSON──>  asserts C# agrees
```

The fixtures are generated **from** Python, never hand-written. A C# test that
fails means the port drifted — that is a bug to fix in C#, **not** a fixture to
edit.

## Run it (Docker-only, nothing installed on the host)

```bash
# 1. Generate fixtures from the live Python implementation
docker compose -f docker-compose.characterization.yml run --rm gen-fixtures

# 2. Prove the C# port matches
docker compose -f docker-compose.characterization.yml run --rm dotnet-characterize
```

## What each fixture pins

| Fixture | Guards | Why it matters |
|---|---|---|
| `bcrypt_corpus.json` | password hashing + 72-byte truncation | Wrong → all 50 users locked out |
| `jwt_vectors.json` | JWT claims + HS256 signature | Wrong → every session invalidated |
| `pron_math_cases.json` | `(x*4+pron)/5 − min(n*4,20)` | The score every student sees |
| `xp_cases.json` | `xp_for_band` curve | Gamification |
| `cosmetic_filter_cases.json` | dropping punctuation-only "corrections" | Correctness guard (STT has no punctuation) |
| `reference_match_cases.json` | shadowing on-topic gate (≥50%) | Shadowing XP |
| `phone_cases.json` | `+998XXXXXXXXX` normalization | Sign-up |

## Rule

Regenerate fixtures **only** when the Python side changes on purpose, and only
before cutover. After cutover, Python is gone and these become the C# unit tests
of record.
</content>
