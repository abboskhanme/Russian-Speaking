import { useId, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button, Card, Modal, Text } from "../../../shared/ui";
import { isApiError, type OtpDeliveryInfo } from "../../../shared/api";
import { UZ_REGION_NAMES, districtsFor } from "../../../shared/uz-regions";
/* The auth screens own the two idioms this tab has to match exactly: the
 * phone field (mask + `+998` prefix) and, above all, `OtpStep` — which is not
 * just a code box but the Telegram deep-link AND the `otp/status` poller that
 * surfaces a `mismatch` / `not_own_contact` verdict. A second, home-grown code
 * screen here would silently drop that warning, so we import the real one. */
import { IconInput } from "../../auth/IconInput";
import { OtpStep } from "../../auth/OtpStep";
import { SelectField } from "../../auth/SelectField";
import { PhoneIcon, PinIcon, UserIcon } from "../../auth/icons";
import { formatDisplay, groupNational, isValidUz, nationalDigits, toE164 } from "../../auth/phone";
import styles from "./InfoTab.module.css";

/* -------------------------------------------------------------------------- */
/* Public contract                                                            */
/* -------------------------------------------------------------------------- */

/** The identity fields the "Tahrirlash" dialog can write. Deliberately NOT the
 *  whole row set: Daraja is derived from graded attempts and Ro'yxatdan o'tgan
 *  is an account fact, so neither is editable nor even shown in the form. The
 *  phone is editable but only through its own verified flow, never here. */
export interface EditableInfo {
  /** Already trimmed and guaranteed non-empty by the dialog. */
  fullName: string;
  /**
   * The chosen viloyat, or "" meaning "the user did not touch the address —
   * leave whatever is stored alone". Never a name outside
   * {@link UZ_REGION_NAMES}.
   *
   * `region` and `district` always arrive as a PAIR: either both are set (the
   * user picked an address) or both are "" (they didn't). The dialog will not
   * submit a half-set address, so the two can never drift apart server-side.
   */
  region: string;
  /** The chosen tuman, always one of `districtsFor(region)`. "" exactly when
   *  `region` is "". */
  district: string;
}

export interface InfoTabProps {
  user: {
    /** Display name (e.g. "Aziz Karimov"). */
    name: string;
    /** E.164 phone, or null when the account has none. */
    phone: string | null;
    /** Region ("viloyat"), or null when never set. */
    region: string | null;
    /** District ("tuman") inside {@link region}, or null when never set. */
    district: string | null;
    /** CEFR level (e.g. "A2"), or null with no graded attempts. */
    level: string | null;
    /** Human level caption (e.g. "boshlang'ich"), shown beside `level`. */
    levelLabel: string | null;
    /** Account creation date, ISO-8601. Rendered as a localised year + month. */
    registeredAt: string;
  };
  /** Null when the student is in no group — the whole group block is then
   *  replaced by a quiet "not in a group" empty state. */
  group: {
    /** Group name (e.g. "B1 · Kechki-3"). */
    name: string;
    teacherName: string | null;
    memberCount: number;
  } | null;
  /** Leave the group. Fired only after the confirm dialog is accepted. */
  onLeaveGroup?: () => void;
  /**
   * Persist the edited name + address. Omit it and the "Tahrirlash" control is
   * not rendered at all, so a read-only host keeps a read-only tab.
   *
   * REJECT to report a failure: the dialog stays open, shows the message inline
   * and keeps the user's input, instead of closing as if it had saved.
   */
  onSaveInfo?: (values: EditableInfo) => Promise<void>;
  /**
   * Phone change step 1 — send a code to `phoneE164` (already `+998…`). Resolve
   * with the delivery info the OTP view needs; reject with a 409 when the number
   * belongs to someone else and the dialog says so inline.
   *
   * Both phone callbacks must be supplied for the Telefon row's action to
   * appear — a flow that can start but not finish is worse than none.
   */
  onRequestPhoneChange?: (phoneE164: string) => Promise<OtpDeliveryInfo>;
  /** Phone change step 2 — confirm the code. Rejects with 401 on a bad code. */
  onConfirmPhoneChange?: (code: string) => Promise<void>;
  /**
   * The CEFR "Daraja" row. It is a LEARNER's number, so the teacher panel hides
   * it — a teacher has no band, and the row would read "kiritilmagan" forever.
   * Defaults to shown, so the student screen is unchanged.
   */
  showLevel?: boolean;
  /**
   * Replaces the "GURUH VA O'QITUVCHI" block below the identity rows.
   *
   * A student's connection is the one group they are in and who teaches it; a
   * teacher's is the several groups they OWN. Everything above this block — the
   * identity rows and both editing flows — is genuinely the same on both panels,
   * which is why only this part is swappable rather than the tab being forked.
   * Omit it and the student's group block renders exactly as before.
   */
  relatedBlock?: ReactNode;
}

