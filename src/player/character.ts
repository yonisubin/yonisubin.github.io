import * as THREE from 'three';

// An animated person (player, pedestrian or mission giver). Purely visual: physics decides
// where they are; this class picks and blends animations.
//
// Layers:
//  • Legs and hips always play locomotion: idle → walk → run, blended by the ground speed
//    the body actually moved at (walking into a wall stops the legs). Walk and run share one
//    stride phase, and the stride rate is scaled by (actual speed ÷ the speed the clip was
//    made for), so feet stay planted.
//  • The upper body plays the same locomotion, unless something overrides it: aiming a gun
//    (held pose), a one-off action (punch, bat swing, shot, flinch, wave) or a gesture (talking).
//    Overrides fade in and out, and their weights always sum to 1 with the locomotion they
//    replace, so the blend never "averages" two poses by accident.
//  • Knocked down: one full-body fall, held on its last frame.
//
// Animations come from the shared Quaternius library (see characterLibrary.ts). Clip
// durations are retimed to match gameplay (e.g. a punch lasts as long as its cooldown).

// Ground speed each clip looks right at for a model at scale 1, m/s: measured as how fast a
// planted foot slides backward relative to the body during ground contact.
const WALK_CLIP_SPEED = 1.32;
const RUN_CLIP_SPEED = 3.02;
const SPEED_SMOOTHING = 10; // 1/s
const AIM_FADE = 8; // 1/s
const GESTURE_FADE = 5; // 1/s

export type Aim = 'none' | 'pistol' | 'rifle';
export type OneShot = 'punch' | 'bat' | 'shoot' | 'hit' | 'wave';

/** Bones belonging to the upper body (by the node names three.js gives them). */
const UPPER_BODY = /^(Torso|Chest|Neck|Head|Shoulder|UpperArm|LowerArm|Wrist|Index|Middle|Ring|Pinky|Thumb)/;

/** Split a clip into lower- and upper-body halves (cached: clips are shared by everyone). */
const halves = new WeakMap<THREE.AnimationClip, [THREE.AnimationClip, THREE.AnimationClip]>();
function split(clip: THREE.AnimationClip): [THREE.AnimationClip, THREE.AnimationClip] {
  let pair = halves.get(clip);
  if (!pair) {
    const upper = clip.tracks.filter((t) => UPPER_BODY.test(t.name.split('.')[0]));
    const lower = clip.tracks.filter((t) => !UPPER_BODY.test(t.name.split('.')[0]));
    pair = [new THREE.AnimationClip(`${clip.name}_lower`, clip.duration, lower), new THREE.AnimationClip(`${clip.name}_upper`, clip.duration, upper)];
    halves.set(clip, pair);
  }
  return pair;
}

/** One-off actions: which clip, and how long it should last in the game (s). */
const ONE_SHOTS: Record<OneShot, { clips: string[]; duration: number }> = {
  punch: { clips: ['Punch_Left', 'Punch_Right'], duration: 0.45 },
  bat: { clips: ['Sword_Slash'], duration: 0.65 },
  shoot: { clips: ['Idle_Gun_Shoot'], duration: 0.28 },
  hit: { clips: ['HitRecieve', 'HitRecieve_2'], duration: 0.45 },
  wave: { clips: ['Wave'], duration: 1.6 },
};

export class CharacterModel {
  /** Place this in the scene; its origin is at the feet. */
  readonly root = new THREE.Group();
  private readonly mixer: THREE.AnimationMixer;
  private readonly scale: number;

  // Locomotion, lower and upper halves.
  private readonly loco: Record<'idle' | 'walk' | 'run', [THREE.AnimationAction, THREE.AnimationAction]>;
  private readonly aims: Record<Exclude<Aim, 'none'>, THREE.AnimationAction>;
  private readonly talk: THREE.AnimationAction;
  private readonly death: THREE.AnimationAction;
  private readonly clips: Map<string, THREE.AnimationClip>;

