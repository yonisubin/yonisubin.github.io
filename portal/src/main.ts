// Twinfold app shell: starts the game and owns everything around it (overlay / menus, pointer
// lock, saves, options). The simulation lives in game/game.ts.
import { startGame } from './game/game';

async function main(): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const game = await startGame(canvas, document.getElementById('hud')!);

  // Overlay: click to play (pointer lock), Esc to pause.
  const overlay = document.getElementById('overlay')!;
  overlay.addEventListener('click', () => {
    game.sound.unlock();
    game.input.requestLock();
  });
  document.addEventListener('pointerlockchange', () => {
    overlay.style.display = document.pointerLockElement === canvas ? 'none' : 'flex';
  });
}

main().catch((e) => {
  console.error(e);
  const el = document.getElementById('overlay');
  if (el) el.textContent = `Twinfold failed to start: ${String(e)}`;
});
