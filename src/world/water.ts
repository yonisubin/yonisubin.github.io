import * as THREE from 'three';
import { LAKE, lakeRadius } from './layout';
import { COAST_Z, WATER_Y } from './terrain';

// The sea and the lake: one big water surface at WATER_Y that follows the player.
//
//  • Waves: a few long sine waves moving toward the shore, summed in world space in the
//    vertex shader (so the grid can follow the player without the waves sliding about).
//    Small ripples are added per pixel in the fragment shader's normal.
//  • Depth: where the water is shallow it's turquoise and see-through, deeper it turns dark
//    blue; where waves wash onto the sand there's a line of foam. The sea bed's height is
//    the same formula as world/terrain.ts uses for the beach, so the shader can compute the
//    depth anywhere without a texture; the lake uses its elliptical shape.
//  • waterSurface() evaluates the same wave formula in TypeScript, so swimmers and sinking
//    cars bob with the waves you see.

const SIZE = 2000; // m across the water grid
const SEGMENTS = 200; // 10 m between vertices (≈ 40k vertices; ripples are per pixel)
const SNAP = SIZE / SEGMENTS; // the grid moves in whole cells so vertices don't swim

/** Long swell components: direction (toward the shore = −Z), wavelength (m), speed factor. */
const WAVES: { dx: number; dz: number; length: number; speed: number; weight: number }[] = [
  { dx: 0.15, dz: -1, length: 34, speed: 1.0, weight: 0.5 },
  { dx: -0.45, dz: -1, length: 21, speed: 1.25, weight: 0.3 },
  { dx: 0.6, dz: -1, length: 13, speed: 1.6, weight: 0.2 },
];
const SEA_AMPLITUDE = 0.35; // m
const LAKE_AMPLITUDE = 0.06;

/** Sea depth under the surface at rest (m; negative on dry land). Same formula as the terrain. */
function seaDepth(x: number, z: number): number {
  const d = z - COAST_Z;
  if (d < 0) return -1;
  const shore = 70 + 25 * Math.sin(x / 260) + 10 * Math.sin(x / 93 + 2);
  const h = d < shore ? 0.25 - (0.25 - WATER_Y) * (d / shore) : WATER_Y - 0.045 * (d - shore);
  return WATER_Y - Math.max(h, -16);
}

/** Approximate lake depth from its elliptical shape (m; negative outside). */
function lakeDepth(x: number, z: number): number {
  return (1.05 - lakeRadius(x, z)) * 6;
}

/** Wave height (m, around WATER_Y) at a point and time: the same sum the shader uses. */
function waveHeight(x: number, z: number, t: number): number {
  const sea = z > COAST_Z - 60;
  const amp = sea ? SEA_AMPLITUDE * Math.min(1, Math.max(0, seaDepth(x, z) / 1.5)) : LAKE_AMPLITUDE;
  let h = 0;
  for (const w of WAVES) {
    const len = Math.hypot(w.dx, w.dz);
    const k = (Math.PI * 2) / w.length;
    h += w.weight * Math.sin(((x * w.dx + z * w.dz) / len) * k - t * w.speed * 1.6);
  }
  return h * amp;
}

export class Water {
  readonly mesh: THREE.Mesh;
  private readonly uniforms = { uTime: { value: 0 } };
  private time = 0;
  private readonly fogNear: number;
  /** The fog's far distance above water (graphics quality changes it). */
  fogFar: number;
  private readonly underwaterFog = new THREE.Color(0x0d3b4f);
  underwater = false;

