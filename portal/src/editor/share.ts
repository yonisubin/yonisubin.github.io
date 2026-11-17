// Share-by-link: the level's JSON, deflated (CompressionStream 'deflate') and base64url-encoded into
// the URL hash: …/portal/#play=<data>. Opening the link validates the level and plays it.
import type { LevelData } from '../levels/level';
import { parseLevel } from '../levels/loader';

export const SHARE_PREFIX = '#play=';

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([data as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export async function encodeLevel(level: LevelData): Promise<string> {
  const json = JSON.stringify(parseLevel(level));
  const packed = await pipe(new TextEncoder().encode(json), new CompressionStream('deflate'));
  return toBase64Url(packed);
}

export async function decodeLevel(data: string): Promise<LevelData> {
  let bytes: Uint8Array;
  try {
    bytes = await pipe(fromBase64Url(data), new DecompressionStream('deflate'));
  } catch {
    throw new Error('The link is damaged (the chamber data could not be unpacked).');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('The link is damaged (the chamber data is not JSON).');
  }
  return parseLevel(parsed);
}

/** A full share URL for this page. */
export async function shareUrl(level: LevelData): Promise<string> {
  const base = location.href.split('#')[0].split('?')[0];
  return `${base}${SHARE_PREFIX}${await encodeLevel(level)}`;
}

/** The encoded level in a hash, if it is a share link. */
export function sharedData(hash: string): string | null {
  return hash.startsWith(SHARE_PREFIX) ? hash.slice(SHARE_PREFIX.length) : null;
}
