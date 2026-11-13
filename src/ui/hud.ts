import type { Input } from '../input/actions';

// "Click to play" overlay. Mouse look needs pointer lock, which browsers only grant
// in response to a click, so we show this whenever the pointer isn't locked.

export function createHud(input: Input, touch: boolean): void {
  if (touch) {
    showTouchHint();
    return;
  }

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

/** Brief controls hint for touch devices; fades out on its own. */
function showTouchHint(): void {
  const hint = document.createElement('div');
  hint.style.cssText = [
    'position:fixed',
    'top:max(16px, env(safe-area-inset-top))',
    'left:50%',
    'transform:translateX(-50%)',
    'z-index:20',
    'padding:8px 14px',
    'border-radius:999px',
    'background:rgba(0,0,0,0.5)',
    'color:#fff',
    'font:14px/1.4 system-ui,sans-serif',
    'white-space:nowrap',
    'pointer-events:none',
    'transition:opacity 1s',
  ].join(';');
  hint.textContent = 'Left: move · Right: look · Jump button';
  document.body.appendChild(hint);
  setTimeout(() => (hint.style.opacity = '0'), 5000);
  setTimeout(() => hint.remove(), 6500);
}
