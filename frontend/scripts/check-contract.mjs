#!/usr/bin/env node
/**
 * Fails when `src/shared/api/types.ts` and the backend's OpenAPI document disagree.
 *
 * WHY THIS EXISTS (docs/08 Faza 4.2, docs/10 §S3.3). The API types are written by hand, and that
 * is deliberate: `types.ts` carries ~1400 lines of reasoning a generator cannot hold — why
 * `known_open_ai_models` is still accepted alongside `known_openai_models`, why a field is optional
 * (an older API image), what the tri-state PATCH semantics are. Replacing it with generated output
 * would delete all of that and give nothing back. But hand-written means the compiler cannot see a
 * backend change: the API adds a field, renames one, or turns a `string` into a `number`, and the
 * frontend finds out in PRODUCTION rather than in `tsc`.
 *
 * So the hand-written file stays and this script is what notices. The drift is caught in CI instead
 * of at compile time — later than a generator would, far earlier than a user would.
 *
 * WHAT IS CHECKED, per matched pair (an OpenAPI schema ↔ a `types.ts` type):
 *   • a field in the document but not in `types.ts`      → ERROR (the backend added it, silently)
 *   • a field in `types.ts` but not in the document      → ERROR (the frontend expects a ghost)
 *   • the kinds disagree — string / number / boolean / object, or array vs scalar → ERROR
 *   • array ELEMENT kinds disagree, when both are knowable → ERROR
 *   • a string-enum schema vs a TS string-literal union: the member sets → ERROR
 *   • an OpenAPI schema that matches nothing and is not declared below → ERROR
 *   • optionality / nullability disagrees                → WARNING, never an error
 *
 * Optionality is a warning ON PURPOSE. This repo widens optionality deliberately — a field the
 * server always sends is still typed `field?:` so the app keeps working against an older API image
 * during a rolling deploy. Making that an error would break a legitimate pattern, and the cure
 * would be to weaken the pattern rather than the gate.
 *
 * WHAT IS NOT CHECKED. Names and kinds, not values: string formats (`uuid` vs plain string),
 * numeric ranges, enum ORDER, the shape reached through a `$ref` (each referenced DTO has its own
 * schema and is compared on its own), and which response belongs to which operation — the document
 * carries no response bodies at all, and
 * `backend-dotnet/src/Govori.Api/Startup/OpenApiDocument.cs` says why. What is left is exactly the
 * most common drift: a field added, removed, renamed or retyped.
 *
 * Run: `npm run check:contract`. The document it reads must be CURRENT — CI regenerates it and
 * fails on a diff before running this, because two stale files agree with each other perfectly.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const TYPES = fileURLToPath(new URL("../src/shared/api/types.ts", import.meta.url));
const OPENAPI = fileURLToPath(new URL("../../backend-dotnet/openapi.json", import.meta.url));

/* ── The name map, and the rule that keeps it honest ───────────────────────────
 *
 * EVERY ENTRY BELOW CARRIES ITS REASON, and that is the whole point. A name map in a gate like
 * this is the one place where "make it green" is a one-line edit; a year of unexplained rows turns
 * the gate into decoration — green, and checking nothing. A row nobody can justify should be
 * DELETED, not kept: if the honest reason is "the two names drifted apart", the fix is to rename
 * one side, not to record the drift here.
 */

/** `types.ts` name → OpenAPI schema name, for the genuine one-offs. */
const ALIASES = {
  // The admin panel shows students and teachers side by side and has to keep the two apart at the
  // import site, so it qualifies both names. The server does not need to: the routes already
  // separate them (/api/admin/students · /api/admin/teachers).
  AdminStudentResponse: "StudentResponse",
  AdminTeacherResponse: "TeacherResponse",
  AdminStudentUpdateArgs: "StudentUpdateRequest",
  AdminTeacherUpdateArgs: "TeacherUpdateRequest",

  // `*Wire` marks "the shape as it arrives", because the drill screen ALSO has a local state type
  // of that name. Without the suffix the two would be indistinguishable where they are imported.
  DrillStateWire: "DrillState",
  DrillOutcomeWire: "DrillOutcome",

  // POST /api/auth/otp/request. The server names the response after the ACT (a code was sent); the
  // frontend names it after the REQUEST it answers, because `OtpDeliveryInfo` — the base interface
  // it extends — is already the name for the delivery half, shared by sign-in, registration and
  // phone-change.
  OtpRequestResponse: "OtpSentResponse",

  // The Progress screen owns these three and drops the `Response` suffix its own file convention
  // does not use; the server keeps it because every DTO in that module ends that way.
  ProgressSkill: "ProgressSkillResponse",
  ProgressTrendPoint: "ProgressTrendPointResponse",
  LeaderboardRow: "ProgressLeaderboardRowResponse",

  // Teacher insights. The frontend names each piece after what the CHART is (a weekday column, a
  // point on the trend line, one error pattern); the server names it after what the ROW is (a day,
  // a month, an error). Both readings are right for their own file, and neither name is wrong
  // enough to be worth a rename across two codebases.
  InsightsWeekDay: "InsightsDayPoint",
  InsightsTrendPoint: "InsightsMonthPoint",
  InsightsErrorPattern: "InsightsErrorResponse",
  InsightsRemediation: "InsightsRemediationResponse",
  InsightsSkills: "InsightsSkillsResponse",
};

