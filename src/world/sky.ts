import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

// Physically based sky (three.js Sky: Rayleigh + Mie scattering) with a sun that moves
// through the day. One directional light is the sun by day and the moon by night.
// Image-based light (reflections, soft sky light) comes from a baked gradient environment
// map whose intensity, plus the fill light and fog colour, follow the time of day.

// Sun path: at noon the sun is NOON_ELEVATION° up, toward NOON_AZIMUTH. Through the day it
// turns about a tilted "pole" axis (perpendicular to both the noon direction and the
// horizontal east–west line), so it rises at 06:00, sets at 18:00 and is as far below the
// horizon at midnight as it is above it at noon.
const NOON_ELEVATION = 58; // degrees
const NOON_AZIMUTH = 125; // degrees around the vertical axis
const SUN_INTENSITY = 3.2;
const MOON_INTENSITY = 0.45;
const HEMI_DAY = 1.5;
const HEMI_NIGHT = 0.45;

export interface Lighting {
  /** 0 at night … 1 in full daylight. */
  daylight: number;
  /** 0 by day … 1 when street lights and windows should be fully on. */
  night: number;
}

export interface SkyRig {
  sun: THREE.DirectionalLight;
  /** Set the time of day (hours, 0–24) and return how light/dark it is. */
  setTime(hours: number): Lighting;
  /** Keep the sky dome and the light's shadow area centred on `focus` (usually the player). */
  update(camera: THREE.Camera, focus: THREE.Vector3): void;
}

const ENV_INTENSITY = 3.0; // tuned to match the brightness of the earlier sky-baked lighting

