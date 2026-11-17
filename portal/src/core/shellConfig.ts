// Every tunable number of the shell (menus, dialogue, music, saves, editor, challenges). The
// simulation's numbers live in core/config.ts (workstream A); these are the shell's own.

export const SHELL = {
  storage: {
    /** localStorage keys (all start with "twinfold:"; the other games share the origin). */
    options: 'twinfold:options',
    bindings: 'twinfold:bindings',
    /** IndexedDB database and version. */
    db: 'twinfold',
    dbVersion: 1,
  },

  saves: {
    /** Manual save slots shown in the Save / Load screens. */
    manualSlots: 6,
  },

  dialogue: {
    /** Seconds per syllable of synthesised speech (the subtitle stays up while the voice talks). */
    syllableSeconds: 0.13,
    /** Extra pause after a comma / after a sentence end. */
    commaPause: 0.18,
    sentencePause: 0.34,
    /** Subtitles linger this long after the voice stops. */
    linger: 0.6,
    /** Silence between two queued lines. */
    gap: 0.35,
    /** A queued line older than this (s) is dropped unless its priority is at least `keepPriority`. */
    staleAfter: 12,
    keepPriority: 3,
    /** Priority at or above which a line cuts off the current one (it never plays over it). */
    interruptPriority: 5,
    /** Music and effects are multiplied by this while the overseer talks. */
    duck: 0.35,
    duckSeconds: 0.25,
    /** Voice: base pitch (Hz) and the scale the syllable pitches snap to (semitones from base). */
    basePitch: 168,
    scale: [0, 2, 3, 5, 7, 9, 10, 12],
    /** Closed captions disappear after this long. */
    captionSeconds: 2.2,
  },

  music: {
    /** Calm theme tempo (beats per minute) and elevator music tempo. */
    bpm: 84,
    elevatorBpm: 112,
    /** Notes are scheduled this far ahead of the audio clock (s); the scheduler wakes every tick. */
    lookahead: 0.35,
    tick: 0.1,
    /** Tension layer: fades towards its target at this rate (per second); decays after events. */
    tensionFade: 0.6,
    tensionHold: 6,
    /** Room tone level relative to the effects bus. */
    roomTone: 0.05,
  },

  hud: {
    /** Damage vignette: peak opacity and fade time (s). */
    vignetteMax: 0.75,
    vignetteFade: 0.9,
  },

  menu: {
    /** Animated background: rotation speed (rad/s) of the floating frames. */
    spin: 0.18,
  },

  editor: {
    /** Grid step (m). */
    grid: 0.5,
    /** Default height of a new brush (m) and default thickness of a floor slab. */
    brushHeight: 3,
    undoLimit: 200,
    /** Draft autosave delay after the last edit (ms). */
    draftDelay: 800,
  },

  challenges: {
    /** Leaderboard entries kept per chamber and mode. */
    leaderboardSize: 10,
  },

  options: {
    fovMin: 75,
    fovMax: 110,
    renderScaleMin: 0.5,
    renderScaleMax: 1.5,
    recursionMin: 1,
    recursionMax: 12,
  },

  gamepad: {
    /** Stick dead zone, and how many "pixels" of mouse motion full stick deflection gives per frame. */
    deadZone: 0.18,
    lookPixels: 14,
  },
} as const;
