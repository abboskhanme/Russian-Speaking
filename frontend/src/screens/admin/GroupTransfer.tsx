/**
 * screens/admin/GroupTransfer — "Guruhni o'tkazish": an admin hands a teacher's
 * group to another teacher.
 *
 * The real-world moment is a teacher leaving mid-year. Before this existed the admin
 * had two bad answers — delete the class (roster, join code and unanswered homework
 * gone) or leave it with someone who is gone — and could not even demote the leaver,
 * because `teacher_owns_groups` refuses that while they own a group.
 *
 * Two parts:
 *   • {@link TeacherGroupsSection} — inside the teacher's manage sheet: their groups,
 *     each with an "O'tkazish" button. Loaded when the sheet opens, not with the
 *     list: most visits to the teacher list never open a sheet.
 *   • {@link GroupTransferDialog} — the confirmation. It states what MOVES and what
 *     STAYS before the click, because the one consequence an admin would not guess
 *     is that the old teacher's own modules stay with that teacher (students keep
 *     only the homework from them). The server owns the rules
 *     (`GroupTransferService`); this copy only describes them.
 *
 * The target picker lists ACTIVE teachers other than the current owner, loaded fresh
 * when the dialog opens — the teacher list on screen may be narrowed by a search, and
 * offering a suspended teacher would only buy an `invalid_target_teacher` refusal.
 */
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Button, Card, Modal, Text } from "../../shared/ui";
import { isApiError } from "../../shared/api";
import { adminErrorCode, isNetworkError } from "./adminErrors";
import styles from "./AdminPeopleScreen.module.css";

/** One of a teacher's groups, as the sheet lists it. */
export interface AdminTeacherGroup {
  id: string;
  name: string;
  memberCount: number;
}

/** A teacher a group can be handed to. */
export interface AdminTransferTarget {
  id: string;
  fullName: string;
}

/** What the host wires for the feature. Omit it and the section is not rendered. */
export interface AdminGroupTransferApi {
  /** The teacher's groups (`GET /api/groups?teacher_id=`). */
  loadGroups: (teacherId: string) => Promise<AdminTeacherGroup[]>;
  /** Every ACTIVE teacher — the dialog drops the current owner itself. */
  loadTargets: () => Promise<AdminTransferTarget[]>;
  /** `POST /api/admin/groups/{id}/transfer`. Rejects with the API error, which the
   * dialog turns into a sentence (`same_teacher`, `invalid_target_teacher`, 404). */
  transfer: (groupId: string, toTeacherId: string) => Promise<void>;
}

/** The pending transfer: which group, from whom. A snapshot, because a successful
 * transfer removes the group from the sheet that opened the dialog. */
export interface GroupTransferTarget {
  group: AdminTeacherGroup;
  fromTeacher: AdminTransferTarget;
}

/** The sentence for a refused transfer. Keyed on the machine `code` (and the 404),
 * never on the English `detail`. */
export function groupTransferError(e: unknown, t: TFunction): string {
  switch (adminErrorCode(e)) {
    case "same_teacher":
      return t("admin.groups.errSame");
    case "invalid_target_teacher":
      return t("admin.groups.errTarget");
  }
  if (isApiError(e) && e.status === 404) return t("admin.groups.errNotFound");
  if (isNetworkError(e)) return t("auth.errors.network");
  return t("admin.saveFailed");
}

/**
 * The "Guruhlari" block of a teacher's manage sheet. `reloadKey` lets the host
 * refetch after a transfer moved a group away.
 */
