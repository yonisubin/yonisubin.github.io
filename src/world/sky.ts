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

  // Bake the environment map from a separate small sky at the origin.
  const envScene = new THREE.Scene();
  const envSky = new Sky();
  envSky.scale.setScalar(50);
  configureSky(envSky, sunDirection);
  envScene.add(envSky);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(envScene, 0, 0.1, 100).texture;
  // The Sky shader is very bright (HDR), so its environment light is scaled down hard;
  // otherwise it drowns out the sun and shadows disappear.
  scene.environmentIntensity = 0.12;
  pmrem.dispose();
  envSky.geometry.dispose();
  envSky.material.dispose();

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

  scene.add(new THREE.HemisphereLight(0xc4d8ee, 0x5a5048, 0.5));

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