  private speed = 0;
  private phase = 0;
  private aim: Aim = 'none';
  private aimWeight = 0;
  private aimShown: Exclude<Aim, 'none'> = 'pistol';
  private talking = false;
  private talkWeight = 0;
  private oneShot: { action: THREE.AnimationAction; t: number; duration: number } | null = null;
  private punchSide = 0;
  private downTime = -1; // −1 = standing

  constructor(
    private readonly scene: THREE.Object3D,
    clips: THREE.AnimationClip[],
    /** Model scale (target height ÷ authored height). */
    scale: number,
  ) {
    this.scale = scale;
    scene.scale.setScalar(scale);
    // Quaternius characters are authored facing +Z; the game's "forward" is −Z.
    scene.rotation.y = Math.PI;
    this.root.add(scene);
    this.mixer = new THREE.AnimationMixer(scene);
    this.clips = new Map(clips.map((c) => [c.name, c]));

    const action = (clip: THREE.AnimationClip, timeScale = 1) => {
      const a = this.mixer.clipAction(clip);
      a.timeScale = timeScale;
      a.setEffectiveWeight(0);
      a.play();
      return a;
    };
    const pair = (name: string, timeScale = 1): [THREE.AnimationAction, THREE.AnimationAction] => {
      const [lower, upper] = split(this.clip(name));
      return [action(lower, timeScale), action(upper, timeScale)];
    };
    // Walk and run are driven through the shared stride phase (timeScale 0, time set by hand).
    this.loco = { idle: pair('Idle'), walk: pair('Walk', 0), run: pair('Run', 0) };
    this.aims = { pistol: action(split(this.clip('Idle_Gun_Pointing'))[1]), rifle: action(split(this.clip('Idle_Gun'))[1]) };
    this.talk = action(split(this.clip('Interact'))[1]);
    this.death = action(this.clip('Death'), 0);
  }

  private clip(name: string): THREE.AnimationClip {
    const c = this.clips.get(name);
    if (!c) throw new Error(`Missing animation "${name}"`);
    return c;
  }

  /** The right-hand bone, for holding weapons. */
  rightHand(): THREE.Object3D | null {
    return this.scene.getObjectByName('WristR') ?? null;
  }

  /** Hold a gun pose on the upper body (or not). */
  setAim(aim: Aim): void {
    this.aim = aim;
    if (aim !== 'none') this.aimShown = aim;
  }

  /** Loop a talking gesture on the upper body (during a chat). */
  setTalking(talking: boolean): void {
    this.talking = talking;
  }

  /** Play a one-off action on the upper body, replacing any one in progress. */
  play(kind: OneShot): void {
    if (this.downTime >= 0) return;
    const spec = ONE_SHOTS[kind];
    let name = spec.clips[0];
    if (spec.clips.length > 1) {
      name = spec.clips[this.punchSide % spec.clips.length]; // alternate left/right punches
      this.punchSide++;
    }
    if (this.oneShot) this.oneShot.action.setEffectiveWeight(0);
    const a = this.mixer.clipAction(split(this.clip(name))[1]);
    a.timeScale = 0; // time set by hand below
    a.play();
    this.oneShot = { action: a, t: 0, duration: spec.duration };
  }

  /** Fall over (knocked out); stays down until reset(). */
  knockDown(): void {
    if (this.downTime < 0) this.downTime = 0;
    this.oneShot = null;
  }

  get isDown(): boolean {
    return this.downTime >= 0;
  }

  /** Back to normal (respawn). */
  reset(): void {
    this.downTime = -1;
    this.oneShot = null;
    this.talking = false;
    this.talkWeight = 0;
  }