/**
 * `types.ts` names a request body `*Args` because it is the argument object of the matching
 * `endpoints.ts` function (`updateProfile(args)`); the server names it `*Request` or `*Update`
 * because it is the request body. Eleven pairs follow this today, so it is a CONVENTION and
 * belongs here as a rule — eleven rows in ALIASES would each need their own justification and
 * every one of them would say the same thing.
 */
const NAME_RULES = [
  (name) => (name.endsWith("Args") ? name.slice(0, -"Args".length) : null),
  (name) => (name.endsWith("Args") ? `${name.slice(0, -"Args".length)}Request` : null),
];

/**
 * OpenAPI schemas with no `types.ts` mirror, and why the frontend does not have one. A schema that
 * is NOT listed here and matches nothing fails the gate: adding an entry has to be a decision
 * somebody makes, because "the frontend does not know about this shape" is exactly what a silent
 * contract drift looks like from this side.
 */
const NOT_MIRRORED = {
  // Request bodies the frontend builds INLINE at the call site — `{ outcome }`, `{ bands }`, a
  // FormData — so there is no named type for them to drift from. Giving each a `types.ts`
  // interface would add a name without adding a check.
  CreateGroupRequest: "built inline by createGroup()",
  CreateReviewsRequest: "worker-side only; no client sends it",
  DrillAttemptRequest: "multipart FormData, built in submitDrillAttempt()",
  GoogleAuthRequest: "built inline by googleLogin()",
  JoinGroupRequest: "built inline by joinGroup()",
  LogoutRequest: "built inline by logout()",
  OtpRequestRequest: "built inline by requestOtp()",
  OtpVerifyRequest: "built inline by verifyOtp()",
  PhoneChangeConfirmRequest: "built inline by confirmPhoneChange()",
  PhoneChangeRequestRequest: "built inline by requestPhoneChange()",
  PlacementCompleteRequest: "built inline by completePlacement()",
  RefreshRequest: "built inline by the auth client's refresh path",
  ReviewAnswerRequest: "built inline by answerReview()",
  ReviewSubmissionRequest: "built inline by reviewSubmission()",
  RoleplayStartRequest: "built inline by the conversation screen",
  PlanUpsertRequest: "mirrored as PlanUpsertArgs — see ALIASES' *Args rule",

  // F1 · AI Suhbat keeps its own contract next to the screen that uses it
  // (src/screens/conversation/roleplayApi.ts) rather than in the shared file, so these are mirrored
  // — just not HERE. Worth moving into types.ts the day a second screen needs them; until then the
  // duplication this gate would prevent does not exist.
  RoleplayCatalogResponse: "typed in screens/conversation/roleplayApi.ts",
  RoleplayScenarioResponse: "typed in screens/conversation/roleplayApi.ts",
  RoleplayStartResponse: "typed in screens/conversation/roleplayApi.ts",
  RoleplayTurnResponse: "typed in screens/conversation/roleplayApi.ts",
  RoleplaySummaryResponse: "typed in screens/conversation/roleplayApi.ts",
  RoleplayCorrection: "typed in screens/conversation/roleplayApi.ts",

  // GET /api/review returns the raw SRS queue; the app reaches spaced repetition through
  // /api/review/drill (ReviewDrillResponse), which IS mirrored.
  ReviewItemResponse: "GET /api/review has no caller — the app uses /api/review/drill",

  // The /hubs/attempts SignalR payload, not a REST body. The SPA has no SignalR client at all
  // (it polls the attempt), so there is nothing on this side to keep in step.
  GradingProgressEvent: "SignalR hub payload; the SPA polls instead and has no hub client",
};

