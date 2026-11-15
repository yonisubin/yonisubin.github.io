#!/usr/bin/env node
// Builds the game's people from Quaternius' "Ultimate Modular Men / Women" packs (CC0).
//
//   1. Fetch the source .gltf files into art/quaternius/ (git-ignored; skipped if present).
//   2. Each character → public/assets/characters/<id>.glb:
//        - animations removed (they're shared, see 3),
//        - every part (body, head, legs, feet; skin, hair, each piece of clothing) merged into
//          ONE mesh with ONE material, so a person is a single draw call. Each part's colour is
//          baked into vertex colours, and a per-vertex part index (_PART) lets the game recolour
//          skin, hair and clothes per person,
//        - mesh compressed with meshopt.
//   3. The 24 animations (shared by every character — same skeleton) → animations.glb.
//   4. manifest.json: characters (id, name, gender, height, parts with name/kind/colour) + clips.
//
// Run with: npm run build:quaternius

import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Accessor, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, getBounds, meshopt, prune, resample, weld } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = join(ROOT, 'art/quaternius');
const OUT = join(ROOT, 'public/assets/characters');

// Public mirror of the official packs (Google Drive, the official host, refuses automated
// downloads). Large files are stored with Git LFS, so try the LFS media host first.
const MIRROR = 'osman-1002/3D-3rd-Person-Godot-Game-With-GenAI-Integration/HEAD/addons';
const MEN = 'Ultimate%20Modular%20Men-%20Feb%202022/Individual%20Characters/glTF';
const WOMEN = 'Ultimate%20Modular%20Women%20-%20April%202022/Individual%20Characters/glTF';

/** id, display name, gender, source path inside the mirror. */
const CHARACTERS = [
  ['m_hoodie', 'Hoodie', 'male', `${MEN}/Casual_Hoodie.gltf`],
  ['m_casual', 'Casual', 'male', `${MEN}/Casual_2.gltf`],
  ['m_suit', 'Business suit', 'male', `${MEN}/Suit.gltf`],
  ['m_worker', 'Construction worker', 'male', 'Ultimate%20Modular%20Men-%20Feb%202022/Worker.gltf'],
  ['m_farmer', 'Farmer', 'male', `${MEN}/Farmer.gltf`],
  ['m_punk', 'Punk', 'male', `${MEN}/Punk.gltf`],
  ['m_beach', 'Beach', 'male', `${MEN}/Beach.gltf`],
  ['m_swat', 'SWAT', 'male', `${MEN}/Swat.gltf`],
  ['m_outdoors', 'Outdoors', 'male', `${MEN}/Adventurer.gltf`],
  ['w_casual', 'Casual', 'female', `${WOMEN}/Casual.gltf`],
  ['w_formal', 'Dress', 'female', `${WOMEN}/Formal.gltf`],
  ['w_suit', 'Business suit', 'female', `${WOMEN}/Suit.gltf`],
  ['w_worker', 'Construction worker', 'female', `${WOMEN}/Worker.gltf`],
  ['w_punk', 'Punk', 'female', `${WOMEN}/Punk.gltf`],
  ['w_outdoors', 'Outdoors', 'female', `${WOMEN}/Adventurer.gltf`],
];
const ANIMATION_SOURCE = 'm_hoodie';

/** What a material is, judged by its name: decides how the game may recolour it. */
// Materials whose names don't say what they are (checked by where they sit on the body).
const OVERRIDES = {
  w_formal: { Red: 'hair' }, // her hair (the same material also colours her shoes)
  w_worker: { DarkBrown: 'hair' },
};

function partKind(name, id) {
  const override = OVERRIDES[id]?.[name];
  if (override) return override;
  if (id.startsWith('w_') && name === 'Brown') return 'fixed'; // the women's eyes
  if (/^skin/i.test(name)) return 'skin';
  if (/hair|eyebrow|moustache|beard/i.test(name)) return 'hair';
  if (/^eye$|gold|metal|earring|visor|tie$/i.test(name)) return 'fixed';
  return 'cloth';
}

async function fetchSource(id, path) {
  const file = join(SRC, `${id}.gltf`);
  if (existsSync(file) && statSync(file).size > 10000) return file;
  for (const host of ['https://media.githubusercontent.com/media', 'https://raw.githubusercontent.com']) {
    const res = await fetch(`${host}/${MIRROR}/${path}`);
    if (!res.ok) continue;
    const text = await res.text();
    if (text.startsWith('version https://git-lfs')) continue; // an LFS pointer, not the file
    writeFileSync(file, text);
    return file;
  }
  throw new Error(`Couldn't download ${id} (${path})`);
}

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
mkdirSync(SRC, { recursive: true });
mkdirSync(OUT, { recursive: true });
const manifest = { source: 'Quaternius Ultimate Modular Men & Women (CC0)', animations: 'animations.glb', clips: [], characters: [] };
const kb = (file) => `${Math.round(statSync(file).size / 1024)} KB`;

