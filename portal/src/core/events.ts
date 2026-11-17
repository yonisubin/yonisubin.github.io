// The event bus: the only link between the simulation (game/, elements/, player/, portals/) and the
// shell (ui/, dialogue/, audio/ music, save/, challenges). Part of the CONTRACT: add events here.
import type { PortalId } from './config';

export interface GameEvents {
  /** A chamber finished loading and the player is at its spawn. */
  chamberStart: { chamberId: string };
  /** Player reached the exit elevator (chamber complete). Counters are final. */
  exitReached: { chamberId: string; portals: number; steps: number; time: number };
  /** The elevator ride is over; the shell may now load `next` (or show the end of the campaign). */
  elevatorDone: { chamberId: string; next?: string };
  /** Autosave point (chamber start or checkpoint). */
  autosave: { reason: 'chamberStart' | 'checkpoint' };
  checkpoint: { id: string };
  death: { cause: 'turret' | 'pellet' | 'liquid' | 'crusher' | 'pit' | 'rocket' | 'other' };
  respawn: Record<string, never>;
  damage: { amount: number; health: number };
  portalPlaced: { id: PortalId; ok: boolean };
  teleport: { from: PortalId; to: PortalId; speed: number };
  /** An entity output changed (buttons, catchers...). */
  output: { id: string; output: string; value: boolean };
  pickup: { id: string };
  drop: { id: string };
  /** An object or the player's portals were erased by a grill. */
  fizzled: { what: 'portals' | 'object'; id?: string };
  /** A trigger volume fired. */
  trigger: { name: string };
  /** No input for a while (dialogue nags). */
  idle: { seconds: number };
  /** Player is somewhere the chamber didn't intend (behind panels, outside the test area). */
  outOfBounds: Record<string, never>;
  footstep: { surface: 'panel' | 'metal' | 'glass' | 'other' };
  /** Boss fight beats. */
  boss: { stage: number; event: 'hit' | 'componentDetached' | 'componentDisposed' | 'defeated' };
  /** Use prompt for what the crosshair is on ("E  pick up"), or null to hide it. The HUD shows it. */
  prompt: { text: string | null };
  /** A sound effect the shell may caption (closed captions). */
  sfx: { name: string; caption?: string };
}

export type GameEventName = keyof GameEvents;
type Handler<K extends GameEventName> = (payload: GameEvents[K]) => void;

export class EventBus {
  private handlers = new Map<GameEventName, Set<Handler<GameEventName>>>();

  on<K extends GameEventName>(name: K, fn: Handler<K>): () => void {
    let set = this.handlers.get(name);
    if (!set) this.handlers.set(name, (set = new Set()));
    set.add(fn as Handler<GameEventName>);
    return () => set!.delete(fn as Handler<GameEventName>);
  }

  emit<K extends GameEventName>(name: K, payload: GameEvents[K]): void {
    const set = this.handlers.get(name);
    if (!set) return;
    for (const fn of [...set]) fn(payload);
  }
}
