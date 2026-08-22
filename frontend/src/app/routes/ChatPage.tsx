/**
 * ChatPage (`/chat`) — the "AI Suhbat — tez orada" placeholder (docs/08 §4.8).
 * The real roleplay / free-chat surface arrives in Faza 6.5; until then this is
 * a composed, on-brand holding screen.
 *
 * It also proves the i18n pipeline end-to-end: the `Nav` labels are rendered
 * through `t("nav.<key>")`, the copy through `t("chat.*")`, and the sample
 * caption through i18next's CLDR plural — `t("units.points", { count: 2 })`
 * yields «2 балла» in Russian (the Faza 4.7 DoD). Built only from `shared/ui`
 * + `widgets` + tokens; lazy-loaded like every route.
 */
import { useTranslation } from "react-i18next";
import { Badge, Button, Card, Mascot, Text } from "../../shared/ui";
import {
  AppShell,
  Brand,
  NotificationsBell,
  studentNavItems,
} from "../../widgets";
import { useNavHandler } from "../nav";

export default function ChatPage() {
  const { t } = useTranslation();
  const onNavigate = useNavHandler();

  return (
    <AppShell
      brand={<Brand />}
      nav={{
        items: studentNavItems(t),
        activeKey: "chat",
        onNavigate,
        label: t("nav.landmark"),
      }}
      headerStart={
        <Text as="h1" variant="title-m">
          {t("nav.chat")}
        </Text>
      }
      headerEnd={<NotificationsBell />}
    >
      <div
        style={{
          padding: "24px 30px",
          display: "flex",
          justifyContent: "center",
          width: "100%",
        }}
      >
        <Card
          variant="raised"
          padding="lg"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 16,
            textAlign: "center",
            maxWidth: 520,
          }}
        >
          <Mascot mood="idle" size={96} label="Govo" />
          <Badge variant="accent">{t("chat.comingSoon")}</Badge>
          <Text as="h2" variant="title-l">
            {t("chat.title")}
          </Text>
          <Text as="p" variant="body-l" color="ink-soft">
            {t("chat.body")}
          </Text>
          <Text as="p" variant="body-s" color="muted" numeric>
            {t("units.points", { count: 2 })}
          </Text>
          <Button variant="primary" size="lg" onClick={() => onNavigate("home")}>
            {t("chat.backHome")}
          </Button>
        </Card>
      </div>
    </AppShell>
  );
}
