// Integration tests here boot the real Govori.Api host via WebApplicationFactory and inject
// SECRET_KEY + the connection string through PROCESS-WIDE environment variables (Program.cs
// reads them at WebApplication.CreateBuilder, before any test-server config override can run).
// Two host-booting fixtures (AuthEndpointsTests, IdentityEndpointsTests) now share that env,
// so running their collections in parallel would race on SECRET_KEY. They also share one
// database — the per-run one from TestDatabase, which isolates this RUN from every other run and
// from the dev database, but not the classes within a run from each other.
// Serialize all collections — correctness over speed for a handful of DB-backed tests.
[assembly: CollectionBehavior(DisableTestParallelization = true)]
