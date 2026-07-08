import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import type { Question } from "../lib/types";
import { Loading, PageHead } from "../components/govori";
import { TestsTable } from "../components/TestsTable";

export function AdminTests() {
  const { t } = useI18n();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-tests"],
    queryFn: async () => (await api.get<Question[]>("/questions")).data,
  });

  return (
    <div className="focus-wrap">
      <PageHead title={t("allTestsTitle")} sub={t("allTestsHint")} />

      {isLoading ? <Loading /> : <TestsTable questions={data ?? []} showTeacher />}
    </div>
  );
}
