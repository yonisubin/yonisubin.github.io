import type { Look } from '../player/characterLibrary';
import type { WeaponId } from '../game/stats';

// The data the story is written in (story/script.ts) and read by the director
// (story/director.ts). Writing more story means adding to the script, not to the engine.

export type CharId = 'rico' | 'dolores' | 'kane' | 'tommy' | 'jules' | 'hank' | 'nina';

/** Named places in the world, resolved to real spots when the game starts (story/places.ts). */
export type PlaceId =
  | 'bus'
  | 'garage'
  | 'diner'
  | 'customer'
  | 'gunstore'
  | 'bank'
  | 'kane'
  | 'kaneRoof'
  | 'shack'
  | 'beach'
  | 'farm'
  | 'police'
  | 'helipad'
  | 'lakeDock'
  | 'lakeFar'
  | 'lakeHide'
  | 'motel'
  | 'pier';

/** Everything the story remembers: missions done and the choices you made. */
export interface StoryState {
  done: ReadonlySet<string>;
  flags: Readonly<Record<string, string | boolean>>;
}

export type Cond = (s: StoryState) => boolean;

export interface CharacterSpec {
  id: CharId;
  name: string;
  /** Name colour in dialogue and on the phone. */
  color: string;
  look: Look;
  /** Where they stand, first matching entry wins; none matching = not in the world. */
  spots: { at: PlaceId; when?: Cond }[];
}

/** One line of dialogue. `who` is a character, or 'you'. Lines with `when` only play if it holds. */
export interface Line {
  who: CharId | 'you';
  text: string;
  when?: Cond;
}

export interface ChoiceOption {
  label: string;
  /** Flags set when picked. */
  set: Record<string, string | boolean>;
  /** Lines played right after picking it. */
  reply?: Line[];
}

/** A phone message: a text (shown for a few seconds) or a call (lines as subtitles). */
export interface PhoneSpec {
  from: CharId;
  call?: boolean;
  lines: string[];
  /** Seconds after it's triggered. */
  delay?: number;
  when?: Cond;
}

/** One step of a story mission. The director runs them in order (story/steps.ts). */
export type StepSpec =
  /** A dialogue scene, camera on the speaker if they're nearby; an optional choice at the end. */
  | { kind: 'scene'; with?: CharId; lines: Line[]; choice?: ChoiceOption[] }
  /** Get to a place (any way, on foot, or in a car / boat / helicopter). */
  | { kind: 'goto'; to: PlaceId; text: string; radius?: number; by?: 'foot' | 'car' | 'boat' | 'heli' }
  /** Get into a vehicle of this kind (the nearest one is marked). */
  | { kind: 'enter'; vehicle: 'car' | 'taxi' | 'boat' | 'heli'; text: string }
  /** Drive to a place; optional time limit and crash limit (hard crashes ≥ 5 damage). */
  | { kind: 'drive'; to: PlaceId; text: string; time?: number; maxCrashes?: number; radius?: number }
  /** Mark a traffic car 90–260 m away as the story's car `car` (Kane's car, the repo car…). */
  | { kind: 'markCar'; car: string; min?: number; max?: number }
  /** Carjack the marked car. */
  | { kind: 'jack'; car: string; text: string }
  /** Wreck the marked car before it gets away (or the time runs out). */
  | { kind: 'wreck'; car: string; text: string; time?: number }
  /** Stay between `min` and `max` m behind the marked car for `seconds`. */
  | { kind: 'follow'; car: string; text: string; min: number; max: number; seconds: number }
  /** Collect `count` packages on sidewalks around a place, in time. */
  | { kind: 'packages'; around: PlaceId; count: number; time: number; text: string }
  /** Drive through gates along the road from one place to another, in time. */
  | { kind: 'gates'; from: PlaceId; to: PlaceId; time: number; text: string }
  /** Fly through rings in a line from one place to another (helicopter). */
  | { kind: 'rings'; from: PlaceId; to: PlaceId; count: number; text: string; time?: number }
  /** Steer a boat past buoys on the lake, in order. */
  | { kind: 'buoys'; from: PlaceId; to: PlaceId; count: number; time: number; text: string }
  /** Set the wanted level (the police are on to you). */
  | { kind: 'stars'; stars: number }
  /** Get the wanted level back to zero. */
  | { kind: 'loseCops'; text: string }
  /** Thugs come for you at a place: knock out `count` of them (optionally before `time`). */
  | { kind: 'goons'; at: PlaceId; count: number; text: string; time?: number }
  /** Own this weapon (buy it at Guns & Ammo). */
  | { kind: 'buy'; weapon: WeaponId; text: string }
  /** Complete one taxi fare (a side-job shift in a taxi). */
  | { kind: 'fare'; text: string }
  /** A text or call, then carry straight on. */
  | { kind: 'phone'; message: PhoneSpec }
  /** Set flags. */
  | { kind: 'set'; flags: Record<string, string | boolean> }
  /** Pay the player. */
  | { kind: 'pay'; amount: number }
  /** A pause (seconds). */
  | { kind: 'wait'; seconds: number; text?: string };

export interface MissionSpec {
  id: string;
  title: string;
  /** "Prologue", "Act 1"… (shown when it starts). */
  act: string;
  /** Who offers it (their ★). Null: it starts by itself (the first prologue mission). */
  giver: CharId | null;
  /** Missions that must be done first. */
  requires: string[];
  when?: Cond;
  /** One line for the offer and the HUD. */
  summary: string;
  reward: number;
  steps: StepSpec[];
  /** Messages after it's done (texts, calls, hints for what's next). */
  after?: PhoneSpec[];
}

/** A sign or prop in the world that comes and goes with the story (story/world.ts). */
export interface PropSpec {
  id: string;
  at: PlaceId;
  /** Offset from the place (metres, in the place's frame: x = along the street, z = away from it). */
  offset?: [number, number];
  kind: 'sign' | 'banner' | 'boards' | 'crops' | 'tape';
  text?: string;
  /** Background and text colours (signs, banners). */
  colors?: [string, string];
  when: Cond;
}
