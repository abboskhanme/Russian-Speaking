import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  dateLang,
  formatDate,
  formatDateTime,
  formatDayMonth,
  formatMonthYear,
  formatRelative,
  formatRelativeDay,
  formatTime,
} from "./date";
import type { DateInput, DateOptions } from "./date";

/**
 * The date helpers bound to the current UI language + `t`, for components:
 * `const fmt = useDateFormat(); fmt.dateTime(row.created_at)`.
 */
export function useDateFormat() {
  const { t, i18n } = useTranslation();
  const lang = dateLang(i18n.language);
  return useMemo(
    () => ({
      lang,
      date: (v: DateInput, o?: DateOptions) => formatDate(v, o),
      time: (v: DateInput, o?: DateOptions) => formatTime(v, o),
      dateTime: (v: DateInput, o?: DateOptions) => formatDateTime(v, o),
      dayMonth: (v: DateInput, o?: DateOptions & { withTime?: boolean }) => formatDayMonth(v, lang, o),
      monthYear: (v: DateInput, o?: DateOptions & { capitalize?: boolean }) => formatMonthYear(v, lang, o),
      relative: (v: DateInput, now?: Date) => formatRelative(v, t, now),
      relativeDay: (v: DateInput, now?: Date, o?: DateOptions) => formatRelativeDay(v, t, now, o),
    }),
    [lang, t],
  );
}
