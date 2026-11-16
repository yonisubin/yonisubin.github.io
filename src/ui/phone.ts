// The phone: texts and calls from the story's characters, while you keep playing.
//
//   text   a card with the sender and the message, for 6 s
//   call   a card with "📞 Name" and the lines as subtitles, ~3.5 s each
//
// Messages queue up (one card at a time) and everything is kept in a log, shown as the
// "Messages" list on the full map. The log is saved with the story.

export interface PhoneEntry {
  from: string;
  name: string;
  color: string;
  call: boolean;
  lines: string[];
}

const TEXT_TIME = 6; // s
const CALL_LINE_TIME = 3.5; // s per line
const LOG_SIZE = 40;

export class Phone {
  readonly log: PhoneEntry[] = [];
  private readonly queue: PhoneEntry[] = [];
  private current: PhoneEntry | null = null;
  private line = 0;
  private timer = 0;
  private readonly card: HTMLDivElement;
  private readonly logPanel: HTMLDivElement;
  private logOpen = false;

  constructor(
    /** Ring / ping (sound). */
    private readonly ring: () => void,
  ) {
    this.card = document.createElement('div');
    this.card.style.cssText = [
      'position:fixed',
      'left:max(8px, env(safe-area-inset-left))',
      'top:calc(max(8px, env(safe-area-inset-top)) + 124px)',
      'z-index:22',
      'width:min(300px, 70vw)',
      'padding:9px 12px',
      'border-radius:14px',
      'background:rgba(20,22,28,0.9)',
      'box-shadow:0 4px 16px rgba(0,0,0,0.4)',
      'color:#fff',
      'font:14px/1.35 system-ui,sans-serif',
      'pointer-events:none',
      'display:none',
    ].join(';');
    document.body.appendChild(this.card);
    this.logPanel = document.createElement('div');
    this.logPanel.style.cssText = [
      'position:fixed',
      'right:max(12px, env(safe-area-inset-right))',
      'top:calc(max(12px, env(safe-area-inset-top)) + 52px)',
      'z-index:57',
      'width:min(340px, calc(100vw - 24px))',
      'max-height:70vh',
      'overflow:auto',
      'padding:12px 14px',
      'border-radius:14px',
      'background:rgba(16,17,22,0.95)',
      'color:#fff',
      'font:14px/1.4 system-ui,sans-serif',
      'display:none',
    ].join(';');
    for (const type of ['pointerdown', 'mousedown', 'wheel', 'touchstart']) this.logPanel.addEventListener(type, (e) => e.stopPropagation());
    document.body.appendChild(this.logPanel);
  }

  /** A new message: queued, logged. */
  receive(entry: PhoneEntry): void {
    this.queue.push(entry);
    this.log.push(entry);
    if (this.log.length > LOG_SIZE) this.log.shift();
    if (this.logOpen) this.drawLog();
  }

  /** Is a message on screen or waiting? */
  get busy(): boolean {
    return this.current !== null || this.queue.length > 0;
  }

  /** Call every frame. */
  update(frameDt: number): void {
    if (!this.current) {
      const next = this.queue.shift();
      if (!next) return;
      this.current = next;
      this.line = 0;
      this.timer = next.call ? CALL_LINE_TIME : TEXT_TIME;
      this.ring();
      this.draw();
      return;
    }
    this.timer -= frameDt;
    if (this.timer > 0) return;
    if (this.current.call && this.line < this.current.lines.length - 1) {
      this.line++;
      this.timer = CALL_LINE_TIME;
      this.draw();
      return;
    }
    this.current = null;
    this.card.style.display = 'none';
  }

  private draw(): void {
    const m = this.current!;
    const body = m.call ? m.lines[this.line] : m.lines.join(' ');
    this.card.innerHTML = '';
    const head = document.createElement('div');
    head.style.cssText = `font-weight:800;font-size:12px;letter-spacing:0.04em;color:${m.color};margin-bottom:2px`;
    head.textContent = `${m.call ? '📞' : '💬'} ${m.name.toUpperCase()}`;
    const text = document.createElement('div');
    text.textContent = body;
    this.card.append(head, text);
    this.card.style.display = '';
  }

  /** The Messages list (from the full map). */
  toggleLog(open = !this.logOpen): void {
    this.logOpen = open;
    this.logPanel.style.display = open ? '' : 'none';
    if (open) this.drawLog();
  }

  get logIsOpen(): boolean {
    return this.logOpen;
  }

  private drawLog(): void {
    this.logPanel.innerHTML = '';
    const title = document.createElement('div');
    title.style.cssText = 'font-weight:800;margin-bottom:8px';
    title.textContent = `Messages (${this.log.length})`;
    this.logPanel.appendChild(title);
    if (!this.log.length) {
      const empty = document.createElement('div');
      empty.style.opacity = '0.6';
      empty.textContent = 'No messages yet.';
      this.logPanel.appendChild(empty);
    }
    for (const m of [...this.log].reverse()) {
      const row = document.createElement('div');
      row.style.cssText = 'padding:7px 0;border-top:1px solid rgba(255,255,255,0.08)';
      const head = document.createElement('div');
      head.style.cssText = `font-weight:700;font-size:12px;color:${m.color}`;
      head.textContent = `${m.call ? '📞' : '💬'} ${m.name}`;
      const text = document.createElement('div');
      text.style.opacity = '0.9';
      text.textContent = m.lines.join(' ');
      row.append(head, text);
      this.logPanel.appendChild(row);
    }
  }

  /** Restore a saved log (no ringing). */
  load(entries: PhoneEntry[]): void {
    const keep = entries.slice(-LOG_SIZE); // (a copy: `entries` may be this very log)
    this.log.length = 0;
    this.log.push(...keep);
  }
}