/* -------------------------------------------------------------------------- */
/* Tab                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * InfoTab — the "Ma'lumot" tab body of the Profile screen: the student's
 * identity rows (name · phone · viloyat · tuman · level · joined) followed by
 * the GURUH VA O'QITUVCHI block.
 *
 * Presentational and prop-driven: it fetches NOTHING. The two editing flows it
 * hosts own only their own form state — every request goes out through a
 * callback the page supplies, and the page is what refreshes identity
 * afterwards. Both dialogs are mounted only while open, so each one opens
 * prefilled from the current user rather than from a stale previous edit.
 *
 * The shell owns loading, the tab list and the tabpanel role; this file renders
 * a plain full-width `<div>` into it. Every colour / space / radius value is a
 * token, so light and dark both work with no extra rules.
 */
export function InfoTab({
  user,
  group,
  onLeaveGroup,
  onSaveInfo,
  onRequestPhoneChange,
  onConfirmPhoneChange,
  showLevel = true,
  relatedBlock,
}: InfoTabProps) {
  const { t } = useTranslation();

  const [editing, setEditing] = useState(false);
  const [changingPhone, setChangingPhone] = useState(false);

  // Every empty value reads the same, so a missing phone and a missing region
  // are never a blank cell (which reads as a layout bug) or a literal "null".
  const notSet = t("profile.info.notSet");

  const level = user.level
    ? [user.level, user.levelLabel].filter(Boolean).join(" · ")
    : notSet;

  const registered = useMemo(() => {
    const m = monthNumber(user.registeredAt);
    if (m === null) return notSet;
    return t("profile.info.registeredValue", {
      year: new Date(user.registeredAt).getFullYear(),
      month: t(`months.${m}`),
    });
  }, [user.registeredAt, notSet, t]);

  const canEdit = onSaveInfo !== undefined;
  const canChangePhone =
    onRequestPhoneChange !== undefined && onConfirmPhoneChange !== undefined;

  return (
    <div className={styles.tab}>
      <div className={styles.infoBlock}>
        {canEdit && (
          <div className={styles.infoActions}>
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              <PencilIcon />
              {t("profile.info.edit")}
            </Button>
          </div>
        )}

        <Card variant="flat" padding="none" className={styles.infoCard}>
          <dl className={styles.rows}>
            <InfoRow label={t("profile.info.fullName")} value={user.name} />
            <InfoRow
              label={t("profile.info.phone")}
              value={user.phone ?? notSet}
              empty={!user.phone}
              /* Its own action, next to the value: changing the phone re-runs
                 the Telegram ownership proof, so it must never look like just
                 another field inside the same form as the name. */
              action={
                canChangePhone && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className={styles.rowAction}
                    onClick={() => setChangingPhone(true)}
                  >
                    {t("profile.phone.change")}
                  </Button>
                )
              }
            />
            <InfoRow
              label={t("profile.info.region")}
              value={user.region ?? notSet}
              empty={!user.region}
            />
            <InfoRow
              label={t("profile.info.district")}
              value={user.district ?? notSet}
              empty={!user.district}
            />
            {showLevel && (
              <InfoRow
                label={t("profile.info.level")}
                value={level}
                empty={!user.level}
              />
            )}
            <InfoRow label={t("profile.info.registered")} value={registered} />
          </dl>
        </Card>
      </div>

      {relatedBlock ?? (
        <section
          className={styles.section}
          aria-label={t("profile.group.sectionLabel")}
        >
          <Text
            as="h2"
            variant="label"
            color="faint"
            className={styles.sectionLabel}
          >
            {t("profile.group.sectionLabel")}
          </Text>

          {group ? (
            <GroupCard group={group} onLeaveGroup={onLeaveGroup} />
          ) : (
            <Card variant="flat" padding="lg" className={styles.groupEmpty}>
              <Text as="p" variant="body" color="muted">
                {t("profile.group.empty")}
              </Text>
            </Card>
          )}
        </section>
      )}

      {editing && onSaveInfo && (
        <EditInfoDialog
          user={user}
          onClose={() => setEditing(false)}
          onSave={onSaveInfo}
        />
      )}

      {changingPhone && onRequestPhoneChange && onConfirmPhoneChange && (
        <ChangePhoneDialog
          onClose={() => setChangingPhone(false)}
          onRequest={onRequestPhoneChange}
          onConfirm={onConfirmPhoneChange}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Label / value row                                                          */
/* -------------------------------------------------------------------------- */

interface InfoRowProps {
  label: string;
  value: string;
  /** The value is a placeholder, not real data — render it muted. */
  empty?: boolean;
  /** Optional control shown after the value (the Telefon row's own action). */
  action?: ReactNode;
}

/** One `<dt>/<dd>` pair. Hairlines come from `.row + .row`, so the last row
 *  never carries a trailing divider. */
function InfoRow({ label, value, empty = false, action }: InfoRowProps) {
  return (
    <div className={styles.row}>
      <dt className={styles.rowLabel}>
        <Text as="span" variant="body" color="muted">
          {label}
        </Text>
      </dt>
      <dd className={styles.rowValue}>
        <Text
          as="span"
          variant="body"
          color={empty ? "faint" : "ink"}
          weight="semibold"
        >
          {value}
        </Text>
        {action}
      </dd>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* "Tahrirlash" — name + viloyat + tuman                                      */
/* -------------------------------------------------------------------------- */

/**
 * The edit dialog. Mounted only while open, so `useState` initialisers are the
 * prefill and there is no stale-value effect to keep in sync.
 *
 * Two invariants it exists to hold:
 *  - the name is never blank (the avatar initials and "Salom, {name}" depend on
 *    it), so whitespace-only is rejected here as well as on the server;
 *  - viloyat and tuman never disagree — picking a region clears the district,
 *    and Save stays disabled until a district from THAT region is chosen.
 */
function EditInfoDialog({
  user,
  onClose,
  onSave,
}: {
  user: InfoTabProps["user"];
  onClose: () => void;
  onSave: (values: EditableInfo) => Promise<void>;
}) {
  const { t } = useTranslation();
  const nameErrorId = useId();

  // Captured once (the dialog is mounted only while open), so it doubles as the
  // "did the user actually touch the address?" baseline below.
  const [initial] = useState(() => normaliseAddress(user.region, user.district));
  const [region, setRegion] = useState(initial.region);
  const [district, setDistrict] = useState(initial.district);
  const [name, setName] = useState(user.name);
  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const districts = districtsFor(region);

  // Someone fixing a typo in their name must not be forced to fill in an
  // address they never asked to edit — but the moment they DO touch it, the
  // pair has to be complete, because writing a viloyat without its tuman is
  // exactly the inconsistency this dialog exists to prevent.
  const addressTouched = region !== initial.region || district !== initial.district;
  const addressComplete = region !== "" && district !== "";
  // An empty name deliberately does NOT disable Save: a disabled submit button
  // also swallows Enter, and the user would be left with a dead form and no
  // explanation. Submitting is what surfaces the inline "Ismingizni kiriting".
  const canSubmit = !addressTouched || addressComplete;

  function changeRegion(next: string) {
    setRegion(next);
    // Never carry a tuman across viloyats — the old one belongs to the old list.
    setDistrict("");
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;

    const fullName = name.trim();
    if (!fullName) {
      setNameError(t("auth.errors.nameRequired"));
      return;
    }
    setNameError(null);
    setError(null);
    setBusy(true);
    try {
      // Untouched → send the pair as "" so the caller writes neither and the
      // stored address (including a legacy one this table can't represent)
      // survives a name-only edit.
      await onSave({
        fullName,
        region: addressTouched ? region : "",
        district: addressTouched ? district : "",
      });
      onClose();
    } catch (err) {
      // Stay open with the input intact — closing would look like a save.
      setError(mapError(err, t));
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t("profile.info.editTitle")}
      closeLabel={t("common.close")}
    >
      <form className={styles.form} onSubmit={submit} noValidate>
        {error && (
          <div className={styles.formError} role="alert">
            {error}
          </div>
        )}

        <IconInput
          label={t("profile.info.fullName")}
          icon={<UserIcon />}
          name="full_name"
          autoComplete="name"
          value={name}
          onChange={(ev) => {
            setName(ev.target.value);
            if (nameError) setNameError(null);
          }}
          placeholder={t("profile.info.namePlaceholder")}
          aria-invalid={nameError ? true : undefined}
          aria-describedby={nameError ? nameErrorId : undefined}
          autoFocus
        />
        {nameError && (
          <p className={styles.fieldError} id={nameErrorId} role="alert">
            {nameError}
          </p>
        )}

        <SelectField
          label={t("auth.address.regionLabel")}
          icon={<PinIcon />}
          value={region}
          onChange={changeRegion}
          placeholder={t("auth.address.regionPlaceholder")}
          options={UZ_REGION_NAMES}
        />

        <SelectField
          label={t("auth.address.districtLabel")}
          value={district}
          onChange={setDistrict}
          placeholder={
            region === ""
              ? t("auth.address.districtPlaceholderEmpty")
              : t("auth.address.districtPlaceholder")
          }
          options={districts}
          disabled={region === ""}
        />

        <div className={styles.dialogActions}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!canSubmit}>
            {t("common.save")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* "O'zgartirish" — the Telegram-verified phone change                        */
/* -------------------------------------------------------------------------- */

/**
 * The phone-change dialog: new number → the SAME OTP view login uses.
 *
 * Step 2 is `OtpStep` verbatim, which is the point. The bot only releases the
 * code to a Telegram account that has shared a contact matching the NEW number,
 * and that verdict arrives out of band — so the step's `otp/status` polling and
 * its burned-code (`mismatch` / `not_own_contact`) warning are load-bearing, not
 * decoration. Nothing here ever puts the number or the code in a URL.
 */
function ChangePhoneDialog({
  onClose,
  onRequest,
  onConfirm,
}: {
  onClose: () => void;
  onRequest: (phoneE164: string) => Promise<OtpDeliveryInfo>;
  onConfirm: (code: string) => Promise<void>;
}) {
  const { t } = useTranslation();

  const [nat, setNat] = useState(""); // 9 national digits, no country code
  const [delivery, setDelivery] = useState<OtpDeliveryInfo | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(): Promise<boolean> {
    setError(null);
    setBusy(true);
    try {
      setDelivery(await onRequest(toE164(nat)));
      setCode("");
      return true;
    } catch (err) {
      setError(mapError(err, t));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submitPhone(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!isValidUz(nat)) {
      setError(t("auth.errors.badPhone"));
      return;
    }
    setInfo(null);
    await send();
  }

  async function resend() {
    if (busy) return;
    setInfo(null);
    if (await send()) setInfo(t("auth.otp.resent"));
  }

  async function submitCode() {
    if (busy) return;
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      await onConfirm(code);
      onClose();
    } catch (err) {
      setError(mapError(err, t));
      setBusy(false);
    }
  }

  /** Back to the number field — the pending code is void either way. */
  function back() {
    setDelivery(null);
    setCode("");
    setError(null);
    setInfo(null);
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t("profile.phone.changeTitle")}
      closeLabel={t("common.close")}
    >
      {delivery ? (
        <OtpStep
          phoneDisplay={formatDisplay(nat)}
          delivery={delivery}
          code={code}
          onCodeChange={setCode}
          onVerify={submitCode}
          onBack={back}
          onResend={resend}
          submitLabel={t("auth.otp.verify")}
          busy={busy}
          error={error}
          info={info}
        />
      ) : (
        <form className={styles.form} onSubmit={submitPhone} noValidate>
          <Text as="p" variant="body-s" color="muted">
            {t("profile.phone.changeNote")}
          </Text>

          {error && (
            <div className={styles.formError} role="alert">
              {error}
            </div>
          )}

          <IconInput
            label={t("profile.phone.newLabel")}
            icon={<PhoneIcon />}
            type="tel"
            name="new_phone"
            inputMode="tel"
            autoComplete="tel"
            mono
            prefix="+998"
            value={groupNational(nat)}
            onChange={(ev) => setNat(nationalDigits(ev.target.value))}
            placeholder="90 123 45 67"
            autoFocus
          />

          <div className={styles.dialogActions}>
            <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={busy}
              disabled={!isValidUz(nat)}
            >
              {t("profile.phone.send")}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Group + teacher                                                            */
/* -------------------------------------------------------------------------- */

function GroupCard({
  group,
  onLeaveGroup,
}: {
  group: NonNullable<InfoTabProps["group"]>;
  onLeaveGroup?: () => void;
}) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);

  const teacher = group.teacherName ?? t("profile.info.notSet");

  const confirm = () => {
    setConfirming(false);
    onLeaveGroup?.();
  };

  return (
    <Card variant="flat" padding="md" className={styles.groupCard}>
      <div className={styles.teacher}>
        <span className={styles.avatar} aria-hidden>
          {initials(group.teacherName ?? "")}
        </span>
        <div className={styles.teacherMeta}>
          <Text as="p" variant="title-s" truncate>
            {teacher}
          </Text>
          <Text as="p" variant="body-s" color="muted">
            {t("profile.group.teacherRole")}
          </Text>
        </div>
      </div>

      <div className={styles.groupStats}>
        <GroupStat value={group.name} label={t("profile.group.groupTile")} />
        <GroupStat
          value={String(group.memberCount)}
          label={t("profile.group.membersTile")}
          numeric
        />
      </div>

      <Button
        variant="ghost"
        fullWidth
        onClick={() => setConfirming(true)}
        className={styles.leaveBtn}
      >
        {t("profile.group.leave")}
      </Button>

      {/* A native confirm() would block the whole page (and freezes the
          automation harness), so the confirmation is a real dialog. */}
      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t("profile.group.leaveConfirmTitle")}
        closeLabel={t("common.close")}
      >
        <Text as="p" variant="body" color="ink-soft">
          {t("profile.group.leaveConfirmBody")}
        </Text>
        <div className={styles.confirmActions}>
          <Button variant="secondary" onClick={() => setConfirming(false)}>
            {t("common.cancel")}
          </Button>
          <Button variant="danger" onClick={confirm}>
            {t("profile.group.leave")}
          </Button>
        </div>
      </Modal>
    </Card>
  );
}

function GroupStat({
  value,
  label,
  numeric = false,
}: {
  value: string;
  label: string;
  numeric?: boolean;
}) {
  return (
    <div className={styles.groupStat}>
      <Text as="p" variant="title-s" truncate numeric={numeric}>
        {value}
      </Text>
      <Text as="p" variant="body-s" color="muted">
        {label}
      </Text>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Local helpers                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The stored address as the cascading selects can represent it.
 *
 * A region we have no district table for (legacy free text, or a name whose
 * spelling has since changed) can't drive the cascade — its Tuman dropdown
 * would be permanently empty and the user would be stuck. Such a value is
 * dropped to "", which the dialog reads as "nothing selected"; the row above
 * still shows the raw stored text, and a name-only save leaves it alone.
 */
function normaliseAddress(
  region: string | null,
  district: string | null,
): { region: string; district: string } {
  if (!region || !UZ_REGION_NAMES.includes(region)) return { region: "", district: "" };
  const known = district !== null && districtsFor(region).includes(district);
  return { region, district: known ? district : "" };
}

/**
 * Turn a rejected callback into one sentence the student can act on.
 *
 * `409` is the one status worth its own wording: it means the number the user
 * just typed belongs to somebody else's account, and no amount of retrying the
 * code will change that — they need a different number.
 */
function mapError(err: unknown, t: (key: string) => string): string {
  if (isApiError(err)) {
    if (err.status === 409) return t("profile.phone.taken");
    if (err.status === 401) return t("auth.errors.badCode");
    if (err.status === 400) return err.detail || t("auth.errors.badPhone");
    if (err.status === 403) return err.detail || t("auth.errors.blocked");
    if (err.status === 0) return t("auth.errors.network");
  }
  return t("auth.errors.generic");
}

/**
 * The 1-based month number for "Ro'yxatdan o'tgan", or null if unparseable.
 *
 * The NAME deliberately does not come from `Intl`: iOS/Safari ships no Uzbek
 * month names and renders the `uz` locale as the raw CLDR fallback, so the row
 * read "2026-yil, M07" instead of "2026-yil, iyul". Names live in the locale
 * files (`months.1`…`months.12`) where they are deterministic on every engine,
 * and `profile.info.registeredValue` owns the per-language ordering — Uzbek puts
 * the year first with its `-yil` suffix, ru/en put the month first.
 */
function monthNumber(iso: string): number | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.getMonth() + 1;
}

/** First letters of up to two name words, uppercased (avatar fallback). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const chars = [parts[0], parts[parts.length - 1]]
    .slice(0, parts.length === 1 ? 1 : 2)
    .map((p) => p.charAt(0).toUpperCase());
  return chars.join("");
}

/** The "Tahrirlash" glyph. Stroked with `currentColor` so it inherits the
 *  button's variant colour in both themes. */
function PencilIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}
