import * as THREE from 'three';
import type { Input } from '../input/actions';
import type { Pedestrian, Pedestrians } from '../npc/pedestrians';
import { Rng } from '../world/rng';

// Short chats with pedestrians: a speech bubble above their head with a greeting, then
// three replies to pick from (keys 1–3, or tap). Friendly → a friendly answer; asking
// about weapons → directions to the gun store; rude → they storm off or pick a fight.

const GREETINGS = [
  'Hey there.',
  "Nice day, isn't it?",
  'Can I help you?',
  'Do I know you?',
  'Hm? What is it?',
  'Busy day in the city.',
  'Oh — hi!',
  "Careful, I've got places to be.",
];
const NIGHT_GREETINGS = ["Bit late to be out, isn't it?", 'Evening.', "Can't sleep either?"];
const FRIENDLY_REPLIES = [
  'Ha, you too. Take care!',
  'Good talking to you.',
  'Nice to meet someone friendly around here.',
  'Have a good one!',
  "Thanks! Don't get lost out there.",
];
const ANGRY_REPLIES = ['What did you just say?!', "Oh, you're gonna regret that.", 'Say that again. I dare you.'];
const HURT_REPLIES = ['Wow. Rude.', "Fine, I'm leaving.", 'Unbelievable…'];

const CHOICES = ['Nice to meet you!', 'Where can I get a weapon?', 'Get lost.'];
const REPLY_TIME = 2.6; // s the answer stays up

export class Dialogue {
  private ped: Pedestrian | null = null;
  private readonly bubble: HTMLDivElement;
  private readonly text: HTMLDivElement;
  private readonly choices: HTMLDivElement;
  private replyTimer = 0;
  private outcome: 'calm' | 'flee' | 'angry' = 'calm';
  private readonly rng = new Rng(9001);
  private readonly tmp = new THREE.Vector3();

  constructor(
    private readonly camera: THREE.Camera,
    private readonly input: Input,
    private readonly peds: Pedestrians,
    private readonly shopDoor: THREE.Vector3,
    private readonly isNight: () => boolean,
    touch: boolean,
  ) {
    this.bubble = document.createElement('div');
    this.bubble.style.cssText = [
      'position:fixed',
      'z-index:25',
      'transform:translate(-50%,-100%)',
      'max-width:min(300px, 80vw)',
      'padding:8px 12px',
      'border-radius:12px',
      'background:rgba(255,255,255,0.95)',
      'color:#1d1f22',
      'font:15px/1.35 system-ui,sans-serif',
      'box-shadow:0 3px 12px rgba(0,0,0,0.35)',
      'display:none',
    ].join(';');
    this.text = document.createElement('div');
    this.text.style.fontWeight = '600';
    this.choices = document.createElement('div');
    this.choices.style.cssText = 'display:flex;flex-direction:column;gap:5px;margin-top:8px';
    CHOICES.forEach((label, i) => {
      const b = document.createElement('button');
      b.textContent = touch ? label : `${i + 1}. ${label}`;
      b.style.cssText = [
        'text-align:left',
        'padding:6px 10px',
        'border:0',
        'border-radius:8px',
        'background:#2d6cdf',
        'color:#fff',
        'font:500 14px system-ui,sans-serif',
        'cursor:pointer',
      ].join(';');
      // Taps on the choices mustn't reach the game's touch/look handlers.
      for (const type of ['pointerdown', 'mousedown']) b.addEventListener(type, (e) => e.stopPropagation());
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.choose(i);
      });
      this.choices.appendChild(b);
    });
    this.bubble.append(this.text, this.choices);
    document.body.appendChild(this.bubble);
  }

  get active(): boolean {
    return this.ped !== null;
  }

  start(ped: Pedestrian): void {
    this.ped = ped;
    this.peds.startTalking(ped);
    // Forget number keys pressed before the chat began.
    for (const c of ['choice1', 'choice2', 'choice3'] as const) this.input.consumePressed(c);
    const lines = this.isNight() ? [...GREETINGS, ...NIGHT_GREETINGS] : GREETINGS;
    this.text.textContent = this.rng.pick(lines);
    this.choices.style.display = 'flex';
    this.bubble.style.display = '';
    this.replyTimer = 0;
  }

  private choose(index: number): void {
    const ped = this.ped;
    if (!ped || this.replyTimer > 0) return;
    let reply: string;
    if (index === 0) {
      reply = this.rng.pick(FRIENDLY_REPLIES);
      this.outcome = 'calm';
    } else if (index === 1) {
      reply = `Try Guns & Ammo — the yellow sign, ${this.directions(ped.currPos)}. It's the $ on your map.`;
      this.outcome = 'calm';
    } else if (this.rng.chance(0.5)) {
      reply = this.rng.pick(ANGRY_REPLIES);
      this.outcome = 'angry';
    } else {
      reply = this.rng.pick(HURT_REPLIES);
      this.outcome = 'flee';
    }
    this.text.textContent = reply;
    this.choices.style.display = 'none';
    this.replyTimer = this.outcome === 'angry' ? 1.2 : REPLY_TIME;
  }

  /** "about 120 m north-east" from `from` to the shop (north is −Z). */
  private directions(from: THREE.Vector3): string {
    const dx = this.shopDoor.x - from.x;
    const dz = this.shopDoor.z - from.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 25) return 'right around here';
    // Compass bearing: 0 = north (−Z), clockwise toward east (+X).
    const bearing = (Math.atan2(dx, -dz) * 180) / Math.PI;
    const names = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
    const name = names[Math.round(((bearing + 360) % 360) / 45) % 8];
    return `about ${Math.round(dist / 10) * 10} m ${name} of here`;
  }

  private end(): void {
    if (this.ped) this.peds.endTalking(this.ped, this.outcome);
    this.ped = null;
    this.outcome = 'calm';
    this.bubble.style.display = 'none';
  }

  /** Call once per frame: keyboard choices, timers, and keeping the bubble over the head. */
  update(frameDt: number, playerPosition: THREE.Vector3): void {
    const ped = this.ped;
    if (!ped) return;
    // The chat ends if they stopped talking (hit, wandered off) or the player walked away.
    if (ped.state !== 'talk' || ped.currPos.distanceTo(playerPosition) > 5) {
      this.ped = null;
      this.bubble.style.display = 'none';
      return;
    }
    if (this.replyTimer === 0) {
      if (this.input.consumePressed('choice1')) this.choose(0);
      else if (this.input.consumePressed('choice2')) this.choose(1);
      else if (this.input.consumePressed('choice3')) this.choose(2);
    } else {
      this.replyTimer -= frameDt;
      if (this.replyTimer <= 0) {
        this.end();
        return;
      }
    }
    // Position above the head; hide if behind the camera.
    const p = this.tmp.copy(ped.currPos);
    p.y += 2.05;
    p.project(this.camera);
    if (p.z > 1) {
      this.bubble.style.visibility = 'hidden';
      return;
    }
    this.bubble.style.visibility = 'visible';
    this.bubble.style.left = `${((p.x + 1) / 2) * window.innerWidth}px`;
    this.bubble.style.top = `${((1 - p.y) / 2) * window.innerHeight}px`;
  }
}
