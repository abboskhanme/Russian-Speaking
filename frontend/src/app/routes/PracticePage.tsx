/**
 * PracticePage (`/practice`) — wires the presentational PracticeScreen to the
 * router + mock fixture. The screen runs its own phase machine (uncontrolled);
 * this page only supplies graded feedback a beat after submit, mirroring the
 * screen's standalone demo but with real nav wiring. Lazy-loaded.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  PracticeScreen,
  mockFeedback,
  mockProgress,
  mockTask,
} from "../../screens/practice";
import type { PracticeFeedback } from "../../screens/practice";
import { useNavHandler } from "../nav";

export default function PracticePage() {
  const onNavigate = useNavHandler();
  const [feedback, setFeedback] = useState<PracticeFeedback | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const handleSubmit = useCallback((_audio: Blob) => {
    setFeedback(null);
    timer.current = window.setTimeout(() => setFeedback(mockFeedback), 2200);
  }, []);

  const reset = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    setFeedback(null);
  }, []);

  return (
    <PracticeScreen
      task={mockTask}
      progress={mockProgress}
      feedback={feedback}
      attemptsLeft={3}
      onSubmit={handleSubmit}
      onRetry={reset}
      onNext={reset}
      onSkip={reset}
      activeNavKey="practice"
      onNavigate={onNavigate}
    />
  );
}
