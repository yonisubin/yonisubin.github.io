import type * as THREE from 'three';
import type { Input } from '../input/actions';

// Small corner readout: frames per second and draw calls. Toggle with F3 or `.

const REFRESH_INTERVAL = 0.5; // s between readout updates

export class DebugOverlay {
  private readonly el: HTMLDivElement;
  private frames = 0;
  private elapsed = 0;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly input: Input,
  ) {
    this.el = document.createElement('div');
    this.el.style.cssText = [
      'position:fixed',
      'top:calc(max(8px, env(safe-area-inset-top)) + 64px)', // below the health panel
      'left:max(8px, env(safe-area-inset-left))',
      'z-index:30',
      'padding:4px 8px',
      'border-radius:4px',
      'background:rgba(0,0,0,0.45)',
      'color:#d6ffd6',
      'font:12px/1.4 ui-monospace,monospace',
      'white-space:pre',
      'pointer-events:none',
    ].join(';');
    document.body.appendChild(this.el);
  }

  /** Call once per frame, after rendering (renderer.info is reset at the start of each render). */
  update(frameDt: number): void {
    if (this.input.consumePressed('toggleDebug')) {
      this.el.style.display = this.el.style.display === 'none' ? '' : 'none';
    }
    this.frames++;
    this.elapsed += frameDt;
    if (this.elapsed < REFRESH_INTERVAL) return;
    const info = this.renderer.info.render;
    const fps = Math.round(this.frames / this.elapsed);
    this.el.textContent = `${fps} fps\n${info.calls} draw calls\n${(info.triangles / 1000).toFixed(0)}k triangles`;
    this.frames = 0;
    this.elapsed = 0;
  }
}
