import * as THREE from 'three';

// Smoke puffs (damaged / wrecked cars). One THREE.Points object for every puff, so it's a
// single draw call. Each puff rises, drifts, grows and fades. Purely visual: it lives in
// render time, not physics time.

const MAX_PUFFS = 400;
const LIFE = 2.2; // s

export class Smoke {
  private readonly positions = new Float32Array(MAX_PUFFS * 3);
  private readonly sizes = new Float32Array(MAX_PUFFS);
  private readonly alphas = new Float32Array(MAX_PUFFS);
  private readonly shades = new Float32Array(MAX_PUFFS);
  private readonly velocity = new Float32Array(MAX_PUFFS * 3);
  private readonly age = new Float32Array(MAX_PUFFS).fill(LIFE);
  private readonly baseSize = new Float32Array(MAX_PUFFS);
  private readonly geometry = new THREE.BufferGeometry();
  private next = 0;

  constructor(scene: THREE.Scene) {
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));
    this.geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1));
    this.geometry.setAttribute('aShade', new THREE.BufferAttribute(this.shades, 1));
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uScale: { value: window.innerHeight / 2 } },
      vertexShader: /* glsl */ `
        attribute float aSize;
        attribute float aAlpha;
        attribute float aShade;
        uniform float uScale;
        varying float vAlpha;
        varying float vShade;
        void main() {
          vAlpha = aAlpha;
          vShade = aShade;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          // Perspective size: world size (m) × projection scale ÷ distance.
          gl_PointSize = aSize * uScale * projectionMatrix[1][1] / max(-mv.z, 0.1);
        }`,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        varying float vShade;
        void main() {
          // Soft round puff.
          float d = length(gl_PointCoord - 0.5);
          float a = vAlpha * (1.0 - smoothstep(0.15, 0.5, d));
          if (a < 0.01) discard;
          gl_FragColor = vec4(mix(vec3(0.62), vec3(0.06), vShade), a);
        }`,
    });
    const points = new THREE.Points(this.geometry, material);
    points.frustumCulled = false;
    scene.add(points);
    window.addEventListener('resize', () => (material.uniforms.uScale.value = window.innerHeight / 2));
  }

  /** One puff at `position`. `darkness` 0 = light grey … 1 = black; `size` in metres. */
  emit(position: THREE.Vector3, darkness: number, size: number): void {
    const i = this.next;
    this.next = (this.next + 1) % MAX_PUFFS;
    this.positions.set([position.x, position.y, position.z], i * 3);
    this.velocity.set([(Math.random() - 0.5) * 0.6, 1.2 + Math.random() * 0.8, (Math.random() - 0.5) * 0.6], i * 3);
    this.age[i] = 0;
    this.baseSize[i] = size;
    this.shades[i] = darkness;
  }

  update(dt: number): void {
    for (let i = 0; i < MAX_PUFFS; i++) {
      if (this.age[i] >= LIFE) {
        this.alphas[i] = 0;
        continue;
      }
      this.age[i] += dt;
      const t = this.age[i] / LIFE;
      for (let k = 0; k < 3; k++) this.positions[i * 3 + k] += this.velocity[i * 3 + k] * dt;
      this.sizes[i] = this.baseSize[i] * (1 + t * 2.5);
      this.alphas[i] = 0.55 * (1 - t) * Math.min(1, t * 8); // quick fade in, slow fade out
    }
    for (const name of ['position', 'aSize', 'aAlpha', 'aShade']) this.geometry.getAttribute(name).needsUpdate = true;
  }
}
