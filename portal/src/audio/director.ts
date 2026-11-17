// What plays when: turns bus events into effects, footsteps, the carry hum, music modes, tension
// and stingers. The simulation only emits events; it never picks music.
import type { EventBus } from '../core/events';
import { SHELL } from '../core/shellConfig';
import type { Music } from './music';
import type { Sound } from './sound';

export function connectAudio(events: EventBus, sound: Sound, music: Music): () => void {
  const offs = [
    events.on('sfx', ({ name }) => sound.sfx(name)),
    events.on('footstep', ({ surface }) => {
      sound.eventFootsteps = true;
      sound.footstep(surface);
    }),
    events.on('pickup', () => sound.startCarryHum()),
    events.on('drop', () => sound.stopCarryHum()),
    events.on('fizzled', ({ what }) => {
      if (what === 'object') sound.stopCarryHum();
      sound.sfx('dissolve');
    }),
    events.on('damage', ({ health }) => music.setTension(health < 50 ? 1 : 0.7)),
    events.on('death', () => {
      sound.stopCarryHum();
      music.stinger('death');
    }),
    events.on('checkpoint', () => music.stinger('checkpoint')),
    events.on('output', ({ value }) => {
      if (value) music.setTension(Math.max(music.tension, 0.25));
    }),
    events.on('exitReached', () => {
      sound.stopCarryHum();
      music.stinger('complete');
      sound.sfx('elevatorChime');
      music.play('elevator');
    }),
    events.on('chamberStart', () => {
      music.play('chamber');
      sound.startRoomTone(SHELL.music.roomTone);
    }),
    events.on('boss', ({ event }) => {
      if (event === 'defeated') music.stinger('finale');
      else if (event === 'componentDisposed') music.stinger('milestone');
      music.setTension(1);
    }),
  ];
  return () => offs.forEach((f) => f());
}
