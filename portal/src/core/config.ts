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
  },

  camera: {
    fov: 90,
    near: 0.05,
    far: 400,
    mouseSensitivity: 0.0022,
    /** After leaving a portal on a wall/ceiling the camera rolls back upright over this time. */
    rollRecoverySeconds: 0.5,
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

  debug: {
    /** Toggle key for the debug overlay lives in input/; this only sets the default. */
    overlay: false,
  },
} as const;

export type PortalId = 'a' | 'b';

/** Jump take-off speed for the configured jump height: v = sqrt(2 g h). */
export const JUMP_SPEED = Math.sqrt(2 * CONFIG.player.gravity * CONFIG.player.jumpHeight);
export const STEP_DT = 1 / CONFIG.physics.hz;
