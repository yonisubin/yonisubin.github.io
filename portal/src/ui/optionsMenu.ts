// The options screen: tabs for video, audio, controls (incl. key rebinding and gamepad), gameplay
// and accessibility. Every change is saved and applied immediately through `set`.
import { ACTION_LABELS, HELD_ACTIONS, PRESS_ACTIONS, codeLabel, type Action, type Input } from '../input/input';
import { SHELL } from '../core/shellConfig';
import { PALETTES, type Options, type PaletteId } from './options';
import { button, h } from './dom';

type Tab = 'video' | 'audio' | 'controls' | 'gameplay' | 'accessibility';
const TABS: [Tab, string][] = [
  ['video', 'Video'],
  ['audio', 'Audio'],
  ['controls', 'Controls'],
  ['gameplay', 'Gameplay'],
  ['accessibility', 'Accessibility'],
];

export interface OptionsHost {
  options: Options;
  setOption<K extends keyof Options>(key: K, value: Options[K]): void;
  resetOptions(): void;
  input: Input;
}

let lastTab: Tab = 'video';

export function renderOptions(host: OptionsHost, onBack: () => void): HTMLElement {
  const wrap = h('div', { class: 'options', 'data-screen': 'options' });
  const tabs = h('div', { class: 'tabs' });
  const body = h('div', { class: 'optBody' });
  wrap.append(h('h2', {}, 'Options'), tabs, body);

  const slider = (key: keyof Options, label: string, min: number, max: number, step: number, fmt: (v: number) => string) => {
    const v = host.options[key] as number;
    const out = h('span', { class: 'val' }, fmt(v));
    const inp = h('input', { type: 'range', min, max, step, value: v, 'data-opt': key });
    inp.addEventListener('input', () => {
      const n = Number(inp.value);
      out.textContent = fmt(n);
      host.setOption(key, n as never);
    });
    return h('label', { class: 'row' }, h('span', {}, label), inp, out);
  };
  const toggle = (key: keyof Options, label: string, note = '') => {
    const inp = h('input', { type: 'checkbox', 'data-opt': key });
    inp.checked = host.options[key] as boolean;
    inp.addEventListener('change', () => host.setOption(key, inp.checked as never));
    return h('label', { class: 'row' }, h('span', {}, label, note ? h('small', {}, ` ${note}`) : null), inp);
  };
  const select = (key: keyof Options, label: string, choices: [string, string][]) => {
    const sel = h('select', { 'data-opt': key });
    for (const [v, l] of choices) sel.append(h('option', { value: v }, l));
    sel.value = String(host.options[key]);
    sel.addEventListener('change', () => {
      const raw = sel.value;
      const cur = host.options[key];
      host.setOption(key, (typeof cur === 'number' ? Number(raw) : raw) as never);
    });
    return h('label', { class: 'row' }, h('span', {}, label), sel);
  };
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const S = SHELL.options;

  const build = (tab: Tab) => {
    lastTab = tab;
    body.innerHTML = '';
    tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.id === `tab-${tab}`));
    if (tab === 'video') {
      body.append(
        slider('fov', 'Field of view', S.fovMin, S.fovMax, 1, (v) => `${v}°`),
        slider('renderScale', 'Render scale', S.renderScaleMin, S.renderScaleMax, 0.05, pct),
        slider('recursionDepth', 'Opening recursion depth', S.recursionMin, S.recursionMax, 1, String),
        slider('brightness', 'Brightness', 0.5, 1.5, 0.05, pct),
        slider('gamma', 'Gamma', 0.5, 1.5, 0.05, (v) => v.toFixed(2)),
        select('frameCap', 'Frame cap', [
          ['0', 'Display rate'],
          ['30', '30 fps'],
          ['60', '60 fps'],
          ['120', '120 fps'],
        ]),
        h('p', { class: 'note' }, 'Anti-aliasing is always on (multisampling), and the browser controls resolution, window mode and V-sync: use fullscreen (F11) and render scale instead.'),
      );
    } else if (tab === 'audio') {
      body.append(
        slider('master', 'Master volume', 0, 1, 0.05, pct),
        slider('music', 'Music', 0, 1, 0.05, pct),
        slider('effects', 'Effects', 0, 1, 0.05, pct),
        slider('voice', 'Voice', 0, 1, 0.05, pct),
        toggle('subtitles', 'Subtitles (dialogue)'),
        toggle('captions', 'Closed captions (sound effects)'),
      );
    } else if (tab === 'controls') {
      body.append(
        slider('mouseSensitivity', 'Mouse sensitivity', 0.2, 3, 0.05, (v) => `${v.toFixed(2)}×`),
        toggle('invertY', 'Invert look up/down'),
        toggle('toggleCrouch', 'Crouch toggles (instead of hold)'),
        slider('gamepadSensitivity', 'Gamepad look sensitivity', 0.2, 3, 0.05, (v) => `${v.toFixed(2)}×`),
        h('p', { class: 'note' }, `Gamepad: left stick moves, right stick looks, A jump, B crouch, X use, LT/LB blue, RT/RB amber, Start pause. No aim assist.${host.input.gamepadConnected ? ' (gamepad connected)' : ''}`),
        renderBindings(host),
      );
    } else if (tab === 'gameplay') {
      body.append(
        toggle('crosshairIndicator', 'Crosshair shows placed openings'),
        toggle('hints', 'Hints and use prompts'),
        toggle('assist', 'Assist', '(slow motion during flings, wider placement tolerance)'),
      );
    } else {
      body.append(
        select('palette', 'Opening colours', (Object.keys(PALETTES) as PaletteId[]).map((k) => [k, PALETTES[k].label])),
        paletteSwatch(host),
        toggle('highContrastHazards', 'High-contrast hazards'),
        toggle('reduceRoll', 'Reduce camera roll'),
        toggle('reduceFlashing', 'Reduce flashing'),
      );
    }
  };

  for (const [t, label] of TABS) tabs.append(button(label, `tab-${t}`, () => build(t)));
  build(lastTab);
  wrap.append(
    h(
      'div',
      { class: 'menuRow' },
      button('Reset to defaults', 'resetOptions', () => {
        host.resetOptions();
        build(lastTab);
      }),
      button('Back', 'back', onBack, { class: 'primary' }),
    ),
  );
  return wrap;
}

function paletteSwatch(host: OptionsHost): HTMLElement {
  const p = PALETTES[host.options.palette];
  const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
  return h('div', { class: 'swatch' }, h('span', { style: `background:${hex(p.a)}` }), h('span', { style: `background:${hex(p.b)}` }));
}

function renderBindings(host: OptionsHost): HTMLElement {
  const table = h('div', { class: 'bindings' });
  const fill = () => {
    table.innerHTML = '';
    for (const a of [...HELD_ACTIONS, ...PRESS_ACTIONS] as Action[]) {
      const codes = host.input.bindings[a];
      const cells = ([0, 1] as const).map((slot) => {
        const b = button(codeLabel(codes[slot]), `bind-${a}-${slot}`, () => {
          b.textContent = 'Press a key…';
          b.classList.add('waiting');
          host.input.captureNext((code) => {
            // Esc cancels (it stays the pause key in slot 0).
            if (code !== 'Escape' || a === 'pause') host.input.rebind(a, slot, code);
            fill();
          });
        });
        return b;
      });
      table.append(h('span', {}, ACTION_LABELS[a]), ...cells);
    }
    table.append(
      h('span', {}),
      button('Reset keys', 'resetKeys', () => {
        host.input.resetBindings();
        fill();
      }),
    );
  };
  fill();
  return table;
}
