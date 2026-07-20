/**
 * RegisterStepper — the 3-segment progress header for the register flow
 * (mockup frames A4/A5/A6): Hisob → Aloqa → Manzil. Completed steps are green
 * with a leading ✓, the active step is orange (primary), upcoming steps muted.
 * Purely presentational; the current step drives every segment's state.
 */
import { useTranslation } from "react-i18next";
import styles from "./Auth.module.css";

export type RegisterStep = "hisob" | "aloqa" | "manzil";

const ORDER: readonly RegisterStep[] = ["hisob", "aloqa", "manzil"];

type State = "done" | "active" | "todo";

function stateOf(step: RegisterStep, current: RegisterStep): State {
  const i = ORDER.indexOf(step);
  const c = ORDER.indexOf(current);
  if (i < c) return "done";
  if (i === c) return "active";
  return "todo";
}

export function RegisterStepper({ current }: { current: RegisterStep }) {
  const { t } = useTranslation();
  return (
    <div className={styles.stepper} aria-hidden>
      <div className={styles.stepBars}>
        {ORDER.map((step) => (
          <div key={step} className={styles.stepBar} data-state={stateOf(step, current)} />
        ))}
      </div>
      <div className={styles.stepLabels}>
        {ORDER.map((step) => {
          const state = stateOf(step, current);
          return (
            <span key={step} className={styles.stepLabel} data-state={state}>
              {state === "done" ? "✓ " : ""}
              {t(`auth.steps.${step}`)}
            </span>
          );
        })}
      </div>
    </div>
  );
}