export function TeacherGroupsSection({
  teacherId,
  loadGroups,
  onTransfer,
  reloadKey = 0,
}: {
  teacherId: string;
  loadGroups: AdminGroupTransferApi["loadGroups"];
  onTransfer: (group: AdminTeacherGroup) => void;
  reloadKey?: number;
}) {
  const { t } = useTranslation();
  const [groups, setGroups] = useState<AdminTeacherGroup[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    setGroups(null);
    loadGroups(teacherId)
      .then((g) => alive && setGroups(g))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [teacherId, loadGroups, reloadKey, retry]);

  return (
    <section className={styles.roleZone} aria-label={t("admin.groups.title")}>
      <Text as="h3" variant="label" color="muted" className={styles.legend}>
        {t("admin.groups.title")}
      </Text>
      {failed ? (
        <div className={styles.more}>
          <Text as="p" variant="body-s" color="danger" role="alert">
            {t("admin.groups.loadFailed")}
          </Text>
          <Button variant="secondary" size="sm" onClick={() => setRetry((n) => n + 1)}>
            {t("common.retry")}
          </Button>
        </div>
      ) : groups === null ? (
        <Text as="p" variant="body-s" color="muted">
          {t("admin.groups.loading")}
        </Text>
      ) : groups.length === 0 ? (
        <Text as="p" variant="body-s" color="muted">
          {t("admin.groups.none")}
        </Text>
      ) : (
        <>
          <Text as="p" variant="body-s" color="muted">
            {t("admin.groups.hint")}
          </Text>
          <ul className={styles.list}>
            {groups.map((g) => (
              <li key={g.id} className={styles.row}>
                <span className={styles.rowBody}>
                  <Text as="span" variant="body" weight="semibold" truncate>
                    {g.name}
                  </Text>
                  <Text as="span" variant="body-s" color="muted">
                    {t("admin.groups.members", { count: g.memberCount })}
                  </Text>
                </span>
                <span className={styles.rowActions}>
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-label={t("admin.groups.transferAria", { group: g.name })}
                    onClick={() => onTransfer(g)}
                  >
                    {t("admin.groups.transfer")}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/**
 * The transfer confirmation. A refusal is shown INLINE and the dialog stays open:
 * `invalid_target_teacher` means the list it offered is stale, and the admin's next
 * move is to pick again, not to start over.
 */
export function GroupTransferDialog({
  target,
  loadTargets,
  onConfirm,
  onClose,
  onDone,
}: {
  target: GroupTransferTarget;
  loadTargets: AdminGroupTransferApi["loadTargets"];
  onConfirm: AdminGroupTransferApi["transfer"];
  onClose: () => void;
  /** After a successful transfer — the host says so where the list is. */
  onDone?: (groupName: string, toTeacherName: string) => void;
}) {
  const { t } = useTranslation();
  const selectId = useId();
  const [targets, setTargets] = useState<AdminTransferTarget[] | null>(null);
  const [targetsFailed, setTargetsFailed] = useState(false);
  const [chosen, setChosen] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadTargets()
      .then((all) => alive && setTargets(all.filter((x) => x.id !== target.fromTeacher.id)))
      .catch(() => alive && setTargetsFailed(true));
    return () => {
      alive = false;
    };
  }, [loadTargets, target.fromTeacher.id]);

  const chosenTeacher = targets?.find((x) => x.id === chosen) ?? null;

  const confirm = async () => {
    if (busy || !chosenTeacher) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(target.group.id, chosenTeacher.id);
      onDone?.(target.group.name, chosenTeacher.fullName);
      onClose();
    } catch (e) {
      setError(groupTransferError(e, t));
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={t("admin.groups.dialogTitle")} closeLabel={t("common.close")}>
      <div className={styles.sheet}>
        <Card variant="outline" padding="md">
          <Text as="p" variant="body" weight="semibold">
            {target.group.name}
          </Text>
          <Text as="p" variant="body-s" color="muted">
            {t("admin.groups.members", { count: target.group.memberCount })}
            {" · "}
            {t("admin.groups.currentTeacher", { name: target.fromTeacher.fullName })}
          </Text>
        </Card>

        {targetsFailed ? (
          <Text as="p" variant="body-s" color="danger" role="alert">
            {t("admin.groups.targetsFailed")}
          </Text>
        ) : targets === null ? (
          <Text as="p" variant="body-s" color="muted">
            {t("admin.groups.targetsLoading")}
          </Text>
        ) : targets.length === 0 ? (
          <Text as="p" variant="body-s" color="muted">
            {t("admin.groups.noTargets")}
          </Text>
        ) : (
          <div className={styles.field}>
            <label htmlFor={selectId}>
              <Text as="span" variant="label" color="muted">
                {t("admin.groups.targetLabel")}
              </Text>
            </label>
            <select
              id={selectId}
              className={styles.select}
              value={chosen}
              disabled={busy}
              onChange={(e) => {
                setChosen(e.target.value);
                setError(null);
              }}
            >
              <option value="" disabled>
                {t("admin.groups.targetPlaceholder")}
              </option>
              {targets.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.fullName}
                </option>
              ))}
            </select>
          </div>
        )}

        <Text as="p" variant="body-s">
          {t("admin.groups.moves")}
        </Text>
        <Text as="p" variant="body-s" color="muted">
          {t("admin.groups.stays")}
        </Text>
        <Text as="p" variant="body-s" color="muted">
          {t("admin.groups.notified")}
        </Text>

        {error && (
          <Text as="p" variant="body-s" color="danger" role="alert">
            {error}
          </Text>
        )}

        <div className={styles.sheetActions}>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!chosenTeacher}
            onClick={() => void confirm()}
          >
            {t("admin.groups.confirm")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
