import * as THREE from 'three';
import type { CharacterModel } from '../player/character';
import type { CharacterLibrary } from '../player/characterLibrary';
import type { Spot } from './places';
import type { CharacterSpec, CharId, PlaceId, StoryState } from './types';

// The story's characters in the world: each stands at the spot the script gives them for
// the current point in the story (or isn't there at all), turns to face you when you come
// close, and has a gold ★ over their head when they have a mission for you. They are just
// models — not pedestrians — so nothing can hurt them or push them about.

const STAR_HEIGHT = 2.45; // m above their feet
const FACE_WITHIN = 9; // m: turn toward the player

interface Member {
  spec: CharacterSpec;
  model: CharacterModel | null;
  marker: THREE.Sprite;
  /** Where they stand now, or null if they're not in the world right now. */
  spot: Spot | null;
  position: THREE.Vector3;
  facing: number;
}

function starTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffcf33';
  ctx.strokeStyle = '#1c1c1e';
  ctx.lineWidth = 7;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 24 : 56;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    ctx.lineTo(64 + Math.cos(a) * r, 66 + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class StoryCast {
  private readonly members = new Map<CharId, Member>();
  private time = 0;

  constructor(
    scene: THREE.Scene,
    library: CharacterLibrary | null,
    private readonly places: Record<PlaceId, Spot>,
    specs: CharacterSpec[],
  ) {
    const star = starTexture();
    for (const spec of specs) {
      const marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: star, depthTest: true }));
      marker.scale.set(0.8, 0.8, 0.8);
      marker.visible = false;
      scene.add(marker);
      const m: Member = { spec, model: null, marker, spot: null, position: new THREE.Vector3(0, -1000, 0), facing: 0 };
      this.members.set(spec.id, m);
      void library
        ?.create(spec.look)
        .then((model) => {
          m.model = model;
          model.root.visible = m.spot !== null;
          model.root.position.copy(m.position);
          model.root.rotation.y = m.facing;
          scene.add(model.root);
        })
        .catch(() => {
          // A failed download: they're simply not shown (their missions still work).
        });
    }
  }

  /** Put everyone where the story says they are now; `offering` get a ★. */
  refresh(state: StoryState, offering: ReadonlySet<CharId>): void {
    for (const m of this.members.values()) {
      const entry = m.spec.spots.find((s) => !s.when || s.when(state));
      m.spot = entry ? this.places[entry.at] : null;
      if (m.spot) {
        m.position.set(m.spot.x, m.spot.y, m.spot.z);
        m.facing = m.spot.facing;
      }
      if (m.model) {
        m.model.root.visible = m.spot !== null;
        m.model.root.position.copy(m.position);
        m.model.root.rotation.y = m.facing;
      }
      m.marker.visible = m.spot !== null && offering.has(m.spec.id);
    }
  }

  /** Is this character in the world right now? */
  present(id: CharId): boolean {
    return this.members.get(id)?.spot != null;
  }

  /** Feet position (null if they're not in the world). */
  position(id: CharId): THREE.Vector3 | null {
    const m = this.members.get(id);
    return m?.spot ? m.position : null;
  }

  /** The way their spot faces (toward the street). */
  facing(id: CharId): number {
    return this.members.get(id)?.facing ?? 0;
  }

  model(id: CharId): CharacterModel | null {
    const m = this.members.get(id);
    return m?.spot ? m.model : null;
  }

  spec(id: CharId): CharacterSpec {
    return this.members.get(id)!.spec;
  }

  /** Characters with a ★ (for the maps). */
  starred(): THREE.Vector3[] {
    return [...this.members.values()].filter((m) => m.marker.visible).map((m) => m.position);
  }

  /** Call every frame: idle animation, face the player when near, bob the stars. */
  render(frameDt: number, player: THREE.Vector3): void {
    this.time += frameDt;
    for (const m of this.members.values()) {
      if (!m.spot) continue;
      if (m.model) {
        const dx = player.x - m.position.x;
        const dz = player.z - m.position.z;
        const near = Math.hypot(dx, dz) < FACE_WITHIN;
        const want = near ? Math.atan2(-dx, -dz) : m.facing;
        const root = m.model.root;
        const diff = Math.atan2(Math.sin(want - root.rotation.y), Math.cos(want - root.rotation.y));
        root.rotation.y += diff * Math.min(1, frameDt * 5);
        if (Math.hypot(dx, dz) < 70) m.model.update(0, true, frameDt);
      }
      if (m.marker.visible) m.marker.position.set(m.position.x, m.position.y + STAR_HEIGHT + Math.sin(this.time * 2.5) * 0.08, m.position.z);
    }
  }
}