for (const [id, name, gender, path] of CHARACTERS) {
  const src = await fetchSource(id, path);
  const doc = await io.read(src);
  const root = doc.getRoot();

  if (id === ANIMATION_SOURCE) {
    // Shared animations: keep the skeleton nodes and clips, drop everything visual.
    const anim = await io.read(src);
    const aroot = anim.getRoot();
    for (const n of aroot.listNodes()) if (n.getMesh()) n.setMesh(null).setSkin(null);
    for (const m of aroot.listMeshes()) m.dispose();
    for (const s of aroot.listSkins()) s.dispose();
    await anim.transform(prune({ keepLeaves: true }), resample(), dedup());
    manifest.clips = aroot.listAnimations().map((a) => a.getName());
    const out = join(OUT, 'animations.glb');
    await io.write(out, anim);
    console.log(`animations.glb  ${manifest.clips.length} clips  ${kb(out)}`);
  }

  // Remove the animations completely, including their samplers' keyframe data (disposing an
  // animation alone leaves its samplers, and their accessors, behind).
  for (const anim of root.listAnimations()) {
    for (const sampler of anim.listSamplers()) {
      sampler.getInput()?.dispose();
      sampler.getOutput()?.dispose();
      sampler.dispose();
    }
    for (const channel of anim.listChannels()) channel.dispose();
    anim.dispose();
  }
  // Some outfits (suit, SWAT) come holding a pistol; city folk shouldn't, and the player's
  // weapon is added by the game.
  for (const node of root.listNodes()) if (/pistol|gun/i.test(node.getName()) && node.getMesh()) node.dispose();
  const bounds = getBounds(root.listScenes()[0]);
  const height = +(bounds.max[1] - bounds.min[1]).toFixed(3);

  // Parts = this character's materials, in order. Bake each into vertex colours + _PART.
  const materials = root.listMaterials();
  const parts = materials.map((m) => {
    const [r, g, b] = m.getBaseColorFactor();
    return { name: m.getName(), kind: partKind(m.getName(), id), color: [r, g, b].map((v) => +v.toFixed(4)) };
  });
  // Merge every primitive of every mesh node (all bound to the same skin) into a single
  // primitive: concatenate vertex attributes in common formats and offset the indices.
  const nodes = root.listNodes().filter((n) => n.getMesh());
  const prims = nodes.flatMap((n) => n.getMesh().listPrimitives());
  const total = prims.reduce((s, p) => s + p.getAttribute('POSITION').getCount(), 0);
  const position = new Float32Array(total * 3);
  const normal = new Float32Array(total * 3);
  const joints = new Uint16Array(total * 4);
  const weights = new Float32Array(total * 4);
  const color = new Float32Array(total * 3);
  const part = new Uint8Array(total);
  const indices = [];
  let base = 0;
  const v3 = [0, 0, 0];
  const v4 = [0, 0, 0, 0];
  for (const prim of prims) {
    const index = materials.indexOf(prim.getMaterial());
    const count = prim.getAttribute('POSITION').getCount();
    for (let v = 0; v < count; v++) {
      const o = base + v;
      position.set(prim.getAttribute('POSITION').getElement(v, v3), o * 3);
      normal.set(prim.getAttribute('NORMAL').getElement(v, v3), o * 3);
      joints.set(prim.getAttribute('JOINTS_0').getElement(v, v4), o * 4);
      weights.set(prim.getAttribute('WEIGHTS_0').getElement(v, v4), o * 4);
      color.set(parts[index].color, o * 3);
      part[o] = index;
    }
    const idx = prim.getIndices();
    for (let i = 0; i < idx.getCount(); i++) indices.push(base + idx.getScalar(i));
    base += count;
  }
  const buffer = root.listBuffers()[0];
  const acc = (type, array) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
  const material = doc.createMaterial('Character').setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(0.85).setMetallicFactor(0);
  const merged = doc
    .createPrimitive()
    .setAttribute('POSITION', acc(Accessor.Type.VEC3, position))
    .setAttribute('NORMAL', acc(Accessor.Type.VEC3, normal))
    .setAttribute('JOINTS_0', acc(Accessor.Type.VEC4, joints))
    .setAttribute('WEIGHTS_0', acc(Accessor.Type.VEC4, weights))
    .setAttribute('COLOR_0', acc(Accessor.Type.VEC3, color))
    .setAttribute('_PART', acc(Accessor.Type.SCALAR, part))
    .setIndices(acc(Accessor.Type.SCALAR, total > 65535 ? new Uint32Array(indices) : new Uint16Array(indices)))
    .setMaterial(material);
  const target = doc.createMesh('CharacterMesh').addPrimitive(merged);
  nodes[0].setMesh(target).setName('CharacterMesh'); // not 'Body': that's the root bone's name, and three.js would rename the bone to keep names unique
  for (const node of nodes.slice(1)) node.dispose();
  // Drop the old per-part attributes nothing refers to any more (an accessor whose only
  // parent is the document root is unused).
  for (const a of root.listAccessors()) if (a.listParents().length <= 1) a.dispose();
  await doc.transform(prune(), weld(), dedup(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const tris = indices.length / 3;
  const out = join(OUT, `${id}.glb`);
  await io.write(out, doc);
  manifest.characters.push({ id, name, gender, file: `${id}.glb`, height, parts });
  console.log(`${id.padEnd(12)} ${target.listPrimitives().length} primitive, ${tris} tris, height ${height}, ${parts.length} parts  ${kb(out)}`);
}

writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(
  join(OUT, 'LICENSE-QUATERNIUS.txt'),
  `Characters and animations: "Ultimate Modular Men" and "Ultimate Modular Women" by Quaternius
https://quaternius.com/packs/ultimatemodularcharacters.html
https://quaternius.com/packs/ultimatemodularwomen.html

License: CC0 1.0 Universal (public domain) — https://creativecommons.org/publicdomain/zero/1.0/
Converted for this game by scripts/build-quaternius.mjs (parts merged, colours baked to vertex colours).
`,
);
console.log(`manifest.json  ${manifest.characters.length} characters, ${manifest.clips.length} clips`);
