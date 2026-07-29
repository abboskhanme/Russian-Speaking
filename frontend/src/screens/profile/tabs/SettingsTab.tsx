import { useId, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Button, Card, Modal, Switch, Text, cx } from "../../../shared/ui";
import styles from "./SettingsTab.module.css";

/* -------------------------------------------------------------------------- */
/* Public contract                                                            */
/* -------------------------------------------------------------------------- */

/** The three UI languages offered (docs/04 §4.7 — onboarding step 1). */
export type SettingsLanguage = "uz" | "ru" | "en";
export type SettingsTheme = "light" | "dark";

export interface SettingsTabProps {
  language: SettingsLanguage;
  theme: SettingsTheme;
  notifications: boolean;
  /** Hides the whole PRO upsell card when true — a subscriber is never upsold. */
  isPremium: boolean;
  /** From GET /api/settings/links — powers the help modal. Null while unloaded. */
  links: { tgSupportUrl: string; tgChannelUrl: string } | null;
  onChangeLanguage?: (language: SettingsLanguage) => void;
  onChangeTheme?: (theme: SettingsTheme) => void;
  onChangeNotifications?: (on: boolean) => void;
  onUpgrade?: () => void;
  onLogout?: () => void;
}

/** Which sheet is open. Only one at a time. */
type Sheet = "language" | "theme" | "help" | "privacy" | null;

/* -------------------------------------------------------------------------- */
/* Tab                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * SettingsTab — the "Sozlamalar" tab body of the Profil place.
 *
 * Presentational and prop-driven: it fetches nothing and owns no server state.
 * The only local state is which sheet is open. Layout: one grouped card of rows
 * (til · mavzu · bildirishnomalar) → the PRO card (free plan only) → a second
 * grouped card (yordam · maxfiylik · chiqish). Every colour / space / radius /
 * motion value is a token; the root spans full width with no centring wrapper.
 */
