import * as THREE from 'three';
import type { Terrain } from '../world/terrain';
import type { Spot } from './places';
import type { PlaceId, PropSpec, StoryState } from './types';

// The world as the story changes it: signs, banners, boarded windows and a field of crops
// that come and go with what's happened (PROPS in story/script.ts). Every prop is built
// once, the first time it's needed, and then just shown or hidden — there are only a dozen.
//
// Placement: a prop stands at its place's spot plus an offset in the spot's own frame:
// x along the street, z away from it (the spot faces the road, so "away" is behind it).

/** A board with text on two posts, facing the road. */
function signBoard(text: string, [bg, fg]: [string, string], width: number, height: number, postHeight: number): THREE.Group {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = Math.round((512 * height) / width);
  const c = canvas.getContext('2d')!;
  c.fillStyle = bg;
  c.fillRect(0, 0, canvas.width, canvas.height);
  c.strokeStyle = 'rgba(0,0,0,0.35)';
  c.lineWidth = 10;
  c.strokeRect(5, 5, canvas.width - 10, canvas.height - 10);
  c.fillStyle = fg;
  let size = canvas.height * 0.55;
  c.font = `bold ${size}px system-ui, sans-serif`;
  while (c.measureText(text).width > canvas.width * 0.88 && size > 10) {
    size -= 2;
    c.font = `bold ${size}px system-ui, sans-serif`;
  }
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(text, canvas.width / 2, canvas.height / 2 + size * 0.04);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const group = new THREE.Group();
  const board = new THREE.Mesh(new THREE.BoxGeometry(width, height, 0.12), [
    ...Array(4).fill(new THREE.MeshStandardMaterial({ color: bg })),
    new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.35 }),
    new THREE.MeshStandardMaterial({ map: tex }),
  ]);
  board.position.y = postHeight + height / 2;
  board.castShadow = true;
  group.add(board);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, metalness: 0.4, roughness: 0.6 });
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, postHeight + height, 8), postMat);
    post.position.set(side * (width / 2 - 0.25), (postHeight + height) / 2, -0.1);
    group.add(post);
  }
  return group;
}

/** Planks nailed across in an X (a boarded-up shop front). */
function boards(): THREE.Group {
  const group = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 0.9 });
  for (const [angle, y] of [
    [0.45, 1.5],
    [-0.45, 1.5],
    [0, 2.3],
    [0, 0.8],
  ]) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.3, 0.08), wood);
    plank.position.y = y;
    plank.rotation.z = angle;
    plank.castShadow = true;
    group.add(plank);
  }
  // A frame for the planks to be nailed to.
  const frame = new THREE.Mesh(new THREE.BoxGeometry(4.4, 3, 0.1), new THREE.MeshStandardMaterial({ color: 0x2b2b2b }));
  frame.position.set(0, 1.5, -0.08);
  group.add(frame);
  return group;
}

/** Rows of young crops (one instanced mesh), `w` × `d` m. */
function crops(w: number, d: number): THREE.InstancedMesh {
  const cols = Math.floor(w / 1.2);
  const rows = Math.floor(d / 1.6);
  const mesh = new THREE.InstancedMesh(
    new THREE.ConeGeometry(0.35, 1.1, 6).translate(0, 0.55, 0),
    new THREE.MeshStandardMaterial({ color: 0x5f9e3a, roughness: 0.9, flatShading: true }),
    cols * rows,
  );
  const m = new THREE.Matrix4();
  let k = 0;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const s = 0.75 + ((i * 7 + j * 13) % 10) * 0.05;
      m.makeScale(s, s, s).setPosition(-w / 2 + i * 1.2, 0, -d / 2 + j * 1.6);
      mesh.setMatrixAt(k++, m);
    }
  }
  mesh.castShadow = true;
  return mesh;
}

export class StoryWorld {
  private readonly built = new Map<string, THREE.Object3D>();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly terrain: Terrain,
    private readonly places: Record<PlaceId, Spot>,
    private readonly props: PropSpec[],
  ) {}

  /** Show the props whose condition holds now; build them the first time. */
  refresh(state: StoryState): void {
    for (const p of this.props) {
      const want = p.when(state);
      let obj = this.built.get(p.id);
      if (!want) {
        if (obj) obj.visible = false;
        continue;
      }
      if (!obj) {
        obj = this.build(p);
        this.built.set(p.id, obj);
        this.scene.add(obj);
      }
      obj.visible = true;
    }
  }

  /** Is this prop showing? (tests) */
  showing(id: string): boolean {
    return this.built.get(id)?.visible ?? false;
  }

  private build(p: PropSpec): THREE.Object3D {
    const spot = this.places[p.at];
    const [ox, oz] = p.offset ?? [0, 0];
    // The spot faces the road along (−sin f, −cos f); "away from the road" is the opposite,
    // and "along the street" is perpendicular to it.
    const f = spot.facing;
    const awayX = Math.sin(f);
    const awayZ = Math.cos(f);
    const x = spot.x + Math.cos(f) * ox + awayX * oz;
    const z = spot.z - Math.sin(f) * ox + awayZ * oz;
    const y = this.terrain.surfaceAt(x, z);
    const colors = p.colors ?? ['#333333', '#ffffff'];
    const obj =
      p.kind === 'sign'
        ? signBoard(p.text ?? '', colors, 4.4, 1.1, 1.6)
        : p.kind === 'banner'
          ? signBoard(p.text ?? '', colors, 5.2, 0.9, 3.2)
          : p.kind === 'boards'
            ? boards()
            : p.kind === 'crops'
              ? crops(26, 12)
              : signBoard(p.text ?? '', colors, 4, 0.5, 0.4);
    obj.position.set(x, y, z);
    // Signs face the road (their front is local +Z): rotate +Z onto (−sin f, −cos f).
    obj.rotation.y = f + Math.PI;
    return obj;
  }
}
