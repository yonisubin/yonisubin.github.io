// Every tunable number in Twinfold lives here (spec: "keep them in a config file and tune by
// playtesting"). SI units: metres, seconds, radians. Y is up.

export const CONFIG = {
  physics: {
    /** Fixed physics rate (Hz). Rendering interpolates between steps. */
    hz: 60,
    /** Never run more than this many steps per rendered frame (avoids a death spiral). */
    maxStepsPerFrame: 8,
  },

  player: {
    height: 1.83,
    eyeHeight: 1.63,
    crouchHeight: 0.9,
    /** Eye sits this far below the top of the capsule when crouched. */
    crouchEyeFromTop: 0.2,
    radius: 0.3,
    /** One speed, no sprint. */
    walkSpeed: 4.5,
    crouchSpeedFactor: 1 / 3,
    jumpHeight: 1.1,
    /** Slightly lighter than Earth's 9.81 so jumps feel floaty. */
    gravity: 11.5,
    /** Terminal velocity: caps the speed built in an infinite fall. */
    maxFallSpeed: 38,
    stepHeight: 0.45,
    /** Riding a platform, the feet stay this much more than the KCC skin above its top. */
    rideClearance: 0.004,
    /** Ground acceleration towards the wished velocity; also how fast friction stops you. */
    groundAccel: 45,
    /** Air control: small acceleration toward input. It may steer but never slow you down. */
    airAccel: 9,
    /** Air control can push you up to this horizontal speed, never beyond. */
    airMaxSpeed: 4.5,
    /** How fast the eye glides between standing and crouched heights (m/s). */
    crouchEyeSpeed: 4,
    /** Below this, falling out of the world restarts you at the spawn. */
    killY: -60,
    /** KCC skin: the gap Rapier keeps between the capsule and the world. */
    skin: 0.02,
    maxSlope: (50 * Math.PI) / 180,
    /** How heavy the player is when pushing props around (kg). */
    mass: 80,
  },

  camera: {
    fov: 90,
    near: 0.05,
    far: 400,
    mouseSensitivity: 0.0022,
    /** After leaving a portal on a wall/ceiling the camera rolls back upright over this time. */
    rollRecoverySeconds: 0.5,
    /** "Reduce camera roll" setting: the recovery takes this fraction of the time. */
    reducedRollFactor: 0.25,
    /** Pitch limit, just short of straight up/down. */
    maxPitch: (89 * Math.PI) / 180,
  },

  portal: {
    width: 1.2,
    height: 2.1,
    /** If a portal doesn't fit where you aimed, it may slide up to this far to fit (just over half
     *  its height, so a shot at the very bottom of a wall still lands on the floor line). */
    nudgeMax: 1.1,
    /** Max portal shot distance. */
    range: 200,
    /** Thickness of the invisible tunnel around the hole (stops you slipping sideways into the wall). */
    tunnelWall: 1.0,
    /** How deep the tunnel and the render box reach behind the surface. */
    tunnelDepth: 2.6,
    /** Render: the opening is drawn this far in front of the surface (beats z-fighting). */
    surfaceOffset: 0.01,
    /** Render: the oblique clip plane sits this far in front of the exit surface. */
    clipOffset: 0.004,
    /** Render: rounded corners of the opening's shape. */
    cornerRadius: 0.42,
    /** Max portal-in-portal recursion when rendering (falls back to a flat colour at the limit). */
    recursionDepth: 9,
    /** Leaving a floor portal you always get at least this much speed along its normal, so you
     *  clear the hole instead of falling straight back in (enough to lift the feet past the rim). */
    floorExitMinSpeed: 6.6,
    /** Two portal colours: original, strongly contrasting and colourblind-safe (blue vs orange-amber
     *  differ in both hue and lightness). */
    colors: { a: 0x2f8cff, b: 0xffa31a },
  },

  /** Physics props (phase 5). Sizes in metres, masses in kg. */
  props: {
    cubeSize: 0.65,
    cubeMass: 30,
    sphereRadius: 0.32,
    sphereMass: 25,
    debrisMass: 6,
    friction: 0.7,
    restitution: 0.05,
    sphereRestitution: 0.25,
    linearDamping: 0.05,
    angularDamping: 0.4,
    /** Props never go faster than this (the same terminal velocity as the player). */
    maxSpeed: 38,
    /** Leaving a floor portal a prop gets at least this much speed along the exit normal. */
    floorExitMinSpeed: 5,
    /** Below this height a lost prop goes back to where it started. */
    killY: -60,
  },

  carry: {
    /** How far in front of the eye a held prop floats (spec: about 1 m). */
    holdDistance: 1.2,
    /** The hold point sits this far below the eye line so the prop doesn't fill the view. */
    holdDrop: 0.3,
    /** Use reach (pick up, press buttons). */
    useRange: 2.2,
    /** Velocity servo: the prop moves toward the hold point at (gap · gain) m/s, capped. */
    gain: 14,
    maxSpeed: 16,
    /** Angular servo toward the held yaw (rad/s per rad of error), capped. */
    turnGain: 12,
    maxTurn: 12,
    /** Forced this far from the hold point (stuck behind something) → it drops. */
    dropDistance: 1.5,
    /** A dropped prop keeps its velocity, up to this. */
    releaseMaxSpeed: 8,
  },

  health: {
    max: 100,
    /** Regeneration starts this long after the last damage... */
    regenDelay: 2.5,
    /** ...and refills at this rate (hp/s). */
    regenRate: 30,
    /** From death to standing again at the last autosave (spec: under 2 s). */
    respawnDelay: 1.2,
  },

  session: {
    /** No input for this long → `idle` (repeats every time this much more passes). */
    idleSeconds: 20,
    /** A footstep every this many metres walked. */
    stepLength: 1.6,
    /** Bottomless pits: falling this far below the lowest brush top kills. */
    pitDepth: 8,
    /** Outside the chamber's bounding box by more than this → `outOfBounds`. */
    boundsMargin: 0.5,
  },

  elements: {
    buttonRadius: 0.75,
    buttonHeight: 0.12,
    /** How far the plate sinks when pressed. */
    buttonTravel: 0.07,
    /** Things heavier than a footstep: the plate's sensor reaches this high above it. */
    buttonSense: 0.35,
    pedestalHeight: 1.1,
    doorWidth: 2.4,
    doorHeight: 3,
    doorThickness: 0.2,
    /** Seconds to open or close. */
    doorTime: 0.6,
    platformSize: [2.5, 0.3, 2.5] as [number, number, number],
    platformSpeed: 2,
    liftSize: [2.5, 0.3, 2.5] as [number, number, number],
    liftSpeed: 2,
    panelSize: [2, 2, 0.3] as [number, number, number],
    panelSpeed: 1.5,
    /** Seconds per position of a cycling fixed portal. */
    fixedPortalPeriod: 3,
    elevatorRadius: 1.2,
    elevatorHeight: 3,
    /** Seconds before the entry elevator's door opens. */
    entryDoorDelay: 0.6,
    /** Exit ride length before `elevatorDone`. */
    rideSeconds: 3,
    indicatorWidth: 0.14,
    signSize: [1.6, 2.4] as [number, number],
    /** Chambers in the main track (the info sign's progress bar). */
    chamberCount: 19,
    /** Gate timer default (seconds an input pulse is held). */
    gateSeconds: 3,
  },

  hazards: {
    pelletRadius: 0.2,
    pelletSpeed: 7,
    pelletLife: 10,
    /** After a pellet dies the launcher waits this long before firing a new one. */
    pelletRespawn: 1.5,
    catcherRadius: 0.55,
    grillThickness: 0.1,
    /** A side change bigger than this in one step was a teleport, not a walk through the grill. */
    grillMaxStep: 1.5,
    crusherPeriod: 3,
    crusherSize: [2, 3, 0.6] as [number, number, number],
    /** A turret hitting something faster than this breaks. */
    breakSpeed: 11,
    /** Dissolve effect length. */
    dissolveSeconds: 0.7,
  },

  turret: {
    /** Body: radius / height of the capsule-shaped shell. */
    radius: 0.3,
    height: 1.2,
    mass: 35,
    /** Full cone angle (spec ~60°) and range. */
    cone: (60 * Math.PI) / 180,
    range: 30,
    /** Idle sweep of the laser sight (± radians, rad/s). */
    sweep: 0.35,
    sweepSpeed: 0.8,
    /** Wind-up between spotting you and the first shot. */
    windup: 0.45,
    /** Bullets per burst, shots per second, pause between bursts. */
    burst: 6,
    fireRate: 12,
    burstPause: 0.5,
    /** Damage per bullet: 4–10 % of the player's health. */
    damageMin: 4,
    damageMax: 10,
    /** Searching after losing you. */
    searchSeconds: 3,
    /** Tipped: fires wildly this long, then shuts down. */
    tippedSeconds: 1.5,
    /** Knocked over when its up axis leans more than this. */
    tipAngle: (50 * Math.PI) / 180,
  },

  rocket: {
    speed: 6,
    /** Max turn rate toward the target (rad/s): homing-ish, easy to dodge and redirect. */
    turnRate: 0.9,
    /** After a portal pass the rocket flies straight this long (so redirecting it works). */
    straightAfterPortal: 1.5,
    radius: 0.15,
    blastRadius: 2.2,
    damage: 60,
    reload: 4,
    life: 12,
    /** The launcher needs to see you this long before it fires. */
    lockTime: 1,
  },

  boss: {
    stages: 3,
  },

  assist: {
    /** Slow motion during flings: time scale while airborne faster than flingSpeed after a pass. */
    timeScale: 0.5,
    flingSpeed: 9,
    /** Wider placement tolerance: nudge search radius with the assist on. */
    nudgeMax: 1.8,
  },

  debug: {
    /** Toggle key for the debug overlay lives in input/; this only sets the default. */
    overlay: false,
  },
} as const;

export type PortalId = 'a' | 'b';

/** Jump take-off speed for the configured jump height: v = sqrt(2 g h). */
export const JUMP_SPEED = Math.sqrt(2 * CONFIG.player.gravity * CONFIG.player.jumpHeight);
export const STEP_DT = 1 / CONFIG.physics.hz;
