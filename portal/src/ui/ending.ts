// The ending: after the Provost's core is defeated, a styled overlay over the (paused) Senate plays
// the Provost's last lines through the dialogue manager (voiced, subtitled in the overlay), then the
// credits scroll over the credits theme. Finishing (or skipping with Esc / the button) marks the
// story complete and opens the "curriculum complete" screen.
//
// Time comes from update(dt) (the shell's frame loop); tests can call advance(seconds).
import { SHELL } from '../core/shellConfig';
import { planUtterance } from '../dialogue/voice';
import { LINES } from '../dialogue/lines';
import { h } from './dom';

export type EndingPhase = 'lines' | 'credits' | 'done';

/** The Provost's last lines (ids in dialogue/linesB.ts), in order. */
export const ENDING_LINES = ['ending.1', 'ending.2', 'ending.3', 'ending.4', 'ending.5', 'ending.6', 'ending.7'];

/** Credits: [role, name] rows; a row with an empty role is a heading. */
export const CREDITS: [string, string][] = [
  ['', 'TWINFOLD'],
  ['A first-person puzzle about two linked openings', ''],
  ['', 'Cast'],
  ['Applicant 41', 'Ida Fenn (silent, throughout)'],
  ['The Provost', 'itself, at length'],
  ['The Bursar', 'a subroutine, 11,400 credits over budget'],
  ['Alumna 17', 'Marrow (handwriting)'],
  ['The plinth unit', 'filed, with distinction'],
  ['Faculty', 'the sentries of the Senate, tenured'],
  ['', 'Made in code'],
  ['Design, levels, words', 'written for this site'],
  ['Art', 'drawn on canvases and in shaders, no textures were harmed'],
  ['Music and voice', 'synthesised live in the Web Audio API'],
  ['Engine', 'three.js and Rapier'],
  ['', 'The Hollowmere Kinematics Institute'],
  ['Founded', 'to study motion until it confesses'],
  ['Cafeteria', 'open (lunch is after the next practical)'],
  ['The Endowment', 'has not replied'],
  ['', 'Thank you for applying'],
  ['', 'Your transcript has been released to you.'],
];

export class Ending {
  phase: EndingPhase = 'lines';
  /** Seconds since the ending began. */
  t = 0;
  private lineIndex = -1;
  /** Line ids handed to the dialogue manager so far (tests). */
  readonly spoken: string[] = [];
  private lineEnd = 0;
  private creditsT = 0;
  readonly root: HTMLElement;
  private readonly lineEl: HTMLElement;
  private readonly roll: HTMLElement;
  private readonly rollInner: HTMLElement;

  constructor(
    private readonly say: (id: string) => void,
    private readonly onCredits: () => void,
    private readonly onDone: () => void,
  ) {
    this.lineEl = h('p', { class: 'endingLine' });
    this.rollInner = h('div', { class: 'rollInner' }, ...CREDITS.map(([role, name]) => (role ? h('p', {}, h('span', { class: 'role' }, role), h('span', { class: 'name' }, name)) : h('h3', {}, name))));
    this.roll = h('div', { class: 'roll' }, this.rollInner);
    const skip = h('button', { 'data-id': 'skipEnding', type: 'button' }, 'Skip ›');
    skip.addEventListener('click', () => this.skip());
    this.root = h('div', { id: 'ending', 'data-phase': 'lines' }, this.lineEl, this.roll, skip);
    this.roll.style.display = 'none';
    document.body.append(this.root);
  }

  /** Esc / the button: lines → credits → done. */
  skip(): void {
    if (this.phase === 'lines') this.toCredits();
    else if (this.phase === 'credits') this.finish();
  }

  private toCredits(): void {
    this.phase = 'credits';
    this.root.dataset.phase = 'credits';
    this.lineEl.style.display = 'none';
    this.roll.style.display = 'block';
    this.creditsT = 0;
    this.onCredits();
  }

  private finish(): void {
    if (this.phase === 'done') return;
    this.phase = 'done';
    this.root.dataset.phase = 'done';
    this.onDone();
  }

  update(dt: number): void {
    this.t += dt;
    const E = SHELL.ending;
    if (this.phase === 'lines') {
      if (this.t < E.firstLineDelay || this.t < this.lineEnd) return;
      this.lineIndex++;
      const id = ENDING_LINES[this.lineIndex];
      if (!id) {
        if (this.t >= this.lineEnd + E.afterLines) this.toCredits();
        else this.lineIndex--;
        return;
      }
      const text = LINES[id]?.text ?? '';
      this.lineEl.textContent = text;
      this.say(id);
      this.spoken.push(id);
      this.lineEnd = this.t + planUtterance(text).duration + E.lineGap;
      return;
    }
    if (this.phase === 'credits') {
      this.creditsT += dt;
      const travel = this.rollInner.offsetHeight + window.innerHeight;
      const y = window.innerHeight - this.creditsT * E.creditsSpeed;
      this.rollInner.style.transform = `translateY(${y}px)`;
      if (this.creditsT * E.creditsSpeed > Math.max(travel, E.minCreditsSeconds * E.creditsSpeed)) this.finish();
    }
  }

  /** Run the clock forward (tests). */
  advance(seconds: number, step = 0.05): void {
    for (let s = 0; s < seconds && this.phase !== 'done'; s += step) this.update(step);
  }

  dispose(): void {
    this.root.remove();
  }
}
