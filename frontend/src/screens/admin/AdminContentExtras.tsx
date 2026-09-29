import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Badge, Button, Card, Text, cx } from "../../shared/ui";
import styles from "./AdminContentExtras.module.css";

/**
 * The admin-only parts of the Kontent section (`/admin/content`).
 *
 * The section itself is the teacher's C1/C4 pages run inside the admin shell (see
 * `app/contentPanel`). These are the three things only an admin sees there, kept in
 * the admin folder so the teacher screens carry a render SLOT and never admin UI:
 *
 *  • who wrote each module and who can see it (the admin's list holds everyone's);
 *  • the visibility picker, whose third option — **Rasmiy** — is the official
 *    catalog, and which a teacher is never offered (the server answers a teacher's
 *    `public` with 403 `public_requires_admin`);
 *  • the empty state of a fresh install, where there is no starter content and this
 *    section is the only way the catalog comes to exist.
 */

export type ModuleVisibility = "public" | "group" | "private";

const VISIBILITIES: ModuleVisibility[] = ["public", "group", "private"];

/** Narrows the wire string. Anything unknown is `null`, and renders as nothing — a
 * guessed label on a value this build does not know would be a claim it cannot back. */
export function asVisibility(raw: string | null | undefined): ModuleVisibility | null {
  return VISIBILITIES.includes(raw as ModuleVisibility) ? (raw as ModuleVisibility) : null;
}

function visibilityLabel(v: ModuleVisibility, t: TFunction): string {
  switch (v) {
    case "public":
      return t("admin.catalog.public");
    case "group":
      return t("admin.catalog.group");
    case "private":
      return t("admin.catalog.private");
  }
}

function visibilityOption(v: ModuleVisibility, t: TFunction): { label: string; hint: string } {
  switch (v) {
    case "public":
      return { label: t("admin.catalog.publicOption"), hint: t("admin.catalog.publicHint") };
    case "group":
      return { label: t("admin.catalog.groupOption"), hint: t("admin.catalog.groupHint") };
    case "private":
      return { label: t("admin.catalog.privateOption"), hint: t("admin.catalog.privateHint") };
  }
}

/** "Rasmiy" · "Guruh" · "Shaxsiy". Official is the one that stands out: it is the
 * row that reaches every student. */
export function VisibilityBadge({ visibility }: { visibility: string }) {
  const { t } = useTranslation();
  const v = asVisibility(visibility);
  if (!v) return null;
  return (
    <Badge variant={v === "public" ? "primary" : v === "group" ? "info" : "neutral"} size="sm">
      {visibilityLabel(v, t)}
    </Badge>
  );
}

/** The extra line on a module row: visibility + author. Spans only — it renders
 * inside the row's `<button>`, where a block element or a control would be invalid. */
export function AdminModuleMeta({
  visibility,
  ownerName,
}: {
  visibility: string;
  ownerName?: string | null;
}) {
  const { t } = useTranslation();
  return (
    <span className={styles.meta}>
      <VisibilityBadge visibility={visibility} />
      {ownerName && (
        <Text as="span" variant="body-s" color="muted" truncate>
          {t("admin.catalog.owner", { name: ownerName })}
        </Text>
      )}
    </span>
  );
}

/**
 * **Ko'rinish** — who can see this module, under the editor's name/topic/level form.
 *
 * Saved on selection rather than with the form's own button: it is a separate PATCH
 * field, and folding it into "Saqlash" would make publishing to every student depend
 * on remembering a second click. The hint beside each option says what it means in
 * students, because "public" alone does not say that a draft still reaches nobody.
 */
export function AdminVisibilityCard({
  visibility,
  ownerName,
  onChange,
}: {
  visibility: string;
  ownerName?: string | null;
  /** Rejects on failure; the card reports it and keeps the old selection. */
  onChange: (next: ModuleVisibility) => Promise<void>;
}) {
  const { t } = useTranslation();
  const labelId = useId();
  const current = asVisibility(visibility);
  const [busy, setBusy] = useState<ModuleVisibility | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = async (next: ModuleVisibility) => {
    if (busy || next === current) return;
    setBusy(next);
    setError(null);
    try {
      await onChange(next);
    } catch {
      setError(t("admin.saveFailed"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card variant="outline" padding="md" className={styles.card}>
      <div className={styles.head}>
        <Text as="h3" variant="label" color="muted" className={styles.legend} id={labelId}>
          {t("admin.catalog.visibility")}
        </Text>
        {ownerName && (
          <Text as="span" variant="body-s" color="muted" truncate>
            {t("admin.catalog.owner", { name: ownerName })}
          </Text>
        )}
      </div>

      <div className={styles.options} role="radiogroup" aria-labelledby={labelId}>
        {VISIBILITIES.map((v) => {
          const option = visibilityOption(v, t);
          const on = v === current;
          return (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={busy !== null}
              className={cx(styles.option, on && styles.optionOn)}
              onClick={() => void pick(v)}
            >
              <span className={styles.optionLabel}>{option.label}</span>
              <span className={styles.optionHint}>{option.hint}</span>
            </button>
          );
        })}
      </div>

      {error && (
        <Text as="p" variant="body-s" color="danger" role="alert">
          {error}
        </Text>
      )}
    </Card>
  );
}

/**
 * The Modullar tab with nothing in it — which, on a fresh install, is the state every
 * admin starts in: no starter content is seeded, so the official catalog is built
 * here from zero. The card says what an official module IS (the thing every student
 * sees, group or not) and puts the create button where the eye already is, rather
 * than leaving "no modules yet" and a small "+" in the header to explain themselves.
 */
export function AdminCatalogEmpty({ onCreate }: { onCreate: () => void }) {
  const { t } = useTranslation();
  return (
    <Card variant="outline" padding="lg" className={styles.empty}>
      <Text as="h3" variant="title-s">
        {t("admin.catalog.emptyTitle")}
      </Text>
      <Text as="p" variant="body" color="ink-soft">
        {t("admin.catalog.emptyBody")}
      </Text>
      <ol className={styles.steps}>
        <li>
          <Text as="span" variant="body-s" color="muted">
            {t("admin.catalog.emptyStep1")}
          </Text>
        </li>
        <li>
          <Text as="span" variant="body-s" color="muted">
            {t("admin.catalog.emptyStep2")}
          </Text>
        </li>
        <li>
          <Text as="span" variant="body-s" color="muted">
            {t("admin.catalog.emptyStep3")}
          </Text>
        </li>
      </ol>
      <Button variant="primary" onClick={onCreate} className={styles.emptyCta}>
        {t("admin.catalog.createFirst")}
      </Button>
    </Card>
  );
}
