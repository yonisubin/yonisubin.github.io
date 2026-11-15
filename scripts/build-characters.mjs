#!/usr/bin/env node
// Converts Mixamo downloads (FBX) into small, web-ready GLB files for the game.
//
//   art/mixamo/characters/char_<name>.fbx  →  public/assets/characters/<name>.glb
//   art/mixamo/animations/<clip>.fbx       →  public/assets/characters/animations.glb (all clips)
//   + public/assets/characters/mixamo/manifest.json (a separate roster; see docs/characters.md)
//
// Steps per character: FBX → glTF (FBX2glTF), drop any bundled animation, shrink textures to
// 1024 px WebP, compress the mesh (meshopt), measure the height.
// Steps for animations: convert each file, keep only its clip (renamed to the file name) and
// the skeleton it animates, drop meshes/textures, merge every clip into one file, and strip
// redundant keyframes.
//
// Run with: npm run build:characters   (see docs/characters.md for what to download)

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, getBounds, meshopt, mergeDocuments, prune, resample, textureCompress } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const ROOT = new URL('..', import.meta.url).pathname;
// ART_DIR / OUT_DIR can be overridden (e.g. to try the pipeline on test files).
const ART_DIR = process.env.ART_DIR ?? join(ROOT, 'art/mixamo');
const CHAR_DIR = join(ART_DIR, 'characters');
const ANIM_DIR = join(ART_DIR, 'animations');
const OUT_DIR = process.env.OUT_DIR ?? join(ROOT, 'public/assets/characters/mixamo'); // kept apart from the Quaternius roster
const TEXTURE_SIZE = 1024;
const FBX2GLTF = join(ROOT, 'node_modules/fbx2gltf/bin', process.platform === 'win32' ? 'Windows_NT' : process.platform === 'darwin' ? 'Darwin' : 'Linux', process.platform === 'win32' ? 'FBX2glTF.exe' : 'FBX2glTF');

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const tmp = mkdtempSync(join(tmpdir(), 'characters-'));

/** FBX → GLB with FBX2glTF; returns the GLB path. */
function convert(fbx) {
  const out = join(tmp, basename(fbx, '.fbx'));
  execFileSync(FBX2GLTF, ['-b', '--pbr-metallic-roughness', '--anim-framerate', 'bake30', '-i', fbx, '-o', out], { stdio: 'pipe' });
  return `${out}.glb`;
}

const list = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.fbx')).sort() : []);
const kb = (file) => `${Math.round(statSync(file).size / 1024)} KB`;
const displayName = (id) => id.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

mkdirSync(OUT_DIR, { recursive: true });
const manifest = { characters: [], animations: 'animations.glb', clips: [] };

// ---------------------------------------------------------------- characters
for (const file of list(CHAR_DIR)) {
  const id = basename(file, '.fbx').replace(/^char_/i, '').toLowerCase();
  const doc = await io.read(convert(join(CHAR_DIR, file)));
  for (const anim of doc.getRoot().listAnimations()) anim.dispose();
  const bounds = getBounds(doc.getRoot().listScenes()[0]);
  const height = +(bounds.max[1] - bounds.min[1]).toFixed(3);
  await doc.transform(
    prune(),
    dedup(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [TEXTURE_SIZE, TEXTURE_SIZE] }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  const out = join(OUT_DIR, `${id}.glb`);
  await io.write(out, doc);
  manifest.characters.push({ id, name: displayName(id), file: `${id}.glb`, height });
  console.log(`character ${id.padEnd(16)} height ${height.toFixed(2)} m  ${kb(out)}`);
}

// ---------------------------------------------------------------- animations
const animFiles = list(ANIM_DIR);
if (animFiles.length) {
  let merged = null;
  for (const file of animFiles) {
    const clip = basename(file, '.fbx').toLowerCase();
    const doc = await io.read(convert(join(ANIM_DIR, file)));
    // Keep the one real clip (FBX2glTF also emits an empty "Take 001"), named after the file.
    const anims = doc.getRoot().listAnimations().filter((a) => a.listChannels().length > 0);
    if (!anims.length) {
      console.warn(`animation ${clip}: no motion found, skipped`);
      continue;
    }
    for (const a of doc.getRoot().listAnimations()) if (a !== anims[0]) a.dispose();
    anims[0].setName(clip);
    for (const mesh of doc.getRoot().listMeshes()) mesh.dispose();
    for (const skin of doc.getRoot().listSkins()) skin.dispose();
    await doc.transform(prune({ keepLeaves: true }));
    if (!merged) merged = doc;
    else mergeDocuments(merged, doc);
    manifest.clips.push(clip);
    console.log(`animation ${clip}`);
  }
  if (merged) {
    await merged.transform(resample(), prune({ keepLeaves: true }), dedup());
    const out = join(OUT_DIR, 'animations.glb');
    await io.write(out, merged);
    console.log(`animations.glb  ${manifest.clips.length} clips  ${kb(out)}`);
  }
}

writeFileSync(join(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
rmSync(tmp, { recursive: true, force: true });
console.log(`manifest.json  ${manifest.characters.length} characters, ${manifest.clips.length} clips`);
if (!manifest.characters.length && !manifest.clips.length) {
  console.log('Nothing to convert yet: put FBX files in art/mixamo/characters and art/mixamo/animations (see docs/characters.md).');
}
