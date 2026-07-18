/**
 * ProgressPage (`/progress`) — wires the presentational ProgressScreen to the
 * router + mock fixture. Lazy-loaded. `activeNavKey="progress"`.
 */
import {
  ProgressScreen,
  mockAchievements,
  mockBandTrend,
  mockLevel,
  mockProgressStreak,
} from "../../screens/progress";
import { useNavHandler } from "../nav";

export default function ProgressPage() {
  const onNavigate = useNavHandler();
  return (
    <ProgressScreen
      bandTrend={mockBandTrend}
      level={mockLevel}
      streak={mockProgressStreak}
      achievements={mockAchievements}
      activeNavKey="progress"
      onNavigate={onNavigate}
    />
  );
}
