import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Input } from '../input/actions';
import type { Pedestrians } from '../npc/pedestrians';
import type { PlayerStats } from './stats';

// On-foot combat. Melee weapons hit the nearest pedestrian in a cone in front of the
// player; guns fire a ray from the camera through the centre of the screen (where the
// crosshair is), stopped by the first wall. Shots leave a brief tracer and muzzle flash.
// Violence alarms nearby pedestrians, who run off.

const MELEE_ALARM_RADIUS = 12; // m
const GUN_ALARM_RADIUS = 45; // m
const TRACER_TIME = 0.07; // s
const TOUCH_AIM_ASSIST = Math.cos(THREE.MathUtils.degToRad(7)); // cone for tap-to-shoot on phones

export interface AttackEvent {
  /** Unit vector the player should face (horizontal). */
  facing: THREE.Vector3;
  melee: boolean;
}

export class Combat {
  private cooldown = 0;
  private readonly tracers: { line: THREE.Line; life: number }[] = [];
  private readonly flash: THREE.Mesh;
  private flashLife = 0;
  private readonly tracerMaterial = new THREE.LineBasicMaterial({
    color: 0xfff2b0,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  private outOfAmmoShown = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly world: RAPIER.World,
    private readonly camera: THREE.Camera,
    private readonly input: Input,
    private readonly stats: PlayerStats,
    private readonly peds: Pedestrians | null,
    private readonly touch: boolean,
    /** Short on-screen message. */
    private readonly notify: (text: string) => void,
  ) {
    this.flash = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.flash.visible = false;
    scene.add(this.flash);
  }

  /**
   * Called every physics step while on foot. Returns an event when an attack happened
   * (so the player can turn to face it), otherwise null.
   * @param chest   player's chest position (melee origin)
   * @param exclude the player's own collider (ignored by bullets)
   */
  update(dt: number, chest: THREE.Vector3, exclude: RAPIER.Collider): AttackEvent | null {
    this.cooldown = Math.max(0, this.cooldown - dt);
    const w = this.stats.weapon;
    const pressed = this.input.consumePressed('attack');
    const wants = w.auto ? this.input.isDown('attack') || pressed : pressed;
    if (!wants || this.cooldown > 0) return null;
    this.cooldown = w.cooldown;

    const view = this.camera.getWorldDirection(new THREE.Vector3());
    const facing = new THREE.Vector3(view.x, 0, view.z).normalize();

    if (w.melee) {
      const target = this.peds?.meleeTarget(chest, facing, w.range) ?? null;
      if (target) this.peds!.damage(target, w.damage, 'melee');
      if (target || w.id !== 'fists') this.peds?.alarm(chest, MELEE_ALARM_RADIUS);
      return { facing, melee: true };
    }

    if (this.stats.ammo[w.id] <= 0) {
      if (this.outOfAmmoShown <= 0) {
        this.notify('Out of ammo — buy more at Guns & Ammo');
        this.outOfAmmoShown = 1;
      }
      this.cooldown = 0.4;
      return null;
    }
    this.outOfAmmoShown = 0;
    this.stats.ammo[w.id]--;

    // Aim: from the camera through the screen centre. On touch screens, snap to a nearby
    // pedestrian in a small cone, since precise aiming with a thumb is hard.
    const origin = this.camera.position.clone();
    let dir = view.clone();
    if (this.touch && this.peds) {
      const assist = this.peds.aimAssist(origin, dir, w.range, TOUCH_AIM_ASSIST);
      if (assist) dir = assist.currPos.clone().add(new THREE.Vector3(0, 1.1, 0)).sub(origin).normalize();
    }
    // The camera sits behind the player, so start the ray level with the player to avoid
    // hitting things between the camera and the player.
    const skip = Math.max(0, origin.distanceTo(chest) - 0.5);
    const start = origin.clone().addScaledVector(dir, skip);
    const wallHit = this.world.castRay(new RAPIER.Ray(start, dir), w.range, true, undefined, undefined, exclude);
    const wallDist = wallHit ? wallHit.timeOfImpact : w.range;
    const pedHit = this.peds?.raycast(start, dir, wallDist) ?? null;
    if (pedHit) this.peds!.damage(pedHit.ped, w.damage, 'gun');
    const hitDist = pedHit ? pedHit.dist : wallDist;
    const end = start.clone().addScaledVector(dir, hitDist);

    // Muzzle at the player's hands, a little toward the target.
    const muzzle = chest.clone().addScaledVector(facing, 0.55);
    muzzle.y += 0.25;
    this.addTracer(muzzle, end);
    this.flash.position.copy(muzzle);
    this.flash.visible = true;
    this.flashLife = 0.05;
    this.peds?.alarm(chest, GUN_ALARM_RADIUS);
    return { facing, melee: false };
  }

  private addTracer(from: THREE.Vector3, to: THREE.Vector3): void {
    const geometry = new THREE.BufferGeometry().setFromPoints([from, to]);
    const line = new THREE.Line(geometry, this.tracerMaterial);
    this.scene.add(line);
    this.tracers.push({ line, life: TRACER_TIME });
  }

  /** Fade effects. Call every frame. */
  render(frameDt: number): void {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= frameDt;
      if (t.life <= 0) {
        this.scene.remove(t.line);
        t.line.geometry.dispose();
        this.tracers.splice(i, 1);
      }
    }
    this.flashLife -= frameDt;
    this.flash.visible = this.flashLife > 0;
  }
}
