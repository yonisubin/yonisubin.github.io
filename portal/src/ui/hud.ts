// Minimal HUD: a crosshair with two half-rings (left = first colour, right = second; filled when
// that portal exists), plus a toggleable debug overlay. No health bar, no ammo.
import { CONFIG } from '../core/config';

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

export class Hud {
  private readonly left: SVGPathElement;
  private readonly right: SVGPathElement;
  private readonly debugEl: HTMLDivElement;
  debugOn: boolean = CONFIG.debug.overlay;

  constructor(root: HTMLElement) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '-20 -20 40 40');
    svg.setAttribute('id', 'crosshair');
    const dot = document.createElementNS(ns, 'circle');
    dot.setAttribute('r', '1.3');
    dot.setAttribute('fill', '#fff');
    // Two half-rings: left arc for the first colour, right arc for the second.
    this.left = document.createElementNS(ns, 'path');
    this.left.setAttribute('d', 'M 2 -9 A 9 9 0 0 0 2 9');
    this.right = document.createElementNS(ns, 'path');
    this.right.setAttribute('d', 'M -2 -9 A 9 9 0 0 1 -2 9');
    for (const [el, c] of [
      [this.left, CONFIG.portal.colors.a],
      [this.right, CONFIG.portal.colors.b],
    ] as const) {
      el.setAttribute('fill', 'none');
      el.setAttribute('stroke', hex(c));
      el.setAttribute('stroke-width', '2');
      el.setAttribute('stroke-linecap', 'round');
      svg.appendChild(el);
    }
    svg.appendChild(dot);
    root.appendChild(svg);

    this.debugEl = document.createElement('div');
    this.debugEl.id = 'debug';
    root.appendChild(this.debugEl);
  }

  update(placedA: boolean, placedB: boolean, debugText: string): void {
    // Placed: thick and solid. Missing: thin and faint.
    this.left.setAttribute('stroke-width', placedA ? '3.2' : '1.2');
    this.left.setAttribute('opacity', placedA ? '1' : '0.45');
    this.right.setAttribute('stroke-width', placedB ? '3.2' : '1.2');
    this.right.setAttribute('opacity', placedB ? '1' : '0.45');
    this.debugEl.style.display = this.debugOn ? 'block' : 'none';
    if (this.debugOn) this.debugEl.textContent = debugText;
  }
}
