// The app shell: owns the state machine around the running simulation (main menu → playing ⇄
// paused, elevator, editor ⇄ test-play), and wires the shell systems (menus, HUD, dialogue, music,
// saves, options, challenges) to the session through bus events. The simulation is only ever
// reached through the GameSession interface.
import type { GameHandle } from '../game/game';
import type { GameSession } from '../core/session';
import type { LevelData } from '../levels/level';
import type { Input } from '../input/input';
import type { Sound } from '../audio/sound';
import { Music } from '../audio/music';
import { connectAudio } from '../audio/director';
import { DialogueManager } from '../dialogue/manager';
import { SaveManager, AUTO_SLOT, QUICK_SLOT, type SaveRecord } from '../save/saves';
import { submitRun } from '../save/leaderboard';
import { firstChamber, getChamber, nextChamber, type ChallengeMode } from '../levels/chambers';
import { decodeLevel, sharedData } from '../editor/share';
import type { Editor } from '../editor/editor';
import { Menu } from './menu';
import { ShellHud } from './shellHud';
import { MenuBackground } from './background';
import { DEFAULT_OPTIONS, PALETTES, cssFilter, loadOptions, saveOptions, toSessionSettings, type Options } from './options';
import { formatTime } from './dom';

export type AppState = 'menu' | 'game' | 'paused' | 'elevator' | 'editor' | 'testplay';

/** What the current run is: the story, one chamber from a link / the editor, or a challenge. */
export type RunMode =
  | { kind: 'campaign' }
  | { kind: 'custom'; source: 'shared' | 'advanced' | 'editor' }
  | { kind: 'challenge'; chamberId: string; mode: ChallengeMode };

export class App {
  state: AppState = 'menu';
  run: RunMode = { kind: 'campaign' };
  readonly input: Input;
  readonly sound: Sound;
  readonly music: Music;
  readonly dialogue: DialogueManager;
  readonly saves = new SaveManager();
  readonly hud: ShellHud;
  readonly menu: Menu;
  readonly background: MenuBackground;
  options: Options = loadOptions();
  editor: Editor | null = null;
  /** Dev / test switch: challenges, advanced chambers and every chapter open without the story. */
  devUnlocked = false;
  private sharedLevel: LevelData | null = null;
  /** The level object last handed to the session (saves need it alongside the snapshot). */
  private level: LevelData | null = null;
  private lastFrame = performance.now();
  private hadLock = false;
  /** Shell-side log of what happened (tests). */
  readonly log: string[] = [];

  constructor(
    readonly handle: GameHandle,
    readonly session: GameSession,
  ) {
    this.input = handle.input;
    this.sound = handle.sound;
    this.music = new Music(this.sound);
    this.dialogue = new DialogueManager(this.sound);
    this.hud = new ShellHud(document.getElementById('hud')!);
    this.dialogue.onSubtitle = (s) => this.hud.showSubtitle(s);
    this.dialogue.onCaption = (t) => this.hud.caption(t);
    this.background = new MenuBackground(document.body);
    this.menu = new Menu(this);
    this.sound.onUnlock = () => {
      this.applyOptions();
      if (this.state === 'menu' || this.state === 'editor') this.music.play('menu');
    };
  }

  get inSession(): boolean {
    return this.state === 'paused' || this.state === 'game' || this.state === 'elevator' || this.state === 'testplay';
  }

