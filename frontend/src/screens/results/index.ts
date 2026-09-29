/**
 * screens/results — the results drill-down: the full "Barcha natijalar" history
 * (AllResultsScreen) and one attempt's detail (AttemptDetailScreen). Reached from
 * Profile → Natijalar. Presentational + prop-driven; composed from `shared/ui` +
 * `widgets` + tokens.
 */
export { AllResultsScreen } from "./AllResultsScreen";
export type {
  AllResultsScreenProps,
  AllResultsItem,
  AllResultsStatus,
  ResultTrend,
} from "./AllResultsScreen";

export { AttemptDetailScreen } from "./AttemptDetailScreen";
export type { AttemptDetailScreenProps, AttemptDetail } from "./AttemptDetailScreen";
