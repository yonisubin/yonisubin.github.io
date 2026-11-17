// Level data: axis-aligned box brushes with a surface tag per face. Plain data (JSON-able), so a
// later level editor can write the same format (spec: "brushes with surface tags").

export type SurfaceTag = 'portalable' | 'metal' | 'glass';
export type FaceKey = '+x' | '-x' | '+y' | '-y' | '+z' | '-z';
export type Vec3 = [number, number, number];

export interface Brush {
  min: Vec3;
  max: Vec3;
  /** Tag of every face unless overridden in `faces`. */
  tag: SurfaceTag;
  faces?: Partial<Record<FaceKey, SurfaceTag>>;
}

/** A marker drawn on the floor (no collision), e.g. the target pad of the fling test. */
export interface Marker {
  position: Vec3;
  size: [number, number];
  color: number;
}

export interface LevelData {
  name: string;
  spawn: { position: Vec3; yaw: number };
  brushes: Brush[];
  markers?: Marker[];
}

export function faceTag(b: Brush, face: FaceKey): SurfaceTag {
  return b.faces?.[face] ?? b.tag;
}

/** The face key for an axis-aligned unit normal (or null if it isn't axis-aligned). */
export function faceKeyFromNormal(n: { x: number; y: number; z: number }): FaceKey | null {
  const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
  if (ax > 0.99) return n.x > 0 ? '+x' : '-x';
  if (ay > 0.99) return n.y > 0 ? '+y' : '-y';
  if (az > 0.99) return n.z > 0 ? '+z' : '-z';
  return null;
}
