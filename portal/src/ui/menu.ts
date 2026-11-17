// Menus: the main menu (over the animated background), the pause menu and every screen they open
// (load / save slots, chapter select, challenges + leaderboards, advanced chambers, extras, credits,
// options, the quit title card, a shared-chamber card). Screens are rebuilt from scratch each time
// they're shown; a stack gives "Back". The menu root is #overlay (tests hide it by that id).
import type { App } from './app';
import { button, formatDate, formatTime, h } from './dom';
import { logoSVG } from './logo';
import { renderOptions } from './optionsMenu';
import { ADVANCED, CHALLENGES, CHAPTERS, allChambers, getChamber, type ChallengeMode } from '../levels/chambers';
import { MANUAL_SLOTS, type SaveRecord } from '../save/saves';
import { leaderboard, thresholds } from '../save/leaderboard';
import { PALETTES } from './options';

export type ScreenId =
  | 'main'
  | 'pause'
  | 'load'
  | 'save'
  | 'chapters'
  | 'challenges'
  | 'advanced'
  | 'extras'
  | 'credits'
  | 'options'
  | 'quit'
  | 'shared'
  | 'result'
  | 'end';

const MODE_LABEL: Record<ChallengeMode, string> = { portals: 'Least openings', steps: 'Least steps', time: 'Least time' };
const MEDAL_ICON: Record<string, string> = { gold: '● Gold', silver: '● Silver', bronze: '● Bronze' };

export class Menu {
  readonly root: HTMLElement;
  private readonly panel: HTMLElement;
  private stack: ScreenId[] = [];
  /** Data for the screen being shown (shared level, challenge result...). */
  private ctx: Record<string, unknown> = {};
  visible = false;

