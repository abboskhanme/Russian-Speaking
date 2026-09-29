import { useTranslation } from "react-i18next";
import { Badge, Button, Card, Spinner, Text } from "../../shared/ui";
import { formatPhone } from "./formatPhone";
import styles from "./AdminPeopleScreen.module.css";

/** One admin account, as `GET /api/admin/admins` describes it. */
export interface AdminAccount {
  id: string;
  fullName: string;
  phone: string | null;
  /** The caller's own row: labelled "Siz" and offered no role change — the server
   * refuses `cannot_change_own_role`, so the control would only ever fail. */
  isSelf: boolean;
}

/**
 * **Adminlar** — who holds the keys to the platform.
 *
 * Read-mostly on purpose. The only write is "demote to teacher", because the other
 * direction (make someone an admin) starts from a TEACHER's manage sheet: promotion
 * is a decision about a person already trusted with a class, not a search box that
 * can reach any student. The hint above the list says where it lives.
 *
 * The last-admin rule is the server's (`409 last_admin`) and is reported by the
 * confirm dialog; the list does not try to predict it, since it cannot see a second
 * admin being demoted in another tab.
 */
export function AdminAccountsList({
  admins,
  failed,
  onRetry,
  onDemote,
}: {
  /** Null while loading. */
  admins: AdminAccount[] | null;
  failed?: boolean;
  onRetry?: () => void;
  /** Opens the confirm for "admin → teacher". Omit and the rows are read-only. */
  onDemote?: (admin: AdminAccount) => void;
}) {
  const { t } = useTranslation();

  if (failed) {
    return (
      <Card variant="flat" padding="lg" className={styles.empty}>
        <Text as="p" variant="body" color="muted">
          {t("admin.adminsLoadFailed")}
        </Text>
        {onRetry && (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            {t("common.retry")}
          </Button>
        )}
      </Card>
    );
  }

  if (admins === null) {
    return (
      <div className={styles.empty}>
        <Spinner label={t("common.loading")} />
      </div>
    );
  }

  return (
    <>
      <Text as="p" variant="body-s" color="muted">
        {t("admin.adminsHint")}
      </Text>
      {admins.length === 0 ? (
        <Card variant="flat" padding="lg" className={styles.empty}>
          <Text as="p" variant="body" color="muted">
            {t("admin.noPeople")}
          </Text>
        </Card>
      ) : (
        <ul className={styles.list}>
          {admins.map((a) => (
            <li key={a.id}>
              <Card variant="outline" padding="md" className={styles.row}>
                <span className={styles.rowBody}>
                  <span className={styles.nameLine}>
                    <Text as="span" variant="body" weight="bold" truncate>
                      {a.fullName}
                    </Text>
                    {a.isSelf && (
                      <Badge variant="primary" size="sm">
                        {t("admin.you")}
                      </Badge>
                    )}
                  </span>
                  <Text as="span" variant="body-s" color="muted" className={styles.mono} truncate>
                    {a.phone ? formatPhone(a.phone) : t("admin.noPhone")}
                  </Text>
                </span>
                {!a.isSelf && onDemote && (
                  <span className={styles.rowActions}>
                    <Button variant="ghost" size="sm" onClick={() => onDemote(a)}>
                      {t("admin.role.demote")}
                    </Button>
                  </span>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
