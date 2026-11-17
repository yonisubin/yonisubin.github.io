// Twinfold app shell: starts the simulation, then hands everything around it (menus, pause, HUD
// extras, dialogue, music, saves, options, challenges, the puzzle maker) to ui/app.ts. The
// simulation lives in game/game.ts and is only reached through the GameSession interface.
//
// URL switches:  ?autostart  straight into the first chamber (tests)
//                ?chamber=id straight into a registered chamber (sandbox, fixedroom, testroom)
//                ?editor     open the puzzle maker
//                ?unlockall  challenges / advanced / every chapter open (dev)
//                #play=…     a shared chamber (puzzle maker share link)
import { startGame } from './game/game';
import { App } from './ui/app';
import { Sound } from './audio/sound';
import { validateLevel, exportLevelJSON, importLevelJSON } from './levels/loader';
import { encodeLevel, decodeLevel } from './editor/share';
import { planUtterance } from './dialogue/voice';
import { LINES } from './dialogue/lines';
import { medalFor, thresholds } from './save/leaderboard';
import { dbClear } from './save/db';
import * as chambers from './levels/chambers';

async function main(): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const handle = await startGame(canvas, document.getElementById('hud')!);
  const session = handle.session;
  const app = new App(handle, session);
  // Shell hooks for tests and debugging (the simulation's own are on window.twinfold).
  const shell = {
    app,
    session,
    Sound,
    validateLevel,
    exportLevelJSON,
    importLevelJSON,
    encodeLevel,
    decodeLevel,
    planUtterance,
    LINES,
    medalFor,
    thresholds,
    chambers,
    dbClear,
    ready: false,
  };
  (window as unknown as { twinfoldShell: typeof shell }).twinfoldShell = shell;
  await app.init(new URLSearchParams(location.search), location.hash);
  shell.ready = true;
}

main().catch((e) => {
  console.error(e);
  const el = document.getElementById('overlay');
  if (el) {
    el.style.display = 'flex';
    el.textContent = `Twinfold failed to start: ${String(e)}`;
  }
});