  constructor(private readonly app: App) {
    this.root = document.getElementById('overlay')!;
    this.root.innerHTML = '';
    this.panel = h('div', { class: 'panel' });
    this.root.append(this.panel);
    // Arrow keys move between buttons; Enter / Space activate them (native buttons).
    this.root.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const items = [...this.panel.querySelectorAll<HTMLElement>('button:not([disabled]), input, select')];
      if (!items.length) return;
      const i = items.indexOf(document.activeElement as HTMLElement);
      const next = items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
      next.focus();
      e.preventDefault();
    });
    this.panel.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')) this.app.sound.sfx('uiClick');
    });
  }

  get screen(): ScreenId | null {
    return this.stack[this.stack.length - 1] ?? null;
  }

  /** Open a screen on top of the current one. */
  push(id: ScreenId, ctx: Record<string, unknown> = {}): void {
    this.stack.push(id);
    this.ctx = ctx;
    void this.render();
  }

  /** Replace the whole stack (e.g. back to the main menu). */
  open(id: ScreenId, ctx: Record<string, unknown> = {}): void {
    this.stack = [id];
    this.ctx = ctx;
    this.show();
    void this.render();
  }

  back(): void {
    if (this.stack.length > 1) {
      this.stack.pop();
      this.ctx = {};
      void this.render();
      this.app.sound.sfx('uiBack');
    } else if (this.screen === 'pause') this.app.resume();
  }

  show(): void {
    this.visible = true;
    this.root.style.display = 'flex';
    this.root.classList.toggle('inGame', this.app.inSession);
  }

  hide(): void {
    this.visible = false;
    this.root.style.display = 'none';
    this.stack = [];
  }

  private async render(): Promise<void> {
    const id = this.screen;
    if (!id) return;
    const content = await this.build(id);
    if (this.screen !== id) return; // another screen opened while this one loaded
    this.panel.innerHTML = '';
    this.panel.dataset.screen = id;
    this.panel.append(content);
    this.root.classList.toggle('inGame', this.app.inSession);
    const first = this.panel.querySelector<HTMLElement>('button.primary, button:not([disabled])');
    first?.focus({ preventScroll: true });
  }

  private async build(id: ScreenId): Promise<HTMLElement> {
    switch (id) {
      case 'main':
        return this.mainScreen();
      case 'pause':
        return this.pauseScreen();
      case 'load':
        return this.loadScreen();
      case 'save':
        return this.saveScreen();
      case 'chapters':
        return this.chaptersScreen();
      case 'challenges':
        return this.challengesScreen();
      case 'advanced':
        return this.advancedScreen();
      case 'extras':
        return this.extrasScreen();
      case 'credits':
        return this.creditsScreen();
      case 'options':
        return renderOptions(this.app, () => this.back());
      case 'quit':
        return this.quitScreen();
      case 'shared':
        return this.sharedScreen();
      case 'result':
        return this.resultScreen();
      case 'end':
        return this.endScreen();
    }
  }

  private backButton(): HTMLButtonElement {
    return button('Back', 'back', () => this.back());
  }

  private logo(): HTMLElement {
    const pal = PALETTES[this.app.options.palette];
    const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
    const d = h('div', { class: 'logoWrap' });
    d.innerHTML = logoSVG(hex(pal.a), hex(pal.b));
    return d;
  }

  private async mainScreen(): Promise<HTMLElement> {
    const latest = await this.app.saves.latest().catch(() => null);
    const p = this.app.saves.progress;
    const unlocked = p.storyFinished || this.app.devUnlocked;
    return h(
      'div',
      { class: 'main', 'data-screen': 'main' },
      this.logo(),
      h(
        'nav',
        { class: 'mainMenu' },
        button('New Game', 'newGame', () => void this.app.newGame(), { class: 'primary' }),
        button('Continue', 'continue', () => latest && void this.app.loadSave(latest), { disabled: !latest }),
        button('Load Game', 'loadGame', () => this.push('load')),
        button('Chapter Select', 'chapterSelect', () => this.push('chapters')),
        button(unlocked ? 'Challenges' : 'Challenges  🔒', 'challenges', () => this.push('challenges')),
        button(unlocked ? 'Advanced Chambers' : 'Advanced Chambers  🔒', 'advanced', () => this.push('advanced')),
        button('Extras', 'extras', () => this.push('extras')),
        button('Options', 'options', () => this.push('options')),
        button('Quit', 'quit', () => this.open('quit')),
      ),
      h('div', { class: 'foot' }, 'A puzzle game about two linked openings. Everything is drawn and synthesised in code.'),
    );
  }

  private pauseScreen(): HTMLElement {
    const testing = this.app.state === 'testplay';
    return h(
      'div',
      { class: 'pause', 'data-screen': 'pause' },
      h('h2', {}, 'Paused'),
      h('div', { class: 'sub' }, this.app.session.current()?.name ?? ''),
      h(
        'nav',
        { class: 'mainMenu' },
        button('Resume', 'resume', () => this.app.resume(), { class: 'primary' }),
        testing ? null : button('Save', 'save', () => this.push('save')),
        testing ? null : button('Load', 'load', () => this.push('load')),
        button('Options', 'options', () => this.push('options')),
        button('Restart chamber', 'restart', () => this.app.restartChamber()),
        testing ? button('Back to puzzle maker', 'toEditor', () => this.app.backToEditor()) : null,
        button('Quit to menu', 'quitToMenu', () => this.app.quitToMenu()),
      ),
    );
  }

  private saveRow(rec: SaveRecord | null, key: string, onClick: () => void, label: string): HTMLElement {
    const b = button(rec ? `${rec.name} — ${rec.chamberName}` : `${label} — empty`, `slot-${key}`, onClick, { class: 'slot' });
    if (rec) b.append(h('small', {}, `${formatDate(rec.timestamp)} · ${formatTime(rec.snapshot.counters.time)}`));
    return b;
  }

  private async loadScreen(): Promise<HTMLElement> {
    const list = await this.app.saves.list().catch(() => [] as SaveRecord[]);
    const wrap = h('div', { class: 'slots', 'data-screen': 'load' }, h('h2', {}, 'Load game'));
    if (!list.length) wrap.append(h('p', { class: 'note' }, 'No saves yet. The game autosaves at the start of every chamber and at checkpoints.'));
    for (const rec of list) wrap.append(this.saveRow(rec, rec.key, () => void this.app.loadSave(rec), rec.name));
    wrap.append(h('div', { class: 'menuRow' }, this.backButton()));
    return wrap;
  }

  private async saveScreen(): Promise<HTMLElement> {
    const list = await this.app.saves.list().catch(() => [] as SaveRecord[]);
    const wrap = h('div', { class: 'slots', 'data-screen': 'save' }, h('h2', {}, 'Save game'));
    MANUAL_SLOTS.forEach((key, i) => {
      const rec = list.find((r) => r.key === key) ?? null;
      wrap.append(
        this.saveRow(rec, key, async () => {
          await this.app.saveTo(key);
          void this.render();
        }, `Slot ${i + 1}`),
      );
    });
    wrap.append(h('div', { class: 'menuRow' }, this.backButton()));
    return wrap;
  }

  private chaptersScreen(): HTMLElement {
    const p = this.app.saves.progress;
    const wrap = h('div', { class: 'list', 'data-screen': 'chapters' }, h('h2', {}, 'Chapter select'));
    if (CHAPTERS.length) {
      CHAPTERS.forEach((c, i) => {
        const open = p.chapters.includes(i) || this.app.devUnlocked;
        const first = getChamber(c.chambers[0]);
        wrap.append(button(open ? `${i + 1}. ${c.title}` : `${i + 1}. ????  🔒`, `chapter-${i}`, () => first && this.app.startCampaignAt(first), { disabled: !open || !first }));
      });
    } else {
      wrap.append(h('p', { class: 'note' }, 'The campaign chambers are still being built. Until then, the test chambers:'));
      for (const l of allChambers()) wrap.append(button(l.name, `chamber-${l.id}`, () => this.app.startCampaignAt(l)));
    }
    wrap.append(h('div', { class: 'menuRow' }, this.backButton()));
    return wrap;
  }

  private locked(title: string, screen: ScreenId): HTMLElement {
    return h(
      'div',
      { class: 'list', 'data-screen': screen },
      h('h2', {}, title),
      h('p', { class: 'note locked', 'data-locked': 'true' }, '🔒 Finish the story to unlock this.'),
      h('div', { class: 'menuRow' }, this.backButton()),
    );
  }

  private async challengesScreen(): Promise<HTMLElement> {
    if (!this.app.saves.progress.storyFinished && !this.app.devUnlocked) return this.locked('Challenges', 'challenges');
    const wrap = h('div', { class: 'list challenges', 'data-screen': 'challenges' }, h('h2', {}, 'Challenges'));
    const ids = Object.keys(CHALLENGES).filter((id) => getChamber(id));
    for (const id of ids) {
      const level = getChamber(id)!;
      const box = h('div', { class: 'challenge' }, h('h3', {}, level.name));
      for (const mode of Object.keys(CHALLENGES[id]) as ChallengeMode[]) {
        const t = thresholds(id, mode)!;
        const lb = await leaderboard(id, mode).catch(() => []);
        const best = lb[0];
        const fmt = (v: number) => (mode === 'time' ? formatTime(v) : String(v));
        box.append(
          h(
            'div',
            { class: 'mode' },
            h('span', {}, MODE_LABEL[mode]),
            h('small', {}, `gold ≤ ${fmt(t.gold)} · silver ≤ ${fmt(t.silver)} · bronze ≤ ${fmt(t.bronze)}`),
            h('small', { 'data-best': `${id}:${mode}` }, best ? `best ${fmt(best.value)}${best.medal ? ` (${best.medal})` : ''}` : 'no runs yet'),
            button('Start', `challenge-${id}-${mode}`, () => this.app.startChallenge(id, mode)),
          ),
        );
        if (lb.length) {
          const ol = h('ol', { class: 'board', 'data-board': `${id}:${mode}` });
          for (const e of lb) ol.append(h('li', {}, `${fmt(e.value)} ${e.medal ? MEDAL_ICON[e.medal] : ''} — ${formatDate(e.date)}`));
          box.append(ol);
        }
      }
      wrap.append(box);
    }
    wrap.append(h('div', { class: 'menuRow' }, this.backButton()));
    return wrap;
  }

  private advancedScreen(): HTMLElement {
    if (!this.app.saves.progress.storyFinished && !this.app.devUnlocked) return this.locked('Advanced chambers', 'advanced');
    const wrap = h('div', { class: 'list', 'data-screen': 'advanced' }, h('h2', {}, 'Advanced chambers'));
    if (!ADVANCED.length) wrap.append(h('p', { class: 'note' }, 'The advanced chambers are still being drafted by the Provost.'));
    for (const id of ADVANCED) {
      const l = getChamber(id);
      if (l) wrap.append(button(l.name, `advanced-${id}`, () => this.app.startCustom(l, 'advanced')));
    }
    wrap.append(h('div', { class: 'menuRow' }, this.backButton()));
    return wrap;
  }

  private extrasScreen(): HTMLElement {
    const on = this.app.options.commentary;
    const small = h('p', { class: 'note', 'data-id': 'editorBlocked', hidden: true }, 'The puzzle maker needs a larger screen: open it on a tablet in landscape or on a computer. Shared chambers still play here.');
    return h(
      'div',
      { class: 'list', 'data-screen': 'extras' },
      h('h2', {}, 'Extras'),
      h(
        'nav',
        { class: 'mainMenu' },
        button('Puzzle maker', 'puzzleMaker', () => {
          if (this.app.editorBlocked) small.hidden = false;
          else void this.app.openEditor();
        }, { class: 'primary' }),
        button(`Developer commentary: ${on ? 'on' : 'off'}`, 'commentary', () => {
          this.app.setOption('commentary', !this.app.options.commentary);
          void this.render();
        }),
        button('Credits', 'credits', () => this.push('credits')),
      ),
      small,
      h('div', { class: 'menuRow' }, this.backButton()),
    );
  }

  private creditsScreen(): HTMLElement {
    return h(
      'div',
      { class: 'credits', 'data-screen': 'credits' },
      this.logo(),
      h('p', {}, 'Design, code, art, music, sound and words: made for this site, in code.'),
      h('p', {}, 'Built with three.js, Rapier and the Web Audio API.'),
      h('p', {}, 'The Provost was played by a scale, two filters and a great deal of confidence.'),
      h('p', { class: 'note' }, 'No applicants were archived in the making of this game.'),
      h('div', { class: 'menuRow' }, this.backButton()),
    );
  }

  private quitScreen(): HTMLElement {
    return h(
      'div',
      { class: 'titleCard', 'data-screen': 'quit' },
      this.logo(),
      h('p', {}, 'Your session has been filed. You may close this tab.'),
      h('p', { class: 'note' }, '(Browsers do not let a page close itself. The Provost has asked them about it several times.)'),
      button('Return to the menu', 'returnToMenu', () => this.app.toMainMenu(), { class: 'primary' }),
    );
  }

  private sharedScreen(): HTMLElement {
    const name = String(this.ctx.name ?? 'Shared chamber');
    const err = this.ctx.error ? String(this.ctx.error) : '';
    return h(
      'div',
      { class: 'titleCard', 'data-screen': 'shared' },
      this.logo(),
      h('h2', {}, err ? 'This link does not open a chamber' : name),
      err ? h('pre', { class: 'error' }, err) : h('p', {}, 'A chamber someone made in the puzzle maker.'),
      err ? null : button('Play', 'playShared', () => this.app.playShared(), { class: 'primary' }),
      err || this.app.editorBlocked ? null : button('Open in the puzzle maker', 'editShared', () => this.app.editShared()),
      button('Main menu', 'toMain', () => this.app.toMainMenu()),
    );
  }

  private resultScreen(): HTMLElement {
    const c = this.ctx as { chamber: string; mode: ChallengeMode; value: number; medal: string | null; rank: number };
    const fmt = (v: number) => (c.mode === 'time' ? formatTime(v) : String(v));
    return h(
      'div',
      { class: 'titleCard', 'data-screen': 'result' },
      h('h2', {}, `${MODE_LABEL[c.mode]}: ${fmt(c.value)}`),
      h('p', { class: `medal ${c.medal ?? 'none'}`, 'data-medal': c.medal ?? 'none' }, c.medal ? MEDAL_ICON[c.medal] : 'No medal this time'),
      h('p', { class: 'note' }, c.rank >= 0 ? `#${c.rank + 1} on this chamber's board` : 'Not on the board'),
      button('Try again', 'retry', () => this.app.startChallenge(c.chamber, c.mode), { class: 'primary' }),
      button('Challenges', 'toChallenges', () => {
        this.app.toMainMenu();
        this.push('challenges');
      }),
    );
  }

  private endScreen(): HTMLElement {
    return h(
      'div',
      { class: 'titleCard', 'data-screen': 'end' },
      this.logo(),
      h('h2', {}, 'Curriculum complete'),
      h('p', {}, 'Challenges and advanced chambers are now unlocked.'),
      button('Credits', 'credits', () => this.push('credits')),
      button('Main menu', 'toMain', () => this.app.toMainMenu(), { class: 'primary' }),
    );
  }
}
