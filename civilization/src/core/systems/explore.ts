// Automatic exploring: head for the nearest reachable tile that borders unexplored land,
// preferring ruins. Used by the AI's scouts and by the player's "Explore" order.
import { distance, neighbors, within } from '../hex';
import { dims, tileAt } from '../query';
import type { GameState, Unit } from '../state';
import { canEnter, findPath, followPath } from './movement';

export function autoExplore(s: GameState, u: Unit): boolean {
  const pl = s.players[u.owner];
  const m = dims(s);
  const candidates: { i: number; v: number }[] = [];
  for (const i of within(m, u.tile, 12)) {
    if (i === u.tile || !pl.explored[i]) continue;
    const t = tileAt(s, i);
    const unexplored = neighbors(m, i).filter((n) => !pl.explored[n]).length;
    if (!unexplored && !t.ruin) continue;
    if (!canEnter(s, u, i, true)) continue;
    const d = distance(m, u.tile, i);
    candidates.push({ i, v: unexplored * 2 + (t.ruin ? 25 : 0) + (t.hills ? 2 : 0) - d * 1.5 });
  }
  candidates.sort((a, b) => b.v - a.v || a.i - b.i);
  for (const c of candidates.slice(0, 6)) {
    const path = findPath(s, u, c.i, 2500);
    if (!path) continue;
    u.path = path.path;
    followPath(s, u);
    return true;
  }
  u.exploring = false;
  return false;
}
