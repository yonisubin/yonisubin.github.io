import { useEffect, useState, type CSSProperties } from "react";
import type { Stage } from "../api";
import { t } from "../i18n";
import { Tr, useLang } from "./ui";

/** The stage track: the bill's position on the legislative path, and the site's signature
 *  element. Markers are numbered because the stages really are a sequence. Bronze when the
 *  bill became law. Terminal stages (stopped, merged...) leave the path, so the track stays
 *  unfilled and the stage name above it says what happened. */
export function Journey({ stages, current, privateBill, compact = false }: {
  stages: Stage[]; current: Stage | null; privateBill: boolean; compact?: boolean;
}) {
  const lang = useLang();
  // the one orchestrated motion: fill the track up to the current stage after load
  const [animate, setAnimate] = useState(false);
  useEffect(() => { const id = requestAnimationFrame(() => setAnimate(true)); return () => cancelAnimationFrame(id); }, []);
  // Government and committee bills start at the first reading: no preliminary reading.
  const path = stages.filter((s) => s.order < 90 && s.key !== "continuity" &&
    (privateBill || s.order >= 6));
  const passed = current?.key === "passed";
  return (
    <ol className={`journey${compact ? " compact" : ""}${passed ? " is-passed" : ""}${animate ? " animate" : ""}`}
        aria-label={t(lang, "journey")}>
      {path.map((s, i) => {
        const state = !current || current.order >= 90 ? "todo"
          : s.order < current.order ? "done" : s.order === current.order ? "current" : "todo";
        return (
          <li key={s.key} className={`step step-${state}`} style={{ "--i": i } as CSSProperties}
              aria-current={state === "current" ? "step" : undefined}>
            <span className="step-label"><Tr value={s.name} /></span>
          </li>
        );
      })}
    </ol>
  );
}