  /**
   * @param groundSpeed horizontal speed the body actually moved at (m/s)
   * @param grounded    false while jumping/falling
   */
  update(groundSpeed: number, grounded: boolean, dt: number): void {
    // --- Knocked down: only the fall plays, held on its last frame.
    if (this.downTime >= 0) {
      this.downTime += dt;
      for (const [lower, upper] of Object.values(this.loco)) {
        lower.setEffectiveWeight(0);
        upper.setEffectiveWeight(0);
      }
      for (const a of Object.values(this.aims)) a.setEffectiveWeight(0);
      this.talk.setEffectiveWeight(0);
      this.death.setEffectiveWeight(1);
      this.death.time = Math.min(this.downTime * 1.2, this.death.getClip().duration - 0.01);
      this.mixer.update(dt);
      return;
    }
    this.death.setEffectiveWeight(0);

    // --- Locomotion weights from (smoothed) ground speed. Clip speeds scale with the model.
    this.speed += (groundSpeed - this.speed) * (1 - Math.exp(-SPEED_SMOOTHING * dt));
    const s = this.speed;
    const walkSpeed = WALK_CLIP_SPEED * this.scale;
    const runSpeed = RUN_CLIP_SPEED * this.scale;
    let wWalk: number;
    let wRun: number;
    let walkRate: number;
    let runRate: number;
    if (s < walkSpeed) {
      const t = s / walkSpeed;
      wWalk = t;
      wRun = 0;
      walkRate = Math.max(0.6, t);
      runRate = 1;
    } else {
      const t = Math.min(1, (s - walkSpeed) / (runSpeed - walkSpeed));
      wWalk = 1 - t;
      wRun = t;
      walkRate = s / walkSpeed;
      runRate = Math.max(0.7, s / runSpeed);
    }
    const wIdle = 1 - wWalk - wRun;

    // Walk and run share one stride phase so blending between them never tangles the legs.
    const walkDur = this.loco.walk[0].getClip().duration;
    const runDur = this.loco.run[0].getClip().duration;
    const moving = wWalk + wRun;
    if (moving > 0) {
      const cyclesPerSecond = ((wWalk * walkRate) / walkDur + (wRun * runRate) / runDur) / moving;
      // No jump clip: nearly freeze the stride in the air.
      this.phase = (this.phase + cyclesPerSecond * dt * (grounded ? 1 : 0.2)) % 1;
    }
    for (const a of this.loco.walk) a.time = this.phase * walkDur;
    for (const a of this.loco.run) a.time = this.phase * runDur;

    // --- Upper-body overrides: aim (held), talk (gesture), one-shot (on top of both).
    this.aimWeight += ((this.aim !== 'none' ? 1 : 0) - this.aimWeight) * (1 - Math.exp(-AIM_FADE * dt));
    this.talkWeight += ((this.talking ? 1 : 0) - this.talkWeight) * (1 - Math.exp(-GESTURE_FADE * dt));
    let shot = 0;
    if (this.oneShot) {
      const o = this.oneShot;
      o.t += dt;
      // Quick fade in, then out at the end.
      shot = Math.min(1, o.t / 0.07) * Math.min(1, Math.max(0, (o.duration - o.t) / 0.12));
      o.action.time = Math.min(1, o.t / o.duration) * (o.action.getClip().duration - 0.01);
      o.action.setEffectiveWeight(shot);
      if (o.t >= o.duration) {
        o.action.setEffectiveWeight(0);
        this.oneShot = null;
        shot = 0;
      }
    }
    const hold = Math.min(1, this.aimWeight + this.talkWeight) * (1 - shot);
    const aimPart = this.aimWeight + this.talkWeight > 0 ? (this.aimWeight / (this.aimWeight + this.talkWeight)) * hold : 0;
    const talkPart = hold - aimPart;
    const upperLoco = 1 - shot - hold;

    for (const [name, w] of [['idle', wIdle], ['walk', wWalk], ['run', wRun]] as const) {
      this.loco[name][0].setEffectiveWeight(w);
      this.loco[name][1].setEffectiveWeight(w * upperLoco);
    }
    this.aims.pistol.setEffectiveWeight(this.aimShown === 'pistol' ? aimPart : 0);
    this.aims.rifle.setEffectiveWeight(this.aimShown === 'rifle' ? aimPart : 0);
    this.talk.setEffectiveWeight(talkPart);
    this.mixer.update(dt);
  }
}
