/**
 * shared/auth — barrel. The token store + the React auth context/provider.
 */
export { tokenStore } from "./tokens";
export { AuthProvider, useAuth, useOptionalAuth } from "./AuthContext";
export type { AuthContextValue, AuthStatus, VerifyOtpResult } from "./AuthContext";
export { useFeatures, featuresOf, NO_FEATURES } from "./features";
export type { Features } from "./features";