  async init(params: URLSearchParams, hash: string): Promise<void> {
    await this.saves.init();
    if (params.has('unlockall')) this.devUnlocked = true;
    const ev = this.session.events;
    connectAudio(ev, this.sound, this.music);
    this.dialogue.connect(ev, () => this.session.current());
    this.hud.connect(ev);
    ev.on('autosave', () => void this.autosave());
    ev.on('chamberStart', ({ chamberId }) => {
      this.log.push(`chamberStart ${chamberId}`);
      if (this.run.kind === 'campaign') void this.saves.reach(chamberId);
    });
    ev.on('exitReached', (e) => void this.onExit(e.chamberId, e));
    ev.on('elevatorDone', ({ chamberId, next }) => void this.onElevatorDone(chamberId, next));
    ev.on('death', () => this.log.push('death'));
    this.applyOptions();

    // Pointer lock lost while playing (Esc in the browser) → pause (or back to the editor).
    const canvas = this.handle.canvas;
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === canvas;
      if (locked) this.hadLock = true;
      else if (this.hadLock && (this.state === 'game' || this.state === 'testplay')) {
        this.hadLock = false;
        this.escape();
      }
    });
    canvas.addEventListener('click', () => {
      this.sound.unlock();
      if ((this.state === 'game' || this.state === 'testplay') && !document.pointerLockElement) this.input.requestLock();
    });
    // Any first click/key unlocks audio (browsers need a gesture).
    const unlock = () => this.sound.unlock();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });

    requestAnimationFrame((t) => this.frame(t));

    const shared = sharedData(hash);
    if (params.has('autostart')) this.startLevel(getChamber(firstChamber())!, { kind: 'campaign' }, false);
    else if (shared) await this.openShared(shared);
    else if (params.has('editor')) await this.openEditor();
    else this.toMainMenu();
  }

  // --- Frame loop (shell side only; the simulation runs its own fixed-step loop) --------------

  private frame(now: number): void {
    const dt = Math.min(0.25, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.dialogue.update(dt);
    this.hud.update(dt);
    if (this.input.consume('pause')) this.escape();
    if (this.input.consume('quicksave') && this.state === 'game') void this.quicksave();
    if (this.input.consume('quickload') && (this.state === 'game' || this.state === 'paused')) void this.quickload();
    if (this.run.kind === 'challenge' && (this.state === 'game' || this.state === 'paused')) {
      const c = this.session.counters();
      const label = { portals: 'Openings', steps: 'Steps', time: 'Time' }[this.run.mode];
      this.hud.setChallenge(`${label} challenge   ⏱ ${formatTime(c.time)}   ◐ ${c.portals}   👣 ${c.steps}`);
    }
    requestAnimationFrame((t) => this.frame(t));
  }

  /** Esc / Start: pause in play, back in menus, resume from the pause menu, editor from test-play. */
  escape(): void {
    if (this.state === 'game') this.pause();
    else if (this.state === 'testplay') this.backToEditor();
    else if (this.state === 'paused') {
      if (this.menu.screen === 'pause') this.resume();
      else this.menu.back();
    } else if (this.state === 'menu' && this.menu.visible) {
      if (this.menu.screen !== 'main' && this.menu.screen !== 'quit') this.menu.back();
    }
  }

  // --- Options ---------------------------------------------------------------------------------

  setOption<K extends keyof Options>(key: K, value: Options[K]): void {
    this.options = { ...this.options, [key]: value };
    saveOptions(this.options);
    this.applyOptions();
  }

  resetOptions(): void {
    this.options = { ...DEFAULT_OPTIONS };
    saveOptions(this.options);
    this.applyOptions();
  }

  /** Push every option to where it acts: the simulation, audio, dialogue, HUD, input, CSS. */
  applyOptions(): void {
    const o = this.options;
    this.session.applySettings(toSessionSettings(o));
    this.sound.setVolumes({ master: o.master, music: o.music, effects: o.effects, voice: o.voice });
    this.dialogue.setSubtitles(o.subtitles);
    this.dialogue.captions = o.captions;
    this.input.gamepadSensitivity = o.gamepadSensitivity;
    const pal = PALETTES[o.palette];
    this.hud.setCrosshair(pal.a, pal.b, o.crosshairIndicator);
    this.hud.hintsEnabled = o.hints;
    this.hud.reduceFlashing = o.reduceFlashing;
    this.background.setColors(pal.a, pal.b);
    this.handle.canvas.style.filter = cssFilter(o);
    document.body.classList.toggle('highContrast', o.highContrastHazards);
  }

  // --- Starting and stopping play --------------------------------------------------------------

  private startLevel(level: LevelData, run: RunMode, lock = true): void {
    this.run = run;
    this.level = level;
    this.hud.hideCard();
    this.hud.setChallenge(null);
    this.menu.hide();
    this.background.stop();
    this.editor?.hide();
    this.dialogue.clear();
    this.state = run.kind === 'custom' && run.source === 'editor' ? 'testplay' : 'game';
    this.session.setPaused(false);
    this.session.loadChamber(level);
    this.sound.unlock();
    if (lock) this.input.requestLock();
    this.log.push(`start ${level.id ?? level.name} (${run.kind})`);
  }

  async newGame(): Promise<void> {
    await this.saves.resetAutosave().catch(() => undefined);
    this.startLevel(getChamber(firstChamber())!, { kind: 'campaign' });
  }

  startCampaignAt(level: LevelData): void {
    this.startLevel(level, { kind: 'campaign' });
  }

  startCustom(level: LevelData, source: 'shared' | 'advanced' | 'editor'): void {
    this.startLevel(level, { kind: 'custom', source });
  }

  startChallenge(chamberId: string, mode: ChallengeMode): void {
    const l = getChamber(chamberId);
    if (l) this.startLevel(l, { kind: 'challenge', chamberId, mode });
  }

  pause(): void {
    if (this.state !== 'game') return;
    this.state = 'paused';
    this.session.setPaused(true);
    this.menu.open('pause');
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.menu.hide();
    this.state = this.run.kind === 'custom' && this.run.source === 'editor' ? 'testplay' : 'game';
    this.session.setPaused(false);
    this.input.requestLock();
  }

  restartChamber(): void {
    this.menu.hide();
    this.hud.hideCard();
    this.state = this.run.kind === 'custom' && this.run.source === 'editor' ? 'testplay' : 'game';
    this.session.setPaused(false);
    this.session.restartChamber();
    this.input.requestLock();
  }

  quitToMenu(): void {
    this.toMainMenu();
  }

  toMainMenu(): void {
    this.state = 'menu';
    this.run = { kind: 'campaign' };
    this.session.setPaused(true);
    this.dialogue.clear();
    this.hud.hideCard();
    this.hud.setChallenge(null);
    this.hud.setPrompt(null);
    this.editor?.hide();
    this.sound.stopCarryHum();
    this.sound.stopRoomTone();
    this.music.play('menu');
    this.background.start();
    this.menu.open('main');
  }

  // --- Chamber end -----------------------------------------------------------------------------

  private async onExit(chamberId: string, c: { portals: number; steps: number; time: number }): Promise<void> {
    this.log.push(`exit ${chamberId}`);
    if (this.run.kind === 'challenge') {
      const mode = this.run.mode;
      const value = mode === 'portals' ? c.portals : mode === 'steps' ? c.steps : Math.round(c.time * 10) / 10;
      const r = await submitRun(this.run.chamberId, mode, value).catch(() => ({ rank: -1, medal: null, entries: [] }));
      this.state = 'menu';
      this.session.setPaused(true);
      this.hud.setChallenge(null);
      this.background.start();
      this.menu.open('result', { chamber: this.run.chamberId, mode, value, medal: r.medal, rank: r.rank });
      this.log.push(`result ${mode} ${value} ${r.medal}`);
      return;
    }
    this.state = 'elevator';
    const lines = [`Openings ${c.portals}`, `Steps ${c.steps}`, `Time ${formatTime(c.time)}`];
    this.hud.showCard('Practical complete', lines, this.run.kind === 'campaign' ? 'Elevator — saving…' : '');
    if (this.run.kind === 'campaign') await this.saves.complete(chamberId).catch(() => undefined);
  }

  private async onElevatorDone(chamberId: string, next?: string): Promise<void> {
    if (this.state !== 'elevator') return;
    this.hud.hideCard();
    if (this.run.kind === 'custom') {
      if (this.run.source === 'editor') return this.backToEditor();
      return this.toMainMenu();
    }
    const nextId = (next && getChamber(next) ? next : null) ?? nextChamber(chamberId);
    const level = nextId ? getChamber(nextId) : null;
    if (level) return this.startLevel(level, { kind: 'campaign' });
    // End of the campaign.
    await this.saves.finishStory().catch(() => undefined);
    this.dialogue.say('milestone.story');
    this.state = 'menu';
    this.session.setPaused(true);
    this.background.start();
    this.music.stinger('finale');
    this.menu.open('end');
    this.log.push('story finished');
  }

  // --- Saves -----------------------------------------------------------------------------------

  private currentLevel(): LevelData | null {
    return this.session.current() ?? this.level;
  }

  private async autosave(): Promise<void> {
    if (this.run.kind !== 'campaign') return;
    const level = this.currentLevel();
    if (!level) return;
    await this.saves.write(AUTO_SLOT, 'auto', this.session.snapshot(), level).catch(() => undefined);
    this.log.push('autosave');
  }

  async saveTo(key: string): Promise<SaveRecord | null> {
    const level = this.currentLevel();
    if (!level) return null;
    const rec = await this.saves.write(key, 'manual', this.session.snapshot(), level);
    this.hud.toast('Saved');
    return rec;
  }

  async quicksave(): Promise<SaveRecord | null> {
    const level = this.currentLevel();
    if (!level) return null;
    const rec = await this.saves.write(QUICK_SLOT, 'quick', this.session.snapshot(), level);
    this.hud.toast('Quicksaved');
    return rec;
  }

  async quickload(): Promise<boolean> {
    const rec = await this.saves.read(QUICK_SLOT).catch(() => null);
    if (!rec) {
      this.hud.toast('No quicksave yet');
      return false;
    }
    await this.loadSave(rec);
    this.hud.toast('Quickloaded');
    this.dialogue.say('quickload', { priority: 1 });
    return true;
  }

  async loadSave(rec: SaveRecord): Promise<boolean> {
    const level = this.saves.levelOf(rec);
    if (!level) {
      this.hud.toast('That chamber no longer exists');
      return false;
    }
    this.run = { kind: 'campaign' };
    this.level = level;
    this.menu.hide();
    this.background.stop();
    this.editor?.hide();
    this.hud.hideCard();
    this.dialogue.clear();
    this.state = 'game';
    this.session.setPaused(false);
    this.session.restore(rec.snapshot, level);
    this.music.play('chamber');
    this.input.requestLock();
    this.log.push(`load ${rec.key}`);
    return true;
  }

  // --- Share links and the puzzle maker ------------------------------------------------------

  private async openShared(data: string): Promise<void> {
    this.state = 'menu';
    this.session.setPaused(true);
    this.background.start();
    try {
      this.sharedLevel = await decodeLevel(data);
      this.menu.open('shared', { name: this.sharedLevel.name });
    } catch (e) {
      this.sharedLevel = null;
      this.menu.open('shared', { error: (e as Error).message });
    }
  }

  get shared(): LevelData | null {
    return this.sharedLevel;
  }

  playShared(): void {
    if (this.sharedLevel) this.startCustom(this.sharedLevel, 'shared');
  }

  async editShared(): Promise<void> {
    await this.openEditor(this.sharedLevel ?? undefined);
  }

  async openEditor(level?: LevelData): Promise<Editor> {
    if (!this.editor) {
      const { Editor } = await import('../editor/editor');
      this.editor = new Editor({
        testPlay: (l) => this.startCustom(l, 'editor'),
        exit: () => this.toMainMenu(),
        toast: (t) => this.hud.toast(t),
      });
    }
    this.state = 'editor';
    this.session.setPaused(true);
    this.menu.hide();
    this.background.stop();
    this.dialogue.clear();
    this.hud.setPrompt(null);
    this.music.play('menu');
    this.editor.show(level);
    return this.editor;
  }

  backToEditor(): void {
    this.session.setPaused(true);
    this.hud.hideCard();
    this.menu.hide();
    this.dialogue.clear();
    this.state = 'editor';
    this.editor?.show();
  }
}
