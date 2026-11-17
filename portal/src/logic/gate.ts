// Logic gate entity: props.op = 'and' | 'or' | 'not' | 'timer'.
//   inputs  in, in1, in2, in3, in4 (only wired ones count; several wires into one input are already
//           AND-ed by the wiring)
//   output  out
//   and     every wired input on          or     any wired input on
//   not     input `in` (or in1) off        timer  on while the input is on and for props.seconds after
//           it goes off (a pulse stretcher: a quick button tap holds a door open for a while)
// Invisible: wiring is drawn by indicator strips, not by gates.
import { CONFIG } from '../core/config';
import type { ChamberContext } from '../game/context';
import type { Entity } from '../levels/level';
import { BaseElement } from '../elements/base';

const INPUTS = ['in', 'in1', 'in2', 'in3', 'in4'] as const;

export class Gate extends BaseElement {
  readonly inputs = INPUTS;
  private hold = 0;

  constructor(ctx: ChamberContext, entity: Entity) {
    super(ctx, entity);
    this.outputs.out = false;
  }

  private op(): string {
    return this.prop('op', 'and');
  }

  private values(): boolean[] {
    return INPUTS.filter((i) => this.wired.has(i)).map((i) => !!this.inputValues[i]);
  }

  /** The combinational result (timer: the raw input). */
  private evaluate(): boolean {
    const v = this.values();
    switch (this.op()) {
      case 'or':
        return v.some(Boolean);
      case 'not':
        return !(v.length > 0 && v.every(Boolean));
      case 'timer':
        return v.length > 0 && v.every(Boolean);
      default:
        return v.length > 0 && v.every(Boolean);
    }
  }

  protected onInput(): void {
    const v = this.evaluate();
    if (this.op() === 'timer') {
      if (v) this.hold = this.prop('seconds', CONFIG.elements.gateSeconds);
      this.setOutput('out', v || this.hold > 0);
    } else this.setOutput('out', v);
  }

  update(dt: number): void {
    if (this.op() !== 'timer') {
      // Unwired NOT gates are on from the start.
      if (this.outputs.out !== this.evaluate()) this.setOutput('out', this.evaluate());
      return;
    }
    if (this.evaluate()) {
      this.hold = this.prop('seconds', CONFIG.elements.gateSeconds);
      return;
    }
    if (this.hold > 0) {
      this.hold = Math.max(0, this.hold - dt);
      if (this.hold === 0) this.setOutput('out', false);
    }
  }

  snapshot(): unknown {
    return { ...(super.snapshot() as object), hold: this.hold };
  }

  restore(state: unknown): void {
    super.restore(state);
    this.hold = (state as { hold: number }).hold;
  }
}
