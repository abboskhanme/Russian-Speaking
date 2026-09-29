namespace Govori.Contracts;

// ─── Error bodies that carry a machine-readable code ─────────────────────────
// Every error in this API answers `{ "detail": "..." }` (see Govori.Api/Startup/ApiProblem.cs).
// `detail` is prose for a human, so a client that branches on it is branching on wording — and the
// wording is free to change. Where the UI has to DO something different per failure (offer
// "promote this student instead", highlight the one bad field, explain why a button is disabled),
// the body additionally carries `code`: a stable snake_case identifier that is part of the contract.
//
// ADDITIVE on purpose: `detail` stays exactly where every existing client already reads it, so a
// client that knows nothing about `code` keeps working unchanged.
//
// These are records in Contracts, not anonymous objects in the endpoints, so they reach the OpenAPI
// document's `components.schemas` (OpenApiDocument exports every public DTO in this assembly) and the
// frontend can type them.

/// <summary>
/// The <c>{ "detail": ..., "code": ... }</c> error body. <c>Code</c> is one of the constants in
/// <see cref="AdminErrorCodes"/> or <see cref="CatalogErrorCodes"/>; <c>Detail</c> is display text.
/// </summary>
public sealed record CodedErrorResponse(string Detail, string Code);
