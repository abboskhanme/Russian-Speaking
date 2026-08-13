# AI wiring (Faza 3.4) — plan and resume point

> **Paused mid-slice on 2026-08-13.** `backend-dotnet` **does not compile** right now — see
> "Where it stopped" below. Nothing else in the repo is affected; the three commits before this one
> are complete and green.

## Why this exists

The admin panel has a finished AI/STT settings screen — provider pickers, model chips, masked
secrets, a "selected ≠ active" indicator — and **nothing behind it is wired**. Every real provider
is a TODO stub whose `IsConfigured` returns `false`:

| Layer | Admin panel | Backend reality |
| --- | --- | --- |
| STT — Azure Speech / Whisper | ✅ full editor | ❌ `AzureSttProvider` / `WhisperSttProvider` throw `NotImplementedException` |
| Grader — Gemini / Azure OpenAI | ✅ full editor | ❌ `GeminiGraderProvider` / `OpenAiGraderProvider` throw |
| Claude / Anthropic | ❌ absent | ❌ absent |
| Provider selection at runtime | settings compute `active_provider` | ❌ DI binds ONE provider each; nothing reads `app_settings` |

Consequence: `IsConfigured = false` ⇒ the Assessment pipeline **defers** every submission, so
attempts sit `pending` forever and the app cannot grade anything.

**The keys are already in `.env`** — `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION`, `GEMINI_API_KEY`,
`OPENAI_API_KEY`, `OPENAI_GRADER_MODEL`, `GEMINI_MODEL`. The stub comments claiming "there is no
key in this environment" are stale. `ANTHROPIC_API_KEY` is **not** set.

## Decisions taken (product, 2026-08-13)

1. **Routing = ordered chain with automatic fallback.** The admin sets an order
   (e.g. `anthropic,gemini,openai`); the first backend that is configured *and* answers serves the
   request, and `evaluations.llm_model` records the model that **actually** graded — never the
   configured name, which lies whenever a fallback ran. Task-type routing (vision model for picture
   tasks, cheap model for A1) was considered and deferred; the chain is the prerequisite for it.
2. **Claude ships unconfigured.** The Anthropic backend is written in full and appears in the admin
   panel, but reports `IsConfigured = false` until a key is entered — the same rule every other
   backend follows. Nothing changes when the key lands.
3. **Model default `claude-opus-5`**, overridable from the admin panel without a deploy.
4. The official `Anthropic` NuGet package (12.40.0) is reachable from this environment — the
   Anthropic backend uses the SDK, not hand-rolled HTTP.

## Design

`Govori.Platform` owns the seams; vendors are *backends* behind them, and the pipeline keeps seeing
exactly one grader and one STT provider:

```
Assessment pipeline
      │  ISttProvider / IGraderProvider      ← unchanged seam, one provider each
      ▼
ChainSttProvider / ChainGraderProvider       ← ordered, skips unconfigured, falls back on failure
      │  ISttBackend / IGraderBackend
      ▼
Azure · Whisper          Anthropic · Gemini · OpenAI
      ▲
      │ IAiConfigSource  (declared in Platform, implemented in Govori.Administration)
      └── app_settings (DB override → env default, ~30s cache)
```

Rules the chain encodes, each for a reason:

- **Skipped ≠ failed.** An unconfigured backend is passed over silently; a *configured* one that
  throws is logged by name. Conflating them would either spam "Claude not configured" on every
  submission or hide a vendor outage.
- **Cancellation never triggers fallback.** A cancelled request means the caller left; retrying the
  chain would bill three vendors for an answer nobody reads.
- **Config is a per-run snapshot**, so a key pasted mid-flight cannot make one run start on one
  provider and finish on another's key.
- **STT fallback is lossy on purpose.** Only Azure returns a pronunciation assessment, so falling
  through to Whisper degrades the band to text-only (4 criteria instead of 5) rather than failing
  the attempt.

## Where it stopped

**Written (uncommitted work is in this commit, compiles only once step 1 below is done):**

- `Govori.Platform/Ai/AiRuntimeConfig.cs` — the config snapshot + `AiProviders` names, default
  chains, and `ParseChain`.
