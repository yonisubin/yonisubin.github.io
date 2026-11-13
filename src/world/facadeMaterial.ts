import * as THREE from 'three';
import { PARAPET, STYLE_METRICS } from './layout';

// Procedural building facades.
//
// Every building is the same unit box, stretched per instance (InstancedMesh), so all
// buildings render in one draw call. Textures would stretch with the box, so instead the
// fragment shader draws windows from the fragment's position in *metres* on the facade:
//
//   u = horizontal metres along the face, centred on the face
//   h = metres above the building's base
//
// From (u, h) it works out which column and floor the pixel is in, and whether it lands
// in a window, a shopfront, a shop sign, the wall, or the roof. Per-instance data:
//   instanceColor → wall colour
//   aStyle.x      → style (glass / brick / concrete)
//   aStyle.y      → seed (varies curtains, lit windows, sign colour)
//
// Glass is given low roughness and some metalness so it reflects the sky environment map,
// which is most of what makes the buildings read as "real".

const m = STYLE_METRICS;
const f = (n: number) => n.toFixed(3);

const VERTEX_PARS = /* glsl */ `
attribute vec4 aStyle;
varying vec3 vBoxPos;
varying vec3 vBoxNormal;
varying vec3 vSize;
varying vec4 vStyle;
`;

// The unit box spans x,z ∈ [-0.5, 0.5], y ∈ [0, 1]. Instance matrices only scale and
// translate (no rotation), so the scale is just the length of each matrix column.
const VERTEX_MAIN = /* glsl */ `
#include <begin_vertex>
vSize = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
vBoxPos = position * vSize;
vBoxNormal = normal;
vStyle = aStyle;
`;

const FRAGMENT_PARS = /* glsl */ `
varying vec3 vBoxPos;
varying vec3 vBoxNormal;
varying vec3 vSize;
varying vec4 vStyle;
float facadeGlass;
float facadeGlassMetal;
vec3 facadeEmissive;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

// 1 inside [lo, hi], 0 outside, with edges anti-aliased by the screen-space derivative
// so distant windows blur into an average instead of shimmering (moiré).
float band(float a, float lo, float hi) {
  float w = max(fwidth(a), 1e-4) * 0.75;
  return smoothstep(lo - w, lo + w, a) * (1.0 - smoothstep(hi - w, hi + w, a));
}
`;