/** Prefiltered environment map from a sky-blue-to-ground gradient, all values ≤ 1. */
function bakeGradientEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const envScene = new THREE.Scene();
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(50, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        zenith: { value: new THREE.Color(0.18, 0.32, 0.6) },
        horizon: { value: new THREE.Color(0.62, 0.68, 0.74) },
        ground: { value: new THREE.Color(0.2, 0.19, 0.17) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 zenith, horizon, ground;
        varying vec3 vDir;
        void main() {
          float y = vDir.y;
          vec3 c = y > 0.0
            ? mix(horizon, zenith, pow(y, 0.6))
            : mix(horizon, ground, pow(-y, 0.4));
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  );
  envScene.add(dome);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(envScene, 0, 0.1, 100).texture;
  pmrem.dispose();
  dome.geometry.dispose();
  dome.material.dispose();
  return texture;
}

function configureSky(sky: Sky, sunDirection: THREE.Vector3): void {
  const u = sky.material.uniforms;
  u.turbidity.value = 4;
  u.rayleigh.value = 1.2;
  u.mieCoefficient.value = 0.004;
  u.mieDirectionalG.value = 0.8;
  u.sunPosition.value.copy(sunDirection);
}

export function createSky(renderer: THREE.WebGLRenderer, scene: THREE.Scene): SkyRig {
  const noon = new THREE.Vector3().setFromSphericalCoords(
    1,
    THREE.MathUtils.degToRad(90 - NOON_ELEVATION),
    THREE.MathUtils.degToRad(NOON_AZIMUTH),
  );
  // East–west: horizontal and perpendicular to the noon bearing. The sun's daily circle
  // passes through noon and both ends of this line (sunrise and sunset), so it turns about
  // the circle's normal, noon × eastWest.
  const eastWest = new THREE.Vector3(noon.z, 0, -noon.x).normalize();
  const axis = new THREE.Vector3().crossVectors(noon, eastWest).normalize();
  const sunDirection = noon.clone();

  // Visible sky dome. It must sit inside the camera's far plane, so it's moderately sized
  // and follows the camera every frame (only the view direction matters to the shader).
  const sky = new Sky();
  sky.scale.setScalar(900);
  configureSky(sky, sunDirection);
  scene.add(sky);

  // Bake the environment map (used for reflections and soft sky light) from a plain
  // low-intensity gradient, NOT from the Sky shader: the Sky's sun disc is ~19 000× too
  // bright for the half-float textures phone GPUs use, overflows to infinity there, and
  // turns every upward-facing surface black. The sun's light comes from `sun` below.
  scene.environment = bakeGradientEnvironment(renderer);
  scene.environmentIntensity = ENV_INTENSITY;

  // Haze toward the horizon hides the edge of the city.
  const fog = new THREE.Fog(0xb9c6d2, 150, 750);
  scene.fog = fog;
  // Behind the sky dome: shows through once the dome is hidden at night (the scattering
  // sky shader goes pitch black without a sun), as a deep navy matching the night fog.
  const background = new THREE.Color(0x0d1320);
  scene.background = background;

  const sun = new THREE.DirectionalLight(0xfff1dc, SUN_INTENSITY);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const cam = sun.shadow.camera;
  cam.left = -70;
  cam.right = 70;
  cam.top = 70;
  cam.bottom = -70;
  cam.near = 1;
  cam.far = 500;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.05;
  scene.add(sun, sun.target);

  // Sky/ground fill light; keeps shaded streets readable instead of murky.
  const hemi = new THREE.HemisphereLight(0xc4d8ee, 0x5a5048, HEMI_DAY);
  scene.add(hemi);

  // Colours by time of day.
  const fogDay = new THREE.Color(0xb9c6d2);
  const fogDusk = new THREE.Color(0xc9a58c);
  const fogNight = new THREE.Color(0x0d1320);
  const hemiDay = new THREE.Color(0xc4d8ee);
  const hemiNight = new THREE.Color(0x30406a);
  const sunNoon = new THREE.Color(0xfff1dc);
  const sunLow = new THREE.Color(0xff9a52);
  const moonColor = new THREE.Color(0x9fb4e8);
  const lightDirection = new THREE.Vector3();

  const SUN_DISTANCE = 200;
  return {
    sun,
    setTime(hours) {
      // Hour angle: 0 at noon, ±π at midnight.
      const h = ((hours - 12) / 12) * Math.PI;
      sunDirection.copy(noon).applyAxisAngle(axis, h);
      sky.material.uniforms.sunPosition.value.copy(sunDirection);

      const y = sunDirection.y; // sine of the sun's elevation
      const daylight = THREE.MathUtils.smoothstep(y, -0.08, 0.2);
      const night = 1 - THREE.MathUtils.smoothstep(y, -0.12, 0.06);
      // Near the horizon the sun is orange (more atmosphere to shine through).
      const low = 1 - THREE.MathUtils.smoothstep(y, 0.02, 0.35);

      // One light: the sun while it's up, otherwise the moon (opposite the sun).
      // Both fade to zero around the switch, so there's no visible jump.
      if (y > -0.05) {
        lightDirection.copy(sunDirection);
        sun.intensity = SUN_INTENSITY * THREE.MathUtils.smoothstep(y, -0.05, 0.12);
        sun.color.copy(sunNoon).lerp(sunLow, low);
      } else {
        lightDirection.copy(sunDirection).negate();
        sun.intensity = MOON_INTENSITY * THREE.MathUtils.smoothstep(-y, 0.05, 0.3);
        sun.color.copy(moonColor);
      }

      scene.environmentIntensity = ENV_INTENSITY * THREE.MathUtils.lerp(0.06, 1, daylight);
      hemi.intensity = THREE.MathUtils.lerp(HEMI_NIGHT, HEMI_DAY, daylight);
      hemi.color.copy(hemiNight).lerp(hemiDay, daylight);
      fog.color.copy(fogNight).lerp(fogDay, daylight).lerp(fogDusk, low * daylight * 0.6);
      // Night: hide the (black) scattering sky and show the navy background instead.
      sky.visible = daylight > 0.04;
      background.copy(fogNight);
      return { daylight, night };
    },
    update(camera, focus) {
      sky.position.copy(camera.position);
      // The shadow map only covers ±70 m, so move the light with the player.
      // Moving in whole shadow-map texel steps reduces shadow edges shimmering as we move.
      const texel = (cam.right - cam.left) / sun.shadow.mapSize.x;
      const fx = Math.round(focus.x / texel) * texel;
      const fz = Math.round(focus.z / texel) * texel;
      sun.target.position.set(fx, 0, fz);
      sun.position.set(fx, 0, fz).addScaledVector(lightDirection, SUN_DISTANCE);
    },
  };
}
