import type { Stage } from "../api";
import { t } from "../i18n";
import { Tr, useLang } from "./ui";

/** The bill's position on the standard legislative path. Terminal stages (stopped,
 *  merged...) are shown as a badge instead, since they leave the path. */
export function Journey({ stages, current, privateBill }: { stages: Stage[]; current: Stage | null; privateBill: boolean }) {
  const lang = useLang();
  // Government and committee bills start at the first reading: no preliminary reading.
  const path = stages.filter((s) => s.order < 90 && s.key !== "continuity" &&
    (privateBill || s.order >= 6));
  return (
    <ol className="journey" aria-label={t(lang, "journey")}>
      {path.map((s) => {
        const state = !current || current.order >= 90 ? "todo"
          : s.order < current.order ? "done" : s.order === current.order ? "current" : "todo";
        return (
          <li key={s.key} className={`step step-${state}`} aria-current={state === "current" ? "step" : undefined}>
            <Tr value={s.name} />
          </li>
        );
      })}
    </ol>
  );
}
