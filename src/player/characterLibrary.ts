import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { CharacterModel } from './character';

// The roster of people (built by scripts/build-quaternius.mjs into public/assets/characters).
// Every character shares one skeleton and one set of animations. Each character file is a
// single mesh whose vertex colours hold its original colours, plus a per-vertex part index
// (_part) saying which piece it belongs to (skin, hair, shirt…). A "look" recolours those
// parts per person: skin tone, hair colour and an outfit colour shift.

const BASE = `${import.meta.env.BASE_URL}assets/characters/`;

export type PartKind = 'skin' | 'hair' | 'cloth' | 'fixed';

export interface CharacterInfo {
  id: string;
  name: string;
  gender: 'male' | 'female';
  file: string;
  /** Height of the model as authored (m), top of the hair included. */
  height: number;
  parts: { name: string; kind: PartKind; color: [number, number, number] }[];
}

interface Manifest {
  animations: string;
  clips: string[];
  characters: CharacterInfo[];
}

/** How a particular person looks. Indices refer to the palettes below. */
export interface Look {
  id: string;
  skin: number;
  hair: number;
  /** 0 = the outfit's own colours; 1+ = a hue shift of the clothes. */
  outfit: number;
  /** Standing height, m. */
  height: number;
}

/** Realistic skin tones, light to dark (sRGB). */
// sRGB. The lightest are kept a little deep: the bright daylight washes pale skin out to white.
export const SKIN_TONES = [0xd6a888, 0xc69470, 0xae7a56, 0x8d5a3a, 0x6b4128, 0x47291a];
/** Natural hair colours (sRGB): black, dark brown, brown, blond, red, grey. */
export const HAIR_COLORS = [0x1b1612, 0x3b2617, 0x6a4527, 0xc9a35d, 0x8f3b1d, 0x9a9792];
/** Outfit variants: degrees to rotate the clothes' hue (0 = as designed). */
export const OUTFIT_SHIFTS = [0, 45, 110, 170, 230, 300];

const HEIGHTS = { male: [1.7, 1.88], female: [1.58, 1.74] } as const;

/** One material for everyone: colours come from the vertices. */
const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });

export class CharacterLibrary {
  private readonly loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  private readonly scenes = new Map<string, Promise<THREE.Object3D>>();

  private constructor(
    readonly characters: CharacterInfo[],
    private readonly clips: THREE.AnimationClip[],
  ) {}

  /** Load the roster and the shared animations (the character meshes load on demand). */
  static async load(): Promise<CharacterLibrary> {
    const manifest = (await (await fetch(`${BASE}manifest.json`)).json()) as Manifest;
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const anims = await loader.loadAsync(`${BASE}${manifest.animations}`);
    return new CharacterLibrary(manifest.characters, anims.animations);
  }

  info(id: string): CharacterInfo {
    return this.characters.find((c) => c.id === id) ?? this.characters[0];
  }

  /** Start downloading every character in the background. */
  preloadAll(): void {
    for (const c of this.characters) void this.scene(c);
  }

  private scene(info: CharacterInfo): Promise<THREE.Object3D> {
    let scene = this.scenes.get(info.id);
    if (!scene) {
      scene = this.loader.loadAsync(`${BASE}${info.file}`).then((gltf) => gltf.scene);
      this.scenes.set(info.id, scene);
    }
    return scene;
  }

  /** A random, plausible look (optionally of a given character). */
  randomLook(random: () => number, id?: string): Look {
    const info = id ? this.info(id) : this.characters[Math.floor(random() * this.characters.length)];
    const [lo, hi] = HEIGHTS[info.gender];
    const skin = Math.floor(random() * SKIN_TONES.length);
    // Hair: mostly dark, some light brown / blond / red, ~1 in 8 grey.
    const r = random();
    const hair = r < 0.3 ? 0 : r < 0.58 ? 1 : r < 0.72 ? 2 : r < 0.81 ? 3 : r < 0.88 ? 4 : 5;
    return { id: info.id, skin, hair, outfit: Math.floor(random() * OUTFIT_SHIFTS.length), height: lo + random() * (hi - lo) };
  }

  /** Build an independent, animated person with the given look. */
  async create(look: Look): Promise<CharacterModel> {
    const info = this.info(look.id);
    const source = await this.scene(info);
    const scene = cloneSkinned(source); // its own skeleton, so it animates independently
    scene.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh;
      if (!mesh.isSkinnedMesh) return;
      mesh.geometry = recoloured(mesh.geometry, info, look);
      mesh.material = material;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // Bounds come from the bind pose and don't follow the animation, so pad them; with
      // that, off-screen people can be culled.
      mesh.computeBoundingSphere();
      mesh.boundingSphere!.radius *= 1.6;
    });
    return new CharacterModel(scene, this.clips, look.height / info.height);
  }
}

/**
 * A copy of the geometry that shares everything (positions, skinning, indices) except its
 * colours, rewritten for this look: part by part, skin → skin tone, hair → hair colour,
 * clothes → hue-shifted, fixed parts (eyes, metal) untouched.
 */
function recoloured(source: THREE.BufferGeometry, info: CharacterInfo, look: Look): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(source.attributes)) geometry.setAttribute(name, attribute);
  geometry.setIndex(source.index);
  const part = source.getAttribute('_part');
  const count = source.getAttribute('position').count;
  const skin = new THREE.Color(SKIN_TONES[look.skin % SKIN_TONES.length]);
  const hair = new THREE.Color(HAIR_COLORS[look.hair % HAIR_COLORS.length]);
  const shift = OUTFIT_SHIFTS[look.outfit % OUTFIT_SHIFTS.length] / 360;
  const hsl = { h: 0, s: 0, l: 0 };
  const colors = info.parts.map((p) => {
    const c = new THREE.Color(...p.color);
    if (p.kind === 'skin') {
      // A second skin part (e.g. "Skin_Darker" for lips) stays a little darker.
      return skin.clone().multiplyScalar(/darker/i.test(p.name) ? 0.8 : 1);
    }
    if (p.kind === 'hair') return hair.clone().multiplyScalar(/eyebrow|moustache/i.test(p.name) ? 0.75 : 1);
    if (p.kind === 'cloth' && shift !== 0) {
      c.getHSL(hsl);
      c.setHSL((hsl.h + shift) % 1, Math.min(hsl.s, 0.55), hsl.l); // cap saturation: no neon clothes
    }
    return c;
  });
  const out = new Float32Array(count * 3);
  for (let v = 0; v < count; v++) {
    const c = colors[part ? part.getX(v) : 0] ?? colors[0];
    out[v * 3] = c.r;
    out[v * 3 + 1] = c.g;
    out[v * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(out, 3));
  return geometry;
}