  constructor(
    scene: THREE.Scene,
    private readonly groundHeight: (x: number, z: number) => number,
  ) {
    const geometry = new THREE.PlaneGeometry(SIZE, SIZE, SEGMENTS, SEGMENTS).rotateX(-Math.PI / 2);
    const material = new THREE.MeshStandardMaterial({
      color: 0x0b3550,
      roughness: 0.22,
      metalness: 0.0,
      transparent: true,
      // The sky environment is bright; full-strength reflections wash the water out to white.
      envMapIntensity: 0.2,
    });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uniforms.uTime;
      const waveSum = WAVES.map((w) => {
        const len = Math.hypot(w.dx, w.dz);
        const k = (Math.PI * 2) / w.length;
        const dx = (w.dx / len) * k;
        const dz = (w.dz / len) * k;
        return { dx: dx.toFixed(5), dz: dz.toFixed(5), speed: (w.speed * 1.6).toFixed(3), weight: w.weight.toFixed(3) };
      });
      const common = /* glsl */ `
        uniform float uTime;
        varying vec3 vWorld;
        float seaDepth(vec2 p) {
          float d = p.y - ${COAST_Z.toFixed(2)};
          if (d < 0.0) return -1.0;
          float shore = 70.0 + 25.0 * sin(p.x / 260.0) + 10.0 * sin(p.x / 93.0 + 2.0);
          float h = d < shore ? 0.25 - ${(0.25 - WATER_Y).toFixed(3)} * (d / shore) : ${WATER_Y.toFixed(2)} - 0.045 * (d - shore);
          return ${WATER_Y.toFixed(2)} - max(h, -16.0);
        }
        float lakeDepth(vec2 p) {
          vec2 q = (p - vec2(${LAKE.x.toFixed(1)}, ${LAKE.z.toFixed(1)})) / vec2(${LAKE.rx.toFixed(1)}, ${LAKE.rz.toFixed(1)});
          return (1.05 - length(q)) * 6.0;
        }
        bool isSea(vec2 p) { return p.y > ${(COAST_Z - 60).toFixed(1)}; }
        float waveAmp(vec2 p) {
          return isSea(p) ? ${SEA_AMPLITUDE.toFixed(2)} * clamp(seaDepth(p) / 1.5, 0.0, 1.0) : ${LAKE_AMPLITUDE.toFixed(2)};
        }
        // Sum of sines and its gradient (for the normal).
        vec3 waves(vec2 p) {
          float h = 0.0; vec2 g = vec2(0.0);
          ${waveSum
            .map(
              (w) => `{ float a = dot(p, vec2(${w.dx}, ${w.dz})) - uTime * ${w.speed};
            h += ${w.weight} * sin(a); g += ${w.weight} * cos(a) * vec2(${w.dx}, ${w.dz}); }`,
            )
            .join('\n')}
          float amp = waveAmp(p);
          return vec3(h * amp, g * amp);
        }
      `;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${common}`)
        .replace(
          '#include <beginnormal_vertex>',
          `vec3 wp0 = (modelMatrix * vec4(position, 1.0)).xyz;
          vec3 wv = waves(wp0.xz);
          vec3 objectNormal = normalize(vec3(-wv.y, 1.0, -wv.z));
          #ifdef USE_TANGENT
          vec3 objectTangent = vec3(tangent.xyz);
          #endif`,
        )
        .replace(
          '#include <begin_vertex>',
          `vec3 transformed = vec3(position);
          transformed.y += wv.x;
          vWorld = wp0 + vec3(0.0, wv.x, 0.0);`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${common}`)
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          float depth = max(seaDepth(vWorld.xz), lakeDepth(vWorld.xz));
          if (depth < -1.0) discard; // far inland: always under the terrain anyway
          // Shallow turquoise → deep blue.
          vec3 shallow = vec3(0.03, 0.26, 0.27);
          vec3 deep = vec3(0.005, 0.04, 0.09);
          diffuseColor.rgb = mix(shallow, deep, smoothstep(0.0, 6.0, depth));
          diffuseColor.a = mix(0.55, 0.97, smoothstep(0.0, 2.5, depth));
          // Foam where the waves meet the sand, and on the crests of big sea waves.
          float crest = vWorld.y - ${WATER_Y.toFixed(2)};
          float amp = max(waveAmp(vWorld.xz), 0.001);
          float ripple = sin(vWorld.x * 1.7 + uTime * 0.8) * sin(vWorld.z * 1.3 - uTime * 0.6);
          float foam = isSea(vWorld.xz) ? smoothstep(0.55, 0.05, depth + crest * 0.8 + ripple * 0.12) : 0.0;
          foam = max(foam, smoothstep(0.75, 0.95, crest / amp) * step(1.5, depth) * 0.6);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.85, 0.9, 0.9), foam);
          diffuseColor.a = mix(diffuseColor.a, 0.95, foam);`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
          // Small ripples: perturb the normal with two moving sine patterns.
          vec2 rp = vWorld.xz;
          // Faded out with distance: far away they'd only flicker (moiré).
          float near = 1.0 - smoothstep(25.0, 110.0, length(vViewPosition));
          vec2 rip = vec2(cos(rp.x * 1.9 + rp.y * 0.7 + uTime * 2.1), cos(rp.y * 2.3 - rp.x * 0.5 - uTime * 1.7)) * 0.06 * near;
          normal = normalize(normal + vec3(rip.x, 0.0, rip.y));`,
        )
        .replace(
          '#include <lights_fragment_end>',
          `#include <lights_fragment_end>
          // The game's sky lighting is a bright, almost white gradient; reflected off water it
          // reads as white. Tint the sky reflection toward a summer-sky blue.
          reflectedLight.indirectSpecular *= vec3(0.35, 0.55, 0.8);`,
        );
    };
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.y = WATER_Y;
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 1; // after the opaque world
    scene.add(this.mesh);

    const fog = scene.fog as THREE.Fog;
    this.fogNear = fog.near;
    this.fogFar = fog.far;
  }

  /** Is there water (sea or lake) deep enough to matter at (x, z)? */
  isWater(x: number, z: number): boolean {
    return this.groundHeight(x, z) < WATER_Y - 0.05;
  }

  /** Height of the water surface at (x, z) right now, or null if there's no water there. */
  surfaceAt(x: number, z: number): number | null {
    if (!this.isWater(x, z)) return null;
    return WATER_Y + waveHeight(x, z, this.time);
  }

  /** Water depth below the surface at rest (m), 0 on land. */
  depthAt(x: number, z: number): number {
    return Math.max(0, WATER_Y - this.groundHeight(x, z));
  }

  /** Advance the waves (physics time keeps swimmers and visuals in step). */
  step(dt: number): void {
    this.time += dt;
  }

  /**
   * Once per frame, after the sky: move the grid with the player, and switch to murky blue
   * fog while the camera is under the surface.
   */
  render(scene: THREE.Scene, camera: THREE.Camera, focus: THREE.Vector3): void {
    this.uniforms.uTime.value = this.time;
    this.mesh.position.x = Math.round(focus.x / SNAP) * SNAP;
    this.mesh.position.z = Math.round(focus.z / SNAP) * SNAP;

    const surface = this.surfaceAt(camera.position.x, camera.position.z);
    this.underwater = surface !== null && camera.position.y < surface - 0.05;
    const fog = scene.fog as THREE.Fog;
    if (this.underwater) {
      fog.color.copy(this.underwaterFog);
      fog.near = 0.5;
      fog.far = 28;
    } else {
      fog.near = this.fogNear;
      fog.far = this.fogFar;
    }
  }
}

export { seaDepth, lakeDepth, waveHeight };
