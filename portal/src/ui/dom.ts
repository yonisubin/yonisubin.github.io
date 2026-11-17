// Small DOM helpers for the menus and the editor (no framework).

type Attrs = Record<string, string | number | boolean | undefined | null>;

/** h('button', { 'data-id': 'go', class: 'big' }, 'Go') */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Node | string | null | undefined | false)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = String(v);
    else if (k === 'text') e.textContent = String(v);
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) e.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return e;
}

export function button(label: string, id: string, onClick: () => void, attrs: Attrs = {}): HTMLButtonElement {
  const b = h('button', { 'data-id': id, type: 'button', ...attrs }, label);
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!b.disabled) onClick();
  });
  return b;
}

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

export function formatDate(ts: number): string {
  const d = new Date(ts);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

/** Trigger a download of text as a file. */
export function download(name: string, text: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