const FRAGMENT_COLOR = /* glsl */ `
#include <color_fragment>
{
  vec3 n = normalize(vBoxNormal);
  float style = vStyle.x;
  float seed = vStyle.y;
  vec3 wall = diffuseColor.rgb;
  vec3 col = wall;
  facadeGlass = 0.0;
  facadeGlassMetal = 0.0;
  facadeEmissive = vec3(0.0);

  if (n.y > 0.5) {
    // Roof: gravel / membrane.
    col = vec3(0.16, 0.16, 0.17) * (0.9 + 0.2 * hash13(floor(vBoxPos * 0.5) + seed));
  } else {
    bool sideX = abs(n.x) > 0.5;
    float u = sideX ? vBoxPos.z : vBoxPos.x;
    float faceW = sideX ? vSize.z : vSize.x;
    float h = vBoxPos.y;
    float faceKey = n.x * 3.0 + n.z * 7.0;

    float groundH, floorH, colW;
    vec4 win; // window rectangle inside its cell: (xMin, yMin, xMax, yMax) as fractions
    if (style < 0.5) {        // glass curtain wall: almost all glass, thin mullions
      groundH = ${f(m[0].groundFloor)}; floorH = ${f(m[0].floor)}; colW = 1.5;
      win = vec4(0.05, 0.22, 0.95, 0.97);
    } else if (style < 1.5) { // brick: punched windows with stone surrounds
      groundH = ${f(m[1].groundFloor)}; floorH = ${f(m[1].floor)}; colW = 3.0;
      win = vec4(0.27, 0.28, 0.73, 0.8);
    } else {                  // concrete: continuous ribbon windows
      groundH = ${f(m[2].groundFloor)}; floorH = ${f(m[2].floor)}; colW = 2.0;
      win = vec4(-0.1, 0.36, 1.1, 0.82);
    }

    // Columns: leave 0.6 m of solid corner at each edge of the face.
    float usable = max(faceW - 1.2, 1.0);
    float nCols = max(1.0, floor(usable / colW));
    float uc = (u + usable * 0.5) / (usable / nCols);
    float inCols = band(uc, 0.0, nCols);
    float colId = floor(uc);
    float fx = fract(uc);
    float topH = vSize.y - ${f(PARAPET)};

    if (h < groundH) {
      // Ground floor: darker stone base, big shop windows, a coloured sign band above them.
      col = mix(wall, vec3(0.12, 0.11, 0.1), 0.55);
      float fy = h / groundH;
      float shop = inCols * band(fx, 0.06, 0.94) * band(fy, 0.04, 0.7);
      float rnd = hash13(vec3(colId, seed, faceKey));
      // Dark glass with a dim, warm interior behind it; some shops lit brighter than others.
      vec3 interior = mix(vec3(0.03, 0.035, 0.04), vec3(0.16, 0.12, 0.08), rnd);
      // Thin vertical mullions splitting each shop window into panes.
      float pane = 1.0 - band(fract(fx * 3.0), 0.0, 0.04);
      col = mix(col, interior, shop * pane);
      facadeGlass = shop * pane;
      facadeEmissive = vec3(1.0, 0.8, 0.55) * 0.08 * rnd * shop * pane;

      // Muted shop sign band above the windows on some buildings.
      float signRnd = hash13(vec3(seed, faceKey, 7.0));
      vec3 hue = 0.5 + 0.5 * cos(6.2831 * (signRnd + vec3(0.0, 0.33, 0.67)));
      vec3 signCol = mix(vec3(0.2), hue, 0.55) * 0.35;
      float sign = inCols * band(fy, 0.8, 0.9) * step(0.45, signRnd);
      col = mix(col, signCol, sign);
    } else if (h < topH) {
      float vc = (h - groundH) / floorH;
      float floorId = floor(vc);
      float fy = fract(vc);
      // Slight floor-to-floor variation so large walls aren't perfectly flat.
      col = wall * (0.94 + 0.08 * hash13(vec3(floorId, seed, 3.0)));

      float w = inCols * band(fx, win.x, win.z) * band(fy, win.y, win.w);
      float rnd = hash13(vec3(colId, floorId, seed + faceKey));
      vec3 glass;
      if (style < 0.5) {
        glass = mix(vec3(0.06, 0.1, 0.13), vec3(0.1, 0.15, 0.18), rnd);
        // Spandrel band at each slab line is opaque.
        col = mix(col, wall * 1.4, band(fy, 0.0, 0.22) * inCols);
      } else {
        // Punched windows: mostly dark glass, some with warm curtains.
        glass = rnd > 0.8 ? vec3(0.24, 0.2, 0.15) : mix(vec3(0.03, 0.04, 0.05), vec3(0.09, 0.1, 0.12), rnd);
        if (style > 0.5 && style < 1.5) {
          // Stone surround and sill around brick windows.
          float frame = inCols * band(fx, win.x - 0.05, win.z + 0.05) * band(fy, win.y - 0.07, win.w + 0.04);
          col = mix(col, vec3(0.55, 0.52, 0.47), frame);
        }
      }
      col = mix(col, glass, w);
      facadeGlass = w;
      facadeGlassMetal = style < 0.5 ? 0.6 : 0.3;
    } else {
      // Parapet with a lighter coping stone along the top edge.
      col = mix(wall, vec3(0.5, 0.49, 0.46), band(h, vSize.y - 0.25, vSize.y + 1.0));
    }
    // Ambient-occlusion-ish darkening right at street level.
    col *= mix(0.7, 1.0, clamp(h / 3.0, 0.0, 1.0));
  }
  diffuseColor.rgb = col;
}
`;

export function createFacadeMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.0 });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
      .replace('#include <begin_vertex>', VERTEX_MAIN);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
      .replace('#include <color_fragment>', FRAGMENT_COLOR)
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.06, facadeGlass);',
      )
      .replace(
        '#include <metalnessmap_fragment>',
        '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, facadeGlassMetal, facadeGlass);',
      )
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += facadeEmissive;',
      );
  };
  return material;
}
