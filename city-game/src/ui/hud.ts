import type { Input } from '../input/actions';

// "Click to play" overlay. Mouse look needs pointer lock, which browsers only grant
// in response to a click, so we show this whenever the pointer isn't locked.

export function createHud(input: Input): void {
  const overlay = document.createElement('div');
  overlay.style.cssText = [
    'position:fixed',
    'inset:0',
    'display:flex',
    'flex-direction:column',
    'align-items:center',
    'justify-content:center',
    'gap:12px',
    'background:rgba(0,0,0,0.45)',
    'color:#fff',
    'font:16px/1.5 system-ui,sans-serif',
    'text-align:center',
    'cursor:pointer',
    'user-select:none',
  ].join(';');
  overlay.innerHTML = `
    <div style="font-size:28px;font-weight:600">Click to play</div>
    <div style="opacity:0.85">
      WASD — move &nbsp;·&nbsp; Shift — run &nbsp;·&nbsp; Space — jump<br />
      Mouse — look &nbsp;·&nbsp; Esc — release mouse
    </div>`;
  overlay.addEventListener('click', () => input.requestPointerLock());
  document.body.appendChild(overlay);

  document.addEventListener('pointerlockchange', () => {
    overlay.style.display = input.pointerLocked ? 'none' : 'flex';
  });
}
