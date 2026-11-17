// The main menu's animated 3D background: a slow drift through a white panelled void where pairs of
// blue and amber openings hang and turn, seen through light haze. Its own small three.js renderer on
// its own canvas, only rendering while the menu is up.
import * as THREE from 'three';
import { SHELL } from '../core/shellConfig';

export class MenuBackground {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
  private frames: THREE.Group[] = [];
  private running = false;
  private t = 0;
  private last = 0;
  colors = { a: 0x2f8cff, b: 0xffa31a };
  private ringMats: THREE.MeshBasicMaterial[] = [];
  /** Frames drawn (tests check the background animates). */
  frameCount = 0;

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'menuBg';
    parent.prepend(this.canvas);
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    } catch {
      this.renderer = null; // no WebGL: the menu's CSS gradient shows instead
      return;
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setClearColor(0xdfe4e8);
    this.scene.fog = new THREE.Fog(0xdfe4e8, 8, 46);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a939b, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1);
    sun.position.set(2, 5, 3);
    this.scene.add(sun);

    // A long corridor of panels (floor, ceiling, walls) made of slightly offset slabs.
    const panelMat = new THREE.MeshLambertMaterial({ color: 0xeef1f3 });
    const darkMat = new THREE.MeshLambertMaterial({ color: 0x3d434a });
    const slab = new THREE.BoxGeometry(1.9, 0.12, 1.9);
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let z = -60; z < 6; z += 2) {
      for (let x = -5; x <= 5; x += 2) {
        for (const y of [-3, 5]) {
          const m = new THREE.Mesh(slab, rnd() < 0.12 ? darkMat : panelMat);
          m.position.set(x, y + (rnd() - 0.5) * 0.06, z);
          this.scene.add(m);
        }
      }
      for (const x of [-6, 6]) {
        for (let y = -2; y <= 4; y += 2) {
          const m = new THREE.Mesh(slab, rnd() < 0.15 ? darkMat : panelMat);
          m.rotation.z = Math.PI / 2;
          m.position.set(x, y, z);
          this.scene.add(m);
        }
      }
    }
    // Floating frames: rounded openings in the two colours.
    const shape = new THREE.Shape();
    const w = 0.6, h = 1.05, r = 0.4;
    shape.moveTo(-w + r, -h);
    shape.lineTo(w - r, -h);
    shape.quadraticCurveTo(w, -h, w, -h + r);
    shape.lineTo(w, h - r);
    shape.quadraticCurveTo(w, h, w - r, h);
    shape.lineTo(-w + r, h);
    shape.quadraticCurveTo(-w, h, -w, h - r);
    shape.lineTo(-w, -h + r);
    shape.quadraticCurveTo(-w, -h, -w + r, -h);
    const inner = new THREE.Shape();
    const wi = w - 0.09, hi = h - 0.09, ri = r - 0.09;
    inner.moveTo(-wi + ri, -hi);
    inner.quadraticCurveTo(-wi, -hi, -wi, -hi + ri);
    inner.lineTo(-wi, hi - ri);
    inner.quadraticCurveTo(-wi, hi, -wi + ri, hi);
    inner.lineTo(wi - ri, hi);
    inner.quadraticCurveTo(wi, hi, wi, hi - ri);
    inner.lineTo(wi, -hi + ri);
    inner.quadraticCurveTo(wi, -hi, wi - ri, -hi);
    inner.lineTo(-wi + ri, -hi);
    shape.holes.push(inner);
    const ringGeo = new THREE.ShapeGeometry(shape, 12);
    const fillGeo = new THREE.ShapeGeometry(inner, 12);
    for (let i = 0; i < 9; i++) {
      const g = new THREE.Group();
      const which = i % 2 === 0 ? 'a' : 'b';
      const mat = new THREE.MeshBasicMaterial({ color: this.colors[which], side: THREE.DoubleSide });
      mat.userData.which = which;
      this.ringMats.push(mat);
      const fill = new THREE.MeshBasicMaterial({ color: 0x0f1316, transparent: true, opacity: 0.18, side: THREE.DoubleSide });
      g.add(new THREE.Mesh(ringGeo, mat), new THREE.Mesh(fillGeo, fill));
      g.position.set((rnd() - 0.5) * 7, (rnd() - 0.2) * 4, -6 - i * 5.5);
      g.rotation.set(0, rnd() * Math.PI, (rnd() - 0.5) * 0.4);
      g.userData.spin = (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd());
      this.frames.push(g);
      this.scene.add(g);
    }
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  setColors(a: number, b: number): void {
    this.colors = { a, b };
    for (const m of this.ringMats) m.color.setHex(m.userData.which === 'a' ? a : b);
  }

  private resize(): void {
    if (!this.renderer) return;
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.camera.aspect = window.innerWidth / Math.max(1, window.innerHeight);
    this.camera.updateProjectionMatrix();
  }

  start(): void {
    this.canvas.style.display = 'block';
    if (this.running || !this.renderer) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.render(dt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    this.canvas.style.display = 'none';
  }

  render(dt: number): void {
    if (!this.renderer) return;
    this.t += dt;
    // Glide down the corridor and loop back seamlessly every 22 m (frames repeat visually).
    const z = 2 - ((this.t * 0.9) % 22);
    this.camera.position.set(Math.sin(this.t * 0.13) * 1.2, 1 + Math.sin(this.t * 0.21) * 0.4, z);
    this.camera.lookAt(Math.sin(this.t * 0.1) * 2, 0.6, z - 10);
    for (const f of this.frames) f.rotation.y += dt * SHELL.menu.spin * f.userData.spin;
    this.renderer.render(this.scene, this.camera);
    this.frameCount++;
  }
}
