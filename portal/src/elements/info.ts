// Things that show information: indicator light strips (wiring paths, check / timer icons), the
// chamber info sign (drawn on a canvas from level.info), lights, decals and commentary nodes.
import * as THREE from 'three';
import { CONFIG } from '../core/config';
import type { ChamberContext } from '../game/context';
import type { Entity, Vec3 } from '../levels/level';
import { MAT } from '../render/models';
import { BaseElement, type Usable } from './base';

const E = CONFIG.elements;
const LIT = 0x4dd2ff;
const UNLIT = 0xb2622e;

function canvas(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const css = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

/** Draw a 64×64-ish pictogram for an element kind (original symbols). */
export function drawIcon(g: CanvasRenderingContext2D, name: string, x: number, y: number, s: number, color: string): void {
  g.save();
  g.translate(x, y);
  g.scale(s / 64, s / 64);
  g.strokeStyle = g.fillStyle = color;
  g.lineWidth = 5;
  g.lineCap = 'round';
  const circle = (cx: number, cy: number, r: number, fill = false) => {
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    if (fill) g.fill();
    else g.stroke();
  };
  switch (name) {
    case 'cube':
      g.strokeRect(14, 14, 36, 36);
      circle(32, 32, 7, true);
      break;
    case 'sphere':
      circle(32, 32, 20);
      g.beginPath();
      g.moveTo(12, 32);
      g.lineTo(52, 32);
      g.stroke();
      break;
    case 'pellet':
      circle(32, 32, 9, true);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        g.beginPath();
        g.moveTo(32 + Math.cos(a) * 15, 32 + Math.sin(a) * 15);
        g.lineTo(32 + Math.cos(a) * 24, 32 + Math.sin(a) * 24);
        g.stroke();
      }
      break;
    case 'liquid':
      for (const yy of [26, 40]) {
        g.beginPath();
        for (let xx = 8; xx <= 56; xx += 2) g.lineTo(xx, yy + Math.sin(xx / 5) * 4);
        g.stroke();
      }
      break;
    case 'turret':
      g.beginPath();
      g.ellipse(32, 26, 11, 16, 0, 0, Math.PI * 2);
      g.stroke();
      for (const dx of [-10, 0, 10]) {
        g.beginPath();
        g.moveTo(32, 40);
        g.lineTo(32 + dx * 1.4, 56);
        g.stroke();
      }
      circle(32, 24, 4, true);
      break;
    case 'fling':
      g.beginPath();
      g.moveTo(10, 50);
      g.quadraticCurveTo(30, 0, 54, 34);
      g.stroke();
      g.beginPath();
      g.moveTo(54, 34);
      g.lineTo(44, 32);
      g.moveTo(54, 34);
      g.lineTo(52, 24);
      g.stroke();
      break;
    case 'grill':
      for (const xx of [18, 28, 38, 48]) {
        g.beginPath();
        g.moveTo(xx, 10);
        g.lineTo(xx - 4, 54);
        g.stroke();
      }
      break;
    case 'button':
      g.beginPath();
      g.ellipse(32, 40, 22, 9, 0, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.moveTo(32, 10);
      g.lineTo(32, 28);
      g.stroke();
      break;
    case 'portal':
      g.beginPath();
      g.ellipse(20, 32, 9, 18, 0, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.ellipse(44, 32, 9, 18, 0, 0, Math.PI * 2);
      g.stroke();
      break;
    case 'platform':
      g.fillRect(12, 34, 40, 8);
      g.beginPath();
      g.moveTo(8, 22);
      g.lineTo(56, 22);
      g.moveTo(8, 22);
      g.lineTo(14, 16);
      g.moveTo(56, 22);
      g.lineTo(50, 16);
      g.stroke();
      break;
    case 'crusher':
      g.fillRect(16, 8, 32, 18);
      g.beginPath();
      g.moveTo(32, 30);
      g.lineTo(32, 52);
      g.moveTo(24, 44);
      g.lineTo(32, 54);
      g.lineTo(40, 44);
      g.stroke();
      break;
    case 'timer':
      circle(32, 32, 20);
      g.beginPath();
      g.moveTo(32, 32);
      g.lineTo(32, 18);
      g.moveTo(32, 32);
      g.lineTo(42, 36);
      g.stroke();
      break;
    case 'check':
      g.strokeRect(10, 10, 44, 44);
      g.beginPath();
      g.moveTo(18, 32);
      g.lineTo(28, 44);
      g.lineTo(46, 20);
      g.stroke();
      break;
    default:
      circle(32, 32, 16);
  }
  g.restore();
}

/** Light strip along props.path; props.icon 'check' | 'timer' at the entity. Input: on. */
export class Indicator extends BaseElement {
  private readonly mat = new THREE.MeshBasicMaterial({ color: UNLIT });
  private readonly icon: THREE.Mesh | null = null;
  private readonly iconTex: [THREE.CanvasTexture, THREE.CanvasTexture] | null = null;

  constructor(ctx: ChamberContext, entity: Entity) {
    super(ctx, entity);
    const path = this.prop<Vec3[]>('path', []).map((p) => new THREE.Vector3(...p));
    for (let i = 0; i + 1 < path.length; i++) {
      const a = path[i], b = path[i + 1];
      const len = a.distanceTo(b);
      if (len < 1e-6) continue;
      const seg = new THREE.Mesh(new THREE.BoxGeometry(E.indicatorWidth, 0.012, len + E.indicatorWidth), this.mat);
      seg.position.copy(a).add(b).multiplyScalar(0.5);
      seg.lookAt(b);
      this.add(seg);
    }
    const kind = this.prop<string | null>('icon', null);
    if (kind) {
      const make = (lit: boolean) =>
        canvas(128, 128, (g) => {
          g.fillStyle = '#1e2328';
          g.fillRect(0, 0, 128, 128);
          drawIcon(g, kind, 16, 16, 96, css(lit ? LIT : UNLIT));
        });
      this.iconTex = [make(false), make(true)];
      this.icon = this.add(new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.45), new THREE.MeshBasicMaterial({ map: this.iconTex[0] })));
      this.icon.position.copy(this.origin());
      this.icon.rotation.y = this.yaw();
    }
    this.outputs.on = false;
  }

  lit(): boolean {
    return this.input('on', false);
  }

  protected onInput(): void {
    this.setOutput('on', this.lit());
  }

  update(): void {
    const on = this.lit();
    this.setOutput('on', on);
    this.mat.color.setHex(on ? LIT : UNLIT);
    if (this.icon && this.iconTex) (this.icon.material as THREE.MeshBasicMaterial).map = this.iconTex[on ? 1 : 0];
  }

  dispose(): void {
    super.dispose();
    this.mat.dispose();
    this.iconTex?.forEach((t) => t.dispose());
  }
}