export function SettingsTab({
  language,
  theme,
  notifications,
  isPremium,
  links,
  onChangeLanguage,
  onChangeTheme,
  onChangeNotifications,
  onUpgrade,
  onLogout,
}: SettingsTabProps) {
  const { t } = useTranslation();
  const [sheet, setSheet] = useState<Sheet>(null);
  const notificationsLabelId = useId();

  const close = () => setSheet(null);

  // Endonyms — each language named in itself, never translated. A picker that
  // localised these would label the Uzbek option "Русский" while the UI is in
  // Russian, which is exactly the row a user cannot act on. Literals, as in
  // ProfileScreen's original LANGUAGES table.
  const languageOptions: Array<Option<SettingsLanguage>> = [
    { value: "uz", label: "O'zbekcha" },
    { value: "ru", label: "Русский" },
    { value: "en", label: "English" },
  ];

  const themeOptions: Array<Option<SettingsTheme>> = [
    { value: "light", label: t("profile.settingsRows.themeLight") },
    { value: "dark", label: t("profile.settingsRows.themeDark") },
  ];

  const languageLabel =
    languageOptions.find((option) => option.value === language)?.label ?? "";
  const themeLabel =
    themeOptions.find((option) => option.value === theme)?.label ?? "";

  return (
    <div className={styles.tab}>
      <Card variant="flat" padding="none" className={styles.group}>
        <ul className={styles.groupList}>
          <li className={styles.groupItem}>
            <SettingRow
              tone="primary"
              icon={<GlobeGlyph />}
              label={t("profile.settingsRows.language")}
              value={languageLabel}
              opensDialog
              onClick={() => setSheet("language")}
            />
          </li>
          <li className={styles.groupItem}>
            <SettingRow
              tone="accent"
              icon={<ContrastGlyph />}
              label={t("profile.settingsRows.theme")}
              value={themeLabel}
              opensDialog
              onClick={() => setSheet("theme")}
            />
          </li>
          <li className={styles.groupItem}>
            <SettingRow
              tone="info"
              icon={<BellGlyph />}
              label={t("profile.notifications")}
              labelId={notificationsLabelId}
              control={
                <Switch
                  checked={notifications}
                  onChange={(next) => onChangeNotifications?.(next)}
                  aria-labelledby={notificationsLabelId}
                />
              }
            />
          </li>
        </ul>
      </Card>

      {!isPremium && <ProCard onUpgrade={onUpgrade} />}

      <Card variant="flat" padding="none" className={styles.group}>
        <ul className={styles.groupList}>
          <li className={styles.groupItem}>
            <SettingRow
              tone="info"
              icon={<LifebuoyGlyph />}
              label={t("profile.help.row")}
              opensDialog
              onClick={() => setSheet("help")}
            />
          </li>
          <li className={styles.groupItem}>
            <SettingRow
              tone="accent"
              icon={<ShieldGlyph />}
              label={t("profile.privacy.row")}
              opensDialog
              onClick={() => setSheet("privacy")}
            />
          </li>
          <li className={styles.groupItem}>
            {/* No confirmation by design — signing out is trivially reversible. */}
            <SettingRow
              tone="danger"
              icon={<LogoutGlyph />}
              label={t("profile.logout")}
              danger
              onClick={onLogout}
            />
          </li>
        </ul>
      </Card>

      <OptionSheet
        open={sheet === "language"}
        onClose={close}
        title={t("profile.settingsRows.language")}
        closeLabel={t("common.close")}
        options={languageOptions}
        selected={language}
        onPick={(next) => {
          onChangeLanguage?.(next);
          close();
        }}
      />

      <OptionSheet
        open={sheet === "theme"}
        onClose={close}
        title={t("profile.settingsRows.theme")}
        closeLabel={t("common.close")}
        options={themeOptions}
        selected={theme}
        onPick={(next) => {
          onChangeTheme?.(next);
          close();
        }}
      />

      <HelpSheet open={sheet === "help"} onClose={close} links={links} />

      <PrivacySheet open={sheet === "privacy"} onClose={close} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Setting row                                                                */
/* -------------------------------------------------------------------------- */

type RowTone = "primary" | "accent" | "info" | "danger";

const ROW_TONE: Record<RowTone, string> = {
  primary: styles.rowIconPrimary,
  accent: styles.rowIconAccent,
  info: styles.rowIconInfo,
  danger: styles.rowIconDanger,
};

interface SettingRowProps {
  tone: RowTone;
  icon: ReactNode;
  label: string;
  /** Id put on the label — lets a trailing control borrow it as its name. */
  labelId?: string;
  /** Current value caption, shown before the chevron. */
  value?: string;
  /** Paints the label red (the destructive action). */
  danger?: boolean;
  /** Marks the row as opening a dialog rather than navigating. */
  opensDialog?: boolean;
  onClick?: () => void;
  /** A trailing control (Switch) — the row is then static, never a button. */
  control?: ReactNode;
}

function SettingRow({
  tone,
  icon,
  label,
  labelId,
  value,
  danger = false,
  opensDialog = false,
  onClick,
  control,
}: SettingRowProps) {
  const inner = (
    <>
      <span className={cx(styles.rowIcon, ROW_TONE[tone])} aria-hidden>
        {icon}
      </span>

      <Text
        as="span"
        id={labelId}
        variant="title-s"
        color={danger ? "danger" : undefined}
        className={styles.rowLabel}
      >
        {label}
      </Text>

      {control ? (
        <span className={styles.rowControl}>{control}</span>
      ) : (
        <span className={styles.rowValue}>
          {value && (
            <Text as="span" variant="body" color="ink-soft" weight="semibold">
              {value}
            </Text>
          )}
          <ChevronGlyph />
        </span>
      )}
    </>
  );

  // A row that owns a trailing control stays static, so the control is the only
  // tap target — never a button nested inside a button.
  if (control) {
    return <div className={styles.row}>{inner}</div>;
  }

  return (
    <button
      type="button"
      className={styles.row}
      onClick={onClick}
      aria-haspopup={opensDialog ? "dialog" : undefined}
    >
      {inner}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* PRO upsell                                                                 */
/* -------------------------------------------------------------------------- */

function ProCard({ onUpgrade }: { onUpgrade?: () => void }) {
  const { t } = useTranslation();
  return (
    <Card variant="flat" padding="lg" className={styles.proCard}>
      <Badge variant="primary" size="md" className={styles.proBadge}>
        {t("profile.pro.badge")}
      </Badge>

      <Text as="h3" variant="title-m">
        {t("profile.pro.title")}
      </Text>

      <Text as="p" variant="body" color="ink-soft">
        {t("profile.pro.body")}
      </Text>

      <Button variant="primary" fullWidth onClick={onUpgrade}>
        {t("profile.pro.cta")}
      </Button>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Option sheet (language / theme)                                            */
/* -------------------------------------------------------------------------- */

interface Option<T extends string> {
  value: T;
  label: string;
}

interface OptionSheetProps<T extends string> {
  open: boolean;
  onClose: () => void;
  title: string;
  closeLabel: string;
  options: Array<Option<T>>;
  selected: T;
  onPick: (value: T) => void;
}

/**
 * A single-select sheet. Selection is announced through `aria-checked` on each
 * `role="radio"` option and drawn with a check mark, so it never rests on
 * colour alone.
 */
function OptionSheet<T extends string>({
  open,
  onClose,
  title,
  closeLabel,
  options,
  selected,
  onPick,
}: OptionSheetProps<T>) {
  return (
    <Modal open={open} onClose={onClose} title={title} closeLabel={closeLabel}>
      <div className={styles.options} role="radiogroup" aria-label={title}>
        {options.map((option) => {
          const isSelected = option.value === selected;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={isSelected}
              className={cx(styles.option, isSelected && styles.optionSelected)}
              onClick={() => onPick(option.value)}
            >
              <Text as="span" variant="title-s" className={styles.optionLabel}>
                {option.label}
              </Text>
              {isSelected && (
                <span className={styles.optionCheck} aria-hidden>
                  <CheckGlyph />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Yordam markazi                                                             */
/* -------------------------------------------------------------------------- */

function HelpSheet({
  open,
  onClose,
  links,
}: {
  open: boolean;
  onClose: () => void;
  links: { tgSupportUrl: string; tgChannelUrl: string } | null;
}) {
  const { t } = useTranslation();

  /**
   * An href only if it is a real, navigable http(s) URL. These values come from
   * admin settings rather than from code, so the scheme is checked here: a
   * `javascript:` value reaching an anchor would execute on click.
   */
  function safeHref(url: string | undefined): string | undefined {
    const trimmed = url?.trim();
    if (!trimmed) return undefined;
    try {
      const { protocol } = new URL(trimmed);
      return protocol === "http:" || protocol === "https:" ? trimmed : undefined;
    } catch {
      // Not an absolute URL — nothing safe to navigate to.
      return undefined;
    }
  }

  // Rows render inert unless the URL is loaded AND usable, so an unconfigured
  // deployment shows a disabled row instead of a dead `href=""` that silently
  // reloads the page. `/api/settings/links` returns "" (not null) when unset.
  const rows = [
    { key: "group", label: t("profile.help.telegramGroup"), href: safeHref(links?.tgChannelUrl) },
    { key: "admin", label: t("profile.help.telegramAdmin"), href: safeHref(links?.tgSupportUrl) },
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("profile.help.modalTitle")}
      closeLabel={t("common.close")}
    >
      <div className={styles.sheetBody}>
        <Text as="p" variant="body" color="ink-soft">
          {t("profile.help.body")}
        </Text>

        <div className={styles.linkList}>
          {rows.map((row) => {
            const content = (
              <>
                <span className={cx(styles.rowIcon, styles.rowIconInfo)} aria-hidden>
                  <TelegramGlyph />
                </span>
                <Text as="span" variant="title-s" className={styles.rowLabel}>
                  {row.label}
                </Text>
                <span className={styles.linkArrow} aria-hidden>
                  <ExternalGlyph />
                </span>
              </>
            );

            return row.href ? (
              <a
                key={row.key}
                className={styles.linkRow}
                href={row.href}
                // rel is mandatory with target=_blank — without it the opened
                // page gets a handle on this one (tabnabbing).
                target="_blank"
                rel="noopener noreferrer"
              >
                {content}
              </a>
            ) : (
              <span
                key={row.key}
                className={cx(styles.linkRow, styles.linkRowDisabled)}
                aria-disabled="true"
              >
                {content}
              </span>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Maxfiylik siyosati                                                         */
/* -------------------------------------------------------------------------- */

function PrivacySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("profile.privacy.modalTitle")}
      closeLabel={t("common.close")}
    >
      <div className={styles.sheetBody}>
        <Text as="p" variant="body" color="ink-soft">
          {t("profile.privacy.body")}
        </Text>

        <Text as="h3" variant="title-s">
          {t("profile.privacy.appInfoTitle")}
        </Text>

        <Text as="p" variant="body" color="ink-soft">
          {t("profile.privacy.appInfoBody")}
        </Text>
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Inline glyphs                                                              */
/* -------------------------------------------------------------------------- */

function GlobeGlyph() {
  return (
    <svg
      className={styles.glyph}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle cx="12" cy="12" r="8.2" stroke="currentColor" strokeWidth="1.9" />
      <path
        d="M3.8 12h16.4M12 3.8c2.2 2.4 3.3 5.1 3.3 8.2s-1.1 5.8-3.3 8.2c-2.2-2.4-3.3-5.1-3.3-8.2S9.8 6.2 12 3.8z"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ContrastGlyph() {
  return (
    <svg
      className={styles.glyph}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle cx="12" cy="12" r="8.2" stroke="currentColor" strokeWidth="1.9" />
      <path d="M12 3.8v16.4a8.2 8.2 0 0 0 0-16.4z" fill="currentColor" />
    </svg>
  );
}

function BellGlyph() {
  return (
    <svg
      className={styles.glyph}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <path
        d="M6 16V10a6 6 0 0 1 12 0v6l1.5 2.5H4.5z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M10 19.5a2 2 0 0 0 4 0"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function LifebuoyGlyph() {
  return (
    <svg
      className={styles.glyph}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle cx="12" cy="12" r="8.2" stroke="currentColor" strokeWidth="1.9" />
      <circle cx="12" cy="12" r="3.4" stroke="currentColor" strokeWidth="1.9" />
      <path
        d="m6.2 6.2 3.4 3.4m4.8 4.8 3.4 3.4m0-11.6-3.4 3.4m-4.8 4.8-3.4 3.4"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ShieldGlyph() {
  return (
    <svg
      className={styles.glyph}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <path
        d="M12 3.5 5 6.2v5.4c0 4 2.8 7.6 7 8.9 4.2-1.3 7-4.9 7-8.9V6.2z"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinejoin="round"
      />
      <path
        d="m9 12 2.2 2.2L15.2 10"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LogoutGlyph() {
  return (
    <svg
      className={styles.glyph}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <path
        d="M15 8V6a1 1 0 0 0-1-1H6a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-2"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10 12h9m0 0-3-3m3 3-3 3"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TelegramGlyph() {
  return (
    <svg
      className={styles.glyph}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <path
        d="M20.5 4.3 3.6 10.8c-.7.3-.7 1.3 0 1.5l4.2 1.3 1.6 4.9c.2.7 1.1.8 1.5.2l2.2-2.8 4.2 3.1c.5.4 1.3.1 1.4-.6l2.5-13.2c.1-.7-.5-1.2-1.2-.9z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="m7.8 13.6 9.9-6.9-6.3 8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronGlyph() {
  return (
    <svg
      className={styles.chevron}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <path
        d="M9 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ExternalGlyph() {
  return (
    <svg
      className={styles.chevron}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <path
        d="M8 16 16 8m0 0H9.5M16 8v6.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 12.5 10 17l9-10"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
