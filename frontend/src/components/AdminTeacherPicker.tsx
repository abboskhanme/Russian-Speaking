import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import type { AdminTeacher } from "../lib/types";
import { Field, inp } from "./govori";

/**
 * Admin-only owner selector for newly created content (questions / modules).
 * An admin picks which teacher the content is created under; the id is sent as
 * `teacher_id`. Renders nothing for non-admins (they always own what they make).
 */
export function AdminTeacherPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const { user } = useAuth();
  const { t } = useI18n();
  const isAdmin = user?.role === "admin";

  const { data: teachers } = useQuery({
    queryKey: ["admin-teachers"],
    queryFn: async () => (await api.get<AdminTeacher[]>("/admin/teachers")).data,
    enabled: isAdmin,
  });

  if (!isAdmin) return null;

  return (
    <Field label={t("ownerTeacher")}>
      <select value={value} onChange={(e) => onChange(e.target.value)} style={inp}>
        <option value="">— {t("ownerTeacherPick")} —</option>
        {(teachers ?? [])
          .filter((tch) => tch.is_active)
          .map((tch) => (
            <option key={tch.id} value={tch.id}>
              {tch.full_name} ({tch.email})
            </option>
          ))}
      </select>
    </Field>
  );
}
