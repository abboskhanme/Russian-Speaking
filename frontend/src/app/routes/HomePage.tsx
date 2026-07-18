/**
 * HomePage (`/`) — wires the presentational HomeScreen to the router + mock
 * fixture. Lazy-loaded (see app/router). Nav is real: `onNavigate` routes and
 * `activeNavKey="home"` lights the Bosh tab.
 */
import {
  HomeScreen,
  mockContinue,
  mockDailyGoal,
  mockModules,
  mockStreak,
  mockUser,
} from "../../screens/home";
import { useNavHandler } from "../nav";

export default function HomePage() {
  const onNavigate = useNavHandler();
  return (
    <HomeScreen
      user={mockUser}
      dailyGoal={mockDailyGoal}
      streak={mockStreak}
      continueTarget={mockContinue}
      modules={mockModules}
      activeNavKey="home"
      onNavigate={onNavigate}
    />
  );
}