/**
 * Fields `types.ts` declares that the API does not send, kept ON PURPOSE. Same discipline as
 * above: without a reason next to it, a row here is indistinguishable from a field the backend
 * quietly deleted.
 */
const EXTRA_FIELDS = {
  AiSettingsResponse: {
    // Deliberate back-compat, and the comment in types.ts is the long version. `KnownOpenaiModels`
    // is spelled that way in C# precisely so SnakeCaseLower produces `known_openai_models`; an API
    // image built before that fix sends `known_open_ai_models`. The panel accepts both so a rolling
    // deploy does not blank the suggestion chips. Delete this the day no such image can still be
    // running.
    known_open_ai_models: "older API images spell it this way — see the note in types.ts",
  },
};

const candidates = (name) =>
  ALIASES[name]
    ? [ALIASES[name]]
    : [name, ...NAME_RULES.map((rule) => rule(name)).filter(Boolean)];

/* ── The `types.ts` side ──────────────────────────────────────────────────── */

const KEYWORD_KINDS = {
  [ts.SyntaxKind.StringKeyword]: "string",
  [ts.SyntaxKind.NumberKeyword]: "number",
  [ts.SyntaxKind.BooleanKeyword]: "boolean",
  [ts.SyntaxKind.ObjectKeyword]: "object",
  [ts.SyntaxKind.AnyKeyword]: "any",
  [ts.SyntaxKind.UnknownKeyword]: "any",
  [ts.SyntaxKind.NeverKeyword]: "any",
  [ts.SyntaxKind.NullKeyword]: "null",
  [ts.SyntaxKind.UndefinedKeyword]: "null",
  [ts.SyntaxKind.VoidKeyword]: "null",
};

