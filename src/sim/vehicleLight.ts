import * as THREE from 'three';

/**
 * One spotlight shared by whichever vehicle the player is in: headlights for the car,
 * a searchlight for the helicopter. It's created once and only moved/dimmed, because
 * adding or removing lights makes three.js recompile every material's shader.
 */
export class VehicleLight {
  private readonly spot: THREE.SpotLight;

  constructor(
    scene: THREE.Scene,
    /** 0 by day … 1 at night (from the day/night cycle). */
    private readonly night: () => number,
  ) {
    this.spot = new THREE.SpotLight(0xfff2dd, 0, 90, 0.5, 0.55, 1.6);
    scene.add(this.spot, this.spot.target);
  }

  /** Shine from `from` toward `to`; `strength` scales the night-time brightness. */
  aim(from: THREE.Vector3, to: THREE.Vector3, strength: number): void {
    this.spot.position.copy(from);
    this.spot.target.position.copy(to);
    this.spot.intensity = strength * this.night();
  }

  off(): void {
    this.spot.intensity = 0;
  }
}
