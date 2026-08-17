/**
 * ConversationHubPage (`/chat`) — the AI Suhbat landing, reached from the
 * bottom-bar centre FAB. The scenario grid + the "Erkin mavzu" free-topic card.
 *
 * Since docs/08 Faza 6.5 the grid is SERVER data (`/api/roleplay/scenarios`), so
 * a scenario can be edited or added without a frontend release. The bundled
 * `SCENARIOS` remain as the first paint and as the offline fallback: a hub that
 * flashes empty on every visit is worse than one that shows the four scenarios
 * that have been there all along.
 *
 * The catalogue also carries WHY speaking may not be possible — the flag is off,
 * no AI key is wired, the daily budget is spent — and the page turns that into
 * one plain line under the intro. Saying it here means a student finds out before
 * they have recorded themselves, not after.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  ConversationHubScreen,
  fetchRoleplayCatalog,
  roleplayNoteKey,
  toScenario,
} from "../../screens/conversation";
import type { RoleplayState, Scenario } from "../../screens/conversation";
import { useNavHandler } from "../nav";

export default function ConversationHubPage() {
  const navigate = useNavigate();
  const onNavigate = useNavHandler();
  const { t } = useTranslation();

  const [scenarios, setScenarios] = useState<Scenario[] | undefined>(undefined);
  const [state, setState] = useState<RoleplayState | undefined>(undefined);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchRoleplayCatalog(ctrl.signal)
      .then((catalog) => {
        setState(catalog.state);
        // An empty list is never rendered as an empty grid: the feature being off
        // means the server sends no scenarios, and the note already explains that.
        // Blanking the page on top of the note would just look broken.
        if (catalog.scenarios.length > 0) setScenarios(catalog.scenarios.map(toScenario));
      })
      .catch(() => {
        /* Keep the bundled grid and stay quiet. A failed catalogue fetch is not
           something to blame the student for; the tiles still open, and the chat
           screen surfaces whatever is really wrong when they try to speak. */
      });
    return () => ctrl.abort();
  }, []);

  const noteKey = roleplayNoteKey(state);

  return (
    <ConversationHubScreen
      scenarios={scenarios}
      note={noteKey ? t(noteKey) : undefined}
      onOpenScenario={(id) => navigate(`/chat/${id}`)}
      onOpenFree={() => navigate("/chat/free")}
      activeNavKey="chat"
      onNavigate={onNavigate}
    />
  );
}