function parseTypes() {
  const source = ts.createSourceFile(
    TYPES,
    readFileSync(TYPES, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );

  const interfaces = new Map();
  const aliases = new Map();
  for (const statement of source.statements) {
    if (ts.isInterfaceDeclaration(statement)) interfaces.set(statement.name.text, statement);
    else if (ts.isTypeAliasDeclaration(statement)) aliases.set(statement.name.text, statement.type);
  }

  /**
   * The kind of one type NODE. Syntactic on purpose — no type checker, no program, no tsconfig
   * resolution: everything this gate compares is declared in the one file it reads.
   */
  function classify(node, seen = new Set()) {
    if (ts.isParenthesizedTypeNode(node)) return classify(node.type, seen);

    if (ts.isUnionTypeNode(node)) {
      let nullable = false;
      const parts = [];
      for (const member of node.types) {
        const inner = classify(member, seen);
        if (inner.kind === "null") nullable = true;
        else parts.push(inner);
      }
      if (parts.length === 0) return { kind: "null", nullable: true };
      const distinct = [...new Set(parts.map((part) => part.kind))];
      return {
        kind: distinct.length === 1 ? distinct[0] : "any",
        elementKind: distinct.length === 1 ? parts[0].elementKind : undefined,
        nullable,
      };
    }

    if (ts.isArrayTypeNode(node))
      return { kind: "array", elementKind: classify(node.elementType, seen).kind };

    if (ts.isTypeLiteralNode(node) || ts.isIntersectionTypeNode(node)) return { kind: "object" };

    if (ts.isLiteralTypeNode(node)) {
      const { literal } = node;
      if (ts.isStringLiteral(literal)) return { kind: "string" };
      if (ts.isNumericLiteral(literal)) return { kind: "number" };
      if (literal.kind === ts.SyntaxKind.NullKeyword) return { kind: "null" };
      if (literal.kind === ts.SyntaxKind.TrueKeyword || literal.kind === ts.SyntaxKind.FalseKeyword)
        return { kind: "boolean" };
      return { kind: "any" };
    }

    if (ts.isTypeReferenceNode(node)) {
      const name = node.typeName.getText();
      if (name === "Array" || name === "ReadonlyArray")
        return {
          kind: "array",
          elementKind: node.typeArguments?.[0] ? classify(node.typeArguments[0], seen).kind : "any",
        };
      if (name === "Record" || name === "Partial" || name === "Pick" || name === "Omit")
        return { kind: "object" };
      if (seen.has(name)) return { kind: "any" };
      const alias = aliases.get(name);
      if (alias) return classify(alias, new Set(seen).add(name));
      return interfaces.has(name) ? { kind: "object" } : { kind: "any" };
    }

    return { kind: KEYWORD_KINDS[node.kind] ?? "any" };
  }

  /** Flattens `interface A extends B` — the wire shape is the union of both. */
  function fields(name, seen = new Set()) {
    const declaration = interfaces.get(name);
    const result = new Map();
    if (!declaration || seen.has(name)) return result;
    seen.add(name);

    for (const clause of declaration.heritageClauses ?? [])
      for (const parent of clause.types)
        for (const [key, value] of fields(parent.expression.getText(), seen)) result.set(key, value);

    for (const member of declaration.members) {
      if (!ts.isPropertySignature(member) || !member.type) continue;
      const key = ts.isStringLiteral(member.name) ? member.name.text : member.name.getText();
      const classified = classify(member.type);
      result.set(key, {
        kind: classified.kind,
        elementKind: classified.elementKind,
        optional: Boolean(member.questionToken) || Boolean(classified.nullable),
      });
    }
    return result;
  }

  /** The member set of `type X = "a" | "b"`, or null when it is not a string-literal union. */
  function literals(name) {
    const node = aliases.get(name);
    if (!node) return null;
    const members = ts.isUnionTypeNode(node) ? node.types : [node];
    const values = [];
    for (const member of members) {
      if (!ts.isLiteralTypeNode(member) || !ts.isStringLiteral(member.literal)) return null;
      values.push(member.literal.text);
    }
    return values;
  }

  return { interfaces, aliases, fields, literals };
}

/* ── The OpenAPI side ─────────────────────────────────────────────────────── */

/** Follows `$ref`, and the `nullable` + `allOf` wrapper OpenAPI 3.0 forces on a nullable ref. */
function resolve(schema, schemas, depth = 0) {
  if (!schema || depth > 8) return {};
  if (schema.$ref) return resolve(schemas[schema.$ref.split("/").pop()], schemas, depth + 1);
  if (schema.allOf?.length === 1) return resolve(schema.allOf[0], schemas, depth + 1);
  return schema;
}

function schemaKind(schema, schemas) {
  const resolved = resolve(schema, schemas);
  switch (resolved.type) {
    case "array":
      return { kind: "array", elementKind: schemaKind(resolved.items, schemas).kind };
    case "integer":
    case "number":
      return { kind: "number" };
    case "string":
      return { kind: "string" };
    case "boolean":
      return { kind: "boolean" };
    case "object":
      return { kind: "object" };
    default:
      // No `type` at all — `object` / `JsonElement` on the server, i.e. any JSON.
      return { kind: "any" };
  }
}

const nullableOnWire = (schema, schemas) =>
  Boolean(schema?.nullable) || Boolean(resolve(schema, schemas).nullable);

/* ── The comparison ───────────────────────────────────────────────────────── */

const errors = [];
const warnings = [];
const notes = [];

let document;
try {
  document = JSON.parse(readFileSync(OPENAPI, "utf8"));
} catch (error) {
  console.error(
    `✗ no readable OpenAPI document at ${OPENAPI}\n\n  ${error.message}\n\n` +
      "Regenerate it — the command is in docs/09-DOCKER.md under “OpenAPI hujjati”.\n",
  );
  process.exit(1);
}

const schemas = document.components?.schemas ?? {};
const pathCount = Object.keys(document.paths ?? {}).length;
const schemaCount = Object.keys(schemas).length;

// The guard, in the shape the golden-set CI job uses. A gate whose input went missing has to FAIL,
// not pass: "nothing to check" and "nothing wrong" are indistinguishable from the outside, and only
// one of them is good news. The floors are far below today's numbers (84 paths, 110 schemas) — they
// catch an empty or stub document, not a shrinking API.
if (pathCount < 50 || schemaCount < 50) {
  console.error(
    `✗ the OpenAPI document describes almost nothing: ${pathCount} paths, ${schemaCount} schemas.\n\n` +
      "That is not a green light. It means the emit produced a stub, and every check below would\n" +
      "trivially pass. Regenerate the document (docs/09-DOCKER.md) and run this again.\n",
  );
  process.exit(1);
}

const { interfaces, aliases, fields, literals } = parseTypes();

const matchedSchemas = new Set();
const unmatchedLocalTypes = [];

for (const name of [...interfaces.keys(), ...aliases.keys()].sort()) {
  const schemaName = candidates(name).find((candidate) => schemas[candidate]);
  if (!schemaName) {
    unmatchedLocalTypes.push(name);
    continue;
  }
  matchedSchemas.add(schemaName);

  const schema = schemas[schemaName];
  const label = name === schemaName ? name : `${name} ↔ ${schemaName}`;

  if (schema.enum) {
    const values = literals(name);
    if (!values) {
      errors.push(
        `${label}: the API serializes this as a string enum, but ${name} is not a union of string literals.`,
      );
      continue;
    }
    for (const value of schema.enum)
      if (!values.includes(value))
        errors.push(`${label}: the API can send "${value}", which ${name} does not allow.`);
    for (const value of values)
      if (!schema.enum.includes(value))
        errors.push(`${label}: ${name} allows "${value}", which the API never sends.`);
    continue;
  }

  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const mirror = fields(name);
  if (mirror.size === 0) {
    errors.push(`${label}: matched an object schema, but ${name} declares no fields to compare.`);
    continue;
  }
  const allowedExtras = EXTRA_FIELDS[schemaName] ?? {};

  for (const [field, spec] of Object.entries(properties)) {
    const local = mirror.get(field);
    if (!local) {
      errors.push(`${label}: the API sends \`${field}\`, and types.ts does not declare it.`);
      continue;
    }

    const wire = schemaKind(spec, schemas);
    if (local.kind !== "any" && wire.kind !== "any" && local.kind !== wire.kind) {
      errors.push(`${label}.${field}: the API sends ${wire.kind}, types.ts declares ${local.kind}.`);
    } else if (
      wire.kind === "array" &&
      local.elementKind &&
      wire.elementKind &&
      local.elementKind !== "any" &&
      wire.elementKind !== "any" &&
      local.elementKind !== wire.elementKind
    ) {
      errors.push(
        `${label}.${field}: the API sends ${wire.elementKind}[], types.ts declares ${local.elementKind}[].`,
      );
    }

    const wireOptional = !required.has(field) || nullableOnWire(spec, schemas);
    if (wireOptional !== local.optional)
      warnings.push(
        `${label}.${field}: ${wireOptional ? "the API may omit it or send null" : "the API always sends it"}` +
          `, types.ts says ${local.optional ? "optional" : "always present"}.`,
      );
  }

  for (const field of mirror.keys()) {
    if (field in properties) continue;
    if (field in allowedExtras) {
      notes.push(`${label}.${field}: kept though the API never sends it — ${allowedExtras[field]}`);
      continue;
    }
    errors.push(`${label}: types.ts declares \`${field}\`, and the API never sends it.`);
  }
}

/* ── Coverage: nothing gets to be unknown ──────────────────────────────────── */

for (const name of Object.keys(schemas).sort()) {
  if (matchedSchemas.has(name)) continue;
  if (name in NOT_MIRRORED) {
    notes.push(`${name}: not mirrored — ${NOT_MIRRORED[name]}`);
    continue;
  }
  errors.push(
    `${name}: the API describes this shape and nothing in types.ts matches it. Either mirror it ` +
      "(as `" +
      name +
      "`, or add a row to ALIASES with the reason for the second name), or add it to NOT_MIRRORED " +
      "saying why the frontend does not need it.",
  );
}

for (const name of Object.keys(EXTRA_FIELDS))
  if (!schemas[name])
    errors.push(`EXTRA_FIELDS lists ${name}, which the API no longer describes — drop the entry.`);

for (const name of Object.keys(NOT_MIRRORED))
  if (!schemas[name])
    errors.push(`NOT_MIRRORED lists ${name}, which the API no longer describes — drop the entry.`);

/* ── Report ───────────────────────────────────────────────────────────────── */

const compared = matchedSchemas.size;
console.log(
  `contract: ${compared} of ${schemaCount} schemas compared against types.ts ` +
    `(${Object.keys(NOT_MIRRORED).length} declared as not mirrored)`,
);
if (unmatchedLocalTypes.length > 0)
  console.log(
    `          ${unmatchedLocalTypes.length} types.ts types have no schema (frontend-local): ` +
      unmatchedLocalTypes.join(", "),
  );
for (const note of notes) console.log(`  · ${note}`);
for (const warning of warnings) console.log(`  ⚠ ${warning}`);

if (errors.length === 0) {
  console.log(`✓ the hand-written types match the API contract (${warnings.length} warnings)`);
  process.exit(0);
}

console.error(`\n✗ ${errors.length} contract mismatch(es):\n`);
for (const error of errors) console.error(`  ✗ ${error}`);
console.error(
  "\nThe API and the hand-written types have drifted. Fix the side that is wrong — and if the\n" +
    "document is what is stale, regenerate it (docs/09-DOCKER.md) before believing any of this.\n",
);
process.exit(1);
