// The wiring graph: level wires from "entity.output" to "entity.input". Several wires into one
// input are AND-ed (the input is on only while every source is on); anything else goes through a
// `gate` entity. When an output changes, every input it feeds is re-evaluated and pushed into the
// receiving element with setInput() (only when the AND-ed value actually changes).
import type { Element } from '../elements/element';
import type { Wire } from '../levels/level';

interface Source {
  id: string;
  output: string;
}

interface Target {
  id: string;
  input: string;
  sources: Source[];
  value: boolean | null;
}

function split(s: string): [string, string] {
  const i = s.lastIndexOf('.');
  return i < 0 ? [s, ''] : [s.slice(0, i), s.slice(i + 1)];
}

export class Wiring {
  private readonly targets = new Map<string, Target>();
  /** Source element id → the targets it feeds. */
  private readonly bySource = new Map<string, Target[]>();
  private depth = 0;

  constructor(
    private readonly elements: Map<string, Element>,
    wires: readonly Wire[],
  ) {
    for (const w of wires) {
      const [sid, out] = split(w.from);
      const [tid, inp] = split(w.to);
      if (!elements.has(sid) || !elements.has(tid)) continue;
      const key = `${tid}.${inp}`;
      let t = this.targets.get(key);
      if (!t) this.targets.set(key, (t = { id: tid, input: inp, sources: [], value: null }));
      t.sources.push({ id: sid, output: out });
      let list = this.bySource.get(sid);
      if (!list) this.bySource.set(sid, (list = []));
      if (!list.includes(t)) list.push(t);
      const target = elements.get(tid) as Element & { wired?: Set<string> };
      target.wired?.add(inp);
    }
  }

  private valueOf(t: Target): boolean {
    return t.sources.every((s) => !!this.elements.get(s.id)?.outputs[s.output]);
  }

  /** Push every wired input once (chamber start). */
  init(): void {
    for (const t of this.targets.values()) this.push(t, true);
  }

  /** Recompute the remembered values without calling setInput (after restoring saved element state). */
  sync(): void {
    for (const t of this.targets.values()) t.value = this.valueOf(t);
  }

  /** An element's outputs changed. */
  changed(el: Element): void {
    // Feedback loops (a gate wired to itself...) stop after a bounded cascade.
    if (this.depth > 32) return;
    this.depth++;
    for (const t of this.bySource.get(el.id) ?? []) this.push(t, false);
    this.depth--;
  }

  private push(t: Target, force: boolean): void {
    const v = this.valueOf(t);
    if (!force && v === t.value) return;
    t.value = v;
    this.elements.get(t.id)?.setInput(t.input, v);
  }

  /** The current value of "entity.input" (tests, debug). */
  inputValue(target: string): boolean | null {
    return this.targets.get(target)?.value ?? null;
  }
}
