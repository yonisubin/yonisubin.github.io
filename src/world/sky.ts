import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

// Physically based sky (three.js Sky: Rayleigh + Mie scattering) and a matching sun.
// The same sky is baked once into a prefiltered environment map (PMREM) used for
// image-based lighting, so glass and other surfaces reflect a sky that matches the background.

// A high sun keeps street-level shadows short enough that streets aren't all in shade.
const SUN_ELEVATION = 58; // degrees above the horizon
const SUN_AZIMUTH = 125; // degrees around the vertical axis

export interface SkyRig {
  sun: THREE.DirectionalLight;
  /** Unit vector pointing from the ground toward the sun. */
  sunDirection: THREE.Vector3;
  /** Keep the sky dome and the sun's shadow area centred on `focus` (usually the player). */
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
  const sunDirection = new THREE.Vector3().setFromSphericalCoords(
    1,
    THREE.MathUtils.degToRad(90 - SUN_ELEVATION),
    THREE.MathUtils.degToRad(SUN_AZIMUTH),
  );

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
  scene.fog = new THREE.Fog(0xb9c6d2, 150, 750);

  const sun = new THREE.DirectionalLight(0xfff1dc, 3.2);
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
  scene.add(new THREE.HemisphereLight(0xc4d8ee, 0x5a5048, 1.5));

  const SUN_DISTANCE = 200;
  return {
    sun,
    sunDirection,
    update(camera, focus) {
      sky.position.copy(camera.position);
      // The shadow map only covers ±70 m, so move the light with the player.
      // Moving in whole shadow-map texel steps reduces shadow edges shimmering as we move.
      const texel = (cam.right - cam.left) / sun.shadow.mapSize.x;
      const fx = Math.round(focus.x / texel) * texel;
      const fz = Math.round(focus.z / texel) * texel;
      sun.target.position.set(fx, 0, fz);
      sun.position.set(fx, 0, fz).addScaledVector(sunDirection, SUN_DISTANCE);
    },
  };
}