/** Chamber info sign: number, progress bar, title, element icons from level.info. Input: lit. */
export class Sign extends BaseElement {
  private readonly mat: THREE.MeshBasicMaterial;

  constructor(ctx: ChamberContext, entity: Entity) {
    super(ctx, entity);
    const info = ctx.level.info ?? {};
    const industrial = info.theme === 'industrial';
    const [w, h] = E.signSize;
    const tex = canvas(256, 384, (g) => {
      g.fillStyle = industrial ? '#2b2a26' : '#f2f3f1';
      g.fillRect(0, 0, 256, 384);
      const ink = industrial ? '#d8c9a8' : '#22282d';
      g.fillStyle = ink;
      g.font = '300 120px system-ui, sans-serif';
      g.textBaseline = 'top';
      const n = info.number ?? 0;
      g.fillText(String(n).padStart(2, '0'), 18, 10);
      g.font = '14px system-ui, sans-serif';
      g.fillText(`/${String(E.chamberCount).padStart(2, '0')}`, 190, 108);
      // Progress bar: chambers done out of the track.
      g.fillStyle = industrial ? '#55524a' : '#c9cdd1';
      g.fillRect(18, 140, 220, 6);
      g.fillStyle = ink;
      g.fillRect(18, 140, (220 * Math.min(n, E.chamberCount)) / E.chamberCount, 6);
      g.font = '600 18px system-ui, sans-serif';
      g.fillText((info.title ?? ctx.level.name).slice(0, 22), 18, 160);
      const icons = info.icons ?? [];
      icons.slice(0, 8).forEach((name, i) => {
        const x = 18 + (i % 4) * 56;
        const y = 210 + Math.floor(i / 4) * 64;
        g.fillStyle = ink;
        g.fillRect(x, y, 48, 48);
        drawIcon(g, name, x + 4, y + 4, 40, industrial ? '#2b2a26' : '#f2f3f1');
      });
      g.font = '11px system-ui, sans-serif';
      g.fillStyle = ink;
      g.fillText('TWINFOLD PROGRAMME · TEST TRACK', 18, 360);
    });
    this.mat = new THREE.MeshBasicMaterial({ map: tex });
    const panel = this.add(new THREE.Mesh(new THREE.PlaneGeometry(w, h), this.mat));
    const back = this.add(new THREE.Mesh(new THREE.BoxGeometry(w + 0.08, h + 0.08, 0.05), MAT.dark()));
    const o = this.origin();
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw());
    panel.position.copy(o).add(new THREE.Vector3(0, 0, 0.03).applyQuaternion(q));
    panel.quaternion.copy(q);
    back.position.copy(o);
    back.quaternion.copy(q);
  }

  update(): void {
    this.mat.color.setScalar(this.input('lit', true) ? 1 : 0.25);
  }
}

