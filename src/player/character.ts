import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

interface CharacterSource {
  scene: THREE.Object3D;
  animations: THREE.AnimationClip[];
}

// Animated human model (three.js "Soldier" sample, rigged with Idle / Walk / Run clips).
//
// Purely visual: the physics capsule decides where the player is; this class only picks
// and blends animations from how fast the capsule actually moved, so walking into a wall
// stops the legs instead of moon-walking.
//
// Blending: idle→walk between 0 and WALK_ANIM_SPEED, walk→run between walk and run speed.
// Stride rate is scaled by (actual speed / speed the clip was authored at), which keeps
// feet planted instead of sliding over the ground.

const MODEL_URL = `${import.meta.env.BASE_URL}assets/characters/soldier.glb`;

// Ground speed each clip looks right at, in m/s: measured as how fast the planted foot
// slides backward relative to the body during ground contact, at playback rate 1.
export const WALK_ANIM_SPEED = 1.7;
export const RUN_ANIM_SPEED = 4.3;
const SPEED_SMOOTHING = 10; // 1/s; filters frame-to-frame jitter in measured speed

export class CharacterModel {
  readonly root: THREE.Object3D;
  private readonly mixer: THREE.AnimationMixer;
  private readonly idle: THREE.AnimationAction;
  private readonly walk: THREE.AnimationAction;
  private readonly run: THREE.AnimationAction;
  private speed = 0;
  private phase = 0;

  private constructor(
    gltf: CharacterSource,
    /** Untouched copy of the loaded model, used to make pedestrian clones. */
    private readonly template: CharacterSource,
  ) {
    this.root = gltf.scene;
    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        // Skinned meshes' bounds are computed from one pose and don't follow the animation,
        // so pad them generously; with that, off-screen characters can be culled (which
        // matters with a dozen pedestrians on a phone).
        const skinned = mesh as THREE.SkinnedMesh;
        if (skinned.isSkinnedMesh) {
          skinned.computeBoundingSphere();
          skinned.boundingSphere!.radius *= 1.6;
        }
      }
    });

    this.mixer = new THREE.AnimationMixer(this.root);
    const clip = (name: string) => {
      const c = gltf.animations.find((a) => a.name === name);
      if (!c) throw new Error(`Character is missing animation "${name}"`);
      const action = this.mixer.clipAction(c);
      action.play();
      return action;
    };
    this.idle = clip('Idle');
    this.walk = clip('Walk');
    this.run = clip('Run');
    this.walk.timeScale = 0; // driven manually through the shared stride phase
    this.run.timeScale = 0;
    this.setWeights(1, 0, 0);
  }

  /** The right-hand bone, for holding weapons (null if the rig doesn't have one). */
  rightHand(): THREE.Object3D | null {
    return this.root.getObjectByName('mixamorigRightHand') ?? null;
  }

  static async load(): Promise<CharacterModel> {
    const gltf = await new GLTFLoader().loadAsync(MODEL_URL);
    // Keep a pristine copy before the player's instance gets moved/parented.
    const template = { scene: cloneSkinned(gltf.scene), animations: gltf.animations };
    return new CharacterModel(gltf, template);
  }

  /**
   * An independent copy with its own skeleton and animation state (for pedestrians).
   * `tint` multiplies the outfit colours, so each copy can wear different colours.
   */
  clone(tint?: THREE.Color): CharacterModel {
    // SkeletonUtils.clone rebinds the copy's skinned meshes to its own copied bones.
    const scene = cloneSkinned(this.template.scene);
    if (tint) {
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const material = (mesh.material as THREE.MeshStandardMaterial).clone(); // clones share materials
        material.color.multiply(tint);
        mesh.material = material;
      });
    }
    return new CharacterModel({ scene, animations: this.template.animations }, this.template);
  }

  /**
   * @param groundSpeed horizontal speed the body actually moved at (m/s)
   * @param grounded    false while jumping/falling
   */
  update(groundSpeed: number, grounded: boolean, dt: number): void {
    this.speed += (groundSpeed - this.speed) * (1 - Math.exp(-SPEED_SMOOTHING * dt));
    const s = this.speed;

    let wWalk: number;
    let wRun: number;
    let walkRate: number; // playback-speed multipliers
    let runRate: number;
    if (s < WALK_ANIM_SPEED) {
      const t = s / WALK_ANIM_SPEED;
      wWalk = t;
      wRun = 0;
      walkRate = Math.max(0.6, t);
      runRate = 1;
    } else {
      const t = Math.min(1, (s - WALK_ANIM_SPEED) / (RUN_ANIM_SPEED - WALK_ANIM_SPEED));
      wWalk = 1 - t;
      wRun = t;
      walkRate = s / WALK_ANIM_SPEED;
      runRate = Math.max(0.7, s / RUN_ANIM_SPEED);
    }
    this.setWeights(1 - wWalk - wRun, wWalk, wRun);

    // Walk and run share one stride phase (0..1 = one full cycle). Both clips reach the same
    // foot position at the same fraction of their cycle (measured to within ~1%), so
    // blending between them never tangles the legs. The phase advances at
    // the weight-blended number of cycles per second of the two clips.
    const walkDur = this.walk.getClip().duration;
    const runDur = this.run.getClip().duration;
    const moving = wWalk + wRun;
    if (moving > 0) {
      const cyclesPerSecond = (wWalk * walkRate / walkDur + wRun * runRate / runDur) / moving;
      // No jump clip: nearly freeze the stride in the air so legs don't keep running.
      this.phase = (this.phase + cyclesPerSecond * dt * (grounded ? 1 : 0.2)) % 1;
    }
    this.walk.time = this.phase * walkDur;
    this.run.time = this.phase * runDur;
    this.mixer.update(dt); // advances idle; walk/run have timeScale 0 and are set above
  }

  private setWeights(idle: number, walk: number, run: number): void {
    this.idle.setEffectiveWeight(idle);
    this.walk.setEffectiveWeight(walk);
    this.run.setEffectiveWeight(run);
  }
}
