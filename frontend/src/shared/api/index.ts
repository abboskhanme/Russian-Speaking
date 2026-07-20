/**
 * shared/api — barrel. The typed API client + endpoint functions + wire types.
 * Import from here (`import { api, isApiError } from "shared/api"`).
 */
export { apiClient as api, request, isApiError, API_BASE } from "./client";
export type { ApiError, RequestOptions } from "./client";
export * as endpoints from "./endpoints";
export * from "./types";
export type { SubmitAudioArgs } from "./endpoints";