/** A point light. props.color, intensity, distance. Input: on (default true). */
export class LightElement extends BaseElement {
  private readonly light: THREE.PointLight;

  constructor(ctx: ChamberContext, entity: Entity) {
    super(ctx, entity);
    this.light = this.add(new THREE.PointLight(this.prop('color', 0xffffff), this.prop('intensity', 8), this.prop('distance', 12)));
    this.light.position.copy(this.origin());
  }

  update(): void {
    this.light.visible = this.input('on', true);
  }
}

/** A flat decal: props.text, or props.image 'arrow' | 'warning' | 'scribble'; props.size [w, h]. */
export class Decal extends BaseElement {
  constructor(ctx: ChamberContext, entity: Entity) {
    super(ctx, entity);
    const [w, h] = this.prop<[number, number]>('size', [1, 1]);
    const text = this.prop<string>('text', '');
    const image = this.prop<string>('image', '');
    const tex = canvas(256, Math.max(32, Math.round((256 * h) / w)), (g) => {
      const H = g.canvas.height;
      g.clearRect(0, 0, 256, H);
      g.strokeStyle = g.fillStyle = this.prop('ink', '#2c3136');
      g.lineWidth = 10;
      if (image === 'arrow') {
        g.beginPath();
        g.moveTo(30, H / 2);
        g.lineTo(220, H / 2);
        g.moveTo(170, H / 2 - 50);
        g.lineTo(225, H / 2);
        g.lineTo(170, H / 2 + 50);
        g.stroke();
      } else if (image === 'warning') {
        g.beginPath();
        g.moveTo(128, 20);
        g.lineTo(236, H - 20);
        g.lineTo(20, H - 20);
        g.closePath();
        g.stroke();
        g.fillRect(122, H * 0.35, 12, H * 0.3);
        g.fillRect(122, H * 0.72, 12, 12);
      } else if (image === 'scribble') {
        let x = 7;
        const rnd = () => ((x = (x * 16807) % 2147483647) / 2147483647);
        g.lineWidth = 4;
        g.beginPath();
        for (let i = 0; i < 40; i++) g.lineTo(rnd() * 256, rnd() * H);
        g.stroke();
      }
      if (text) {
        g.font = `${Math.round(H * 0.3)}px system-ui, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(text, 128, H / 2);
      }
    });
    const mesh = this.add(new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })));
    mesh.position.copy(this.origin());
    mesh.rotation.y = this.yaw();
    if (this.prop('floor', false)) mesh.rotation.set(-Math.PI / 2, 0, this.yaw());
  }
}

/** Floating commentary node: Use plays its text (an `sfx` with the caption for the shell). */
export class CommentaryNode extends BaseElement implements Usable {
  private readonly mesh: THREE.Mesh;
  private t = 0;

  constructor(ctx: ChamberContext, entity: Entity) {
    super(ctx, entity);
    this.mesh = this.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 1), new THREE.MeshBasicMaterial({ color: 0xffe08a, wireframe: true })));
    this.mesh.position.copy(this.origin());
    this.fixedBox(new THREE.Vector3(0.25, 0.25, 0.25), this.origin(), undefined, false);
    this.outputs.played = false;
  }

  useText(): string | null {
    return 'E  listen';
  }

  use(): void {
    this.ctx.sfx('commentary', this.prop('text', ''));
    this.setOutput('played', true);
  }

  update(dt: number): void {
    this.t += dt;
    this.mesh.rotation.y = this.t;
    this.mesh.position.y = this.entity.position[1] + Math.sin(this.t * 2) * 0.05;
  }

  snapshot(): unknown {
    return { ...(super.snapshot() as object), t: this.t };
  }

  restore(state: unknown): void {
    super.restore(state);
    this.t = (state as { t: number }).t;
  }
}
