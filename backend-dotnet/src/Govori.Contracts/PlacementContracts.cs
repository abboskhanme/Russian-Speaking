namespace Govori.Contracts;

/// <summary>
/// One of the 3 fixed Russian placement ("dastlabki sinov") questions handed to a freshly-registered
/// student. Mirrors the intro/question cards in the owner's mockup (frames A2 · "1-savol"). No DB row
/// backs these — they are hardcoded in <c>Govori.Assessment.PlacementService</c>. Serialized
/// snake_case: <c>index</c>, <c>prompt_ru</c>.
/// </summary>
public sealed record PlacementQuestionResponse(int Index, string PromptRu);

/// <summary>
/// The per-answer band (0–100) for one submitted placement recording. Grading reuses the SAME
/// <c>ISttProvider</c> + <c>IGraderProvider</c> seams as the app; while those are STUB providers
/// (IsConfigured=false, no AI keys) the band is a deterministic placeholder so the flow works
/// end-to-end. NOTHING is stored per answer. Serialized snake_case: <c>index</c>, <c>band</c>.
/// </summary>
public sealed record PlacementSubmitResponse(int Index, double Band);

/// <summary>
/// The bands the client collected from the 3 <c>POST /api/placement/submit</c> calls, sent back to
/// <c>POST /api/placement/complete</c> to be averaged → CEFR. The server keeps NO per-answer state
/// (MVP: no schema change), so the client is the source of the three numbers. Serialized snake_case:
/// <c>bands</c>.
/// </summary>
public sealed record PlacementCompleteRequest(IReadOnlyList<double> Bands);

/// <summary>
/// The placement result shown on the "JOYLASHTIRUV TUGADI" screen (frame A3): the CEFR level, its
/// short Uzbek label (e.g. A2 · "boshlang'ich") and the averaged band. Serialized snake_case:
/// <c>level</c>, <c>label_uz</c>, <c>band</c>.
/// </summary>
public sealed record PlacementResultResponse(string Level, string LabelUz, double Band);
