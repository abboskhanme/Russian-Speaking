/**
 * ConversationHubPage (`/chat`) — the AI Suhbat landing, reached from the
 * bottom-bar centre FAB. It is the AI-chat destination's OWN place: the scenario
 * grid + the "Erkin mavzu" free-topic card. Scenarios are static frontend data
 * (`screens/conversation`), so the page fetches nothing — it only wires
 * navigation: a tile opens `/chat/:id`, the free card opens `/chat/free`.
 */
import { useNavigate } from "react-router-dom";
import { ConversationHubScreen } from "../../screens/conversation";
import { useNavHandler } from "../nav";

export default function ConversationHubPage() {
  const navigate = useNavigate();
  const onNavigate = useNavHandler();

  return (
    <ConversationHubScreen
      onOpenScenario={(id) => navigate(`/chat/${id}`)}
      onOpenFree={() => navigate("/chat/free")}
      activeNavKey="chat"
      onNavigate={onNavigate}
    />
  );
}