- `Govori.Platform/Ai/IAiConfigSource.cs` — the seam.
- `Govori.Platform/Ai/Backends.cs` — `IGraderBackend` / `ISttBackend`.
- `Govori.Platform/Ai/ChainProviders.cs` — `ChainGraderProvider` / `ChainSttProvider`.

**🔴 Why the build is red:** `ChainProviders.cs` calls `IsConfiguredAsync(ct)`, but
`ISttProvider` / `IGraderProvider` still declare the **synchronous** `bool IsConfigured { get; }`.
That property cannot express DB-backed configuration, so the seam has to change — step 1.

## Next steps, in order

1. **Seam change:** `bool IsConfigured` → `ValueTask<bool> IsConfiguredAsync(CancellationToken)` on
   `ISttProvider` and `IGraderProvider`. Call sites: `AssessmentService:109`,
   `PlacementService:60`, `FakeSttProvider`, `FakeGraderProvider`. (`ITtsProvider` keeps its sync
   property — Guest TTS is a separate seam and out of scope.) This makes the build green again.
2. **`Govori.Platform.csproj`**: add `Microsoft.Extensions.Logging.Abstractions`,
   `Microsoft.Extensions.Http`, and `Anthropic` (12.40.0).
3. **Backends** — `Govori.Platform/Ai/Backends/`:
   - `AnthropicGraderBackend` — official SDK, `output_config.format` JSON schema for the grader
     result, `claude-opus-5`. Enable the server-side refusal fallback
     (`fallbacks` + `server-side-fallback-2026-07-01`) as the SDK version allows.
   - `GeminiGraderBackend` — REST (no official .NET SDK), `responseSchema` structured output.
   - `OpenAiGraderBackend` — one backend covering public OpenAI and Azure OpenAI (same wire
     format); `AzureOpenAiReady` on the config picks the route.
   - `AzureSpeechSttBackend` — **unscripted** recognition, `Lexical` transcript (never `Display` —
     it normalises away the learner's actual mistakes), phoneme granularity + prosody,
     pronunciation aggregate + per-word timings. Needs a webm/opus → 16k mono WAV transcode
     (ffmpeg in the api + worker images).
   - `WhisperSttBackend` — transcribe only, `Pronunciation = null`.
   - Shared grader JSON contract: 4 criteria + `overall` + `level_overall`, Uzbek feedback,
     corrections. **The LLM returns text-only scores**; `Scoring.Level` folds in the Azure
     PronScore and the orthoepy penalty afterwards (C5) — do not let the model see or guess those.
4. **`AiConfigSource`** in `Govori.Administration`, wrapping `AppSettingsService` (keeps the
   tri-state + ~30s cache in one place); register it against `IAiConfigSource` in both composition
   roots.
5. **DI** in `Govori.Api/Program.cs` and `Govori.Worker/Program.cs`: replace the two
   `AddSingleton<…, …Provider>()` stub registrations with the backends + chain providers. Providers
   become **scoped** (the config source reads the DbContext); `IHttpClientFactory` for the REST
   backends.
6. **Settings surface:** new `app_settings` keys — `grader_chain`, `stt_chain`,
   `anthropic_api_key` (secret), `anthropic_model` — added to `AppSettingsService.Spec`, then
   `AiSettingsResponse` / `AiSettingsUpdate`, then the admin **Sozlamalar** screen (chain order
   editor + a Claude section, secrets still write-only).
7. **Tests:** unit tests for the chain (skip-unconfigured, fall-back-on-throw, rethrow-on-cancel,
   model-name passthrough); an integration test that a configured chain grades end to end against
   the fakes; and a live smoke run against the real keys before declaring it done.

## Related

- Grader golden set (Faza 1.4–1.6) is still absent — see `docs/08-REWRITE-PLAN.md`. It should land
  around this work: it is what makes "the new grader is as good as the old one" a measurement
  rather than a claim.
- `docs/07-ARCHITECTURE-DOTNET.md` §7.7 describes the provider seams; §7.9 the "record the model
  that really ran" rule.
