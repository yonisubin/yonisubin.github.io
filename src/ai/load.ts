import { Policy } from './policy';

// The trained driving policy ships as a small binary asset (rl/train/export.py writes it;
// copy rl/policies/<name>.bin to public/assets/ai/driver.bin). Loaded once and shared by NPC
// traffic and the autopilot.

let pending: Promise<Policy | null> | null = null;

/** The driving policy, or null if it couldn't be loaded (callers fall back to rule-based driving). */
export function loadDriverPolicy(): Promise<Policy | null> {
  pending ??= fetch(`${import.meta.env.BASE_URL}assets/ai/driver.bin`)
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.arrayBuffer();
    })
    .then((buf) => Policy.fromBinary(buf))
    .catch((e) => {
      console.warn('AI driver policy unavailable, using rule-based driving:', e);
      return null;
    });
  return pending;
}
