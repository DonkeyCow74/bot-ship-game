// Builds the source code for a bot's Web Worker. Each bot runs alone in its own worker:
// it can't touch the page, the real game state, other bots, or the network.
import * as helpers from './helpers.js';
import { mulberry32 } from '../engine/rng.js';

// Things a bot has no business using.
const BLOCKED = [
  'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'indexedDB',
  'caches', 'BroadcastChannel', 'Worker', 'SharedWorker', 'WebTransport',
  'RTCPeerConnection', 'Request', 'Notification', 'FileReaderSync',
];

const DEBUG_KEYS = ['type', 'x', 'y', 'x2', 'y2', 'r', 'text', 'color', 'width'];
export const MAX_DEBUG_ITEMS = 200;

export function buildWorkerSource() {
  const names = Object.keys(helpers);
  const helperSrc = names.map((k) => `self.${k} = ${helpers[k].toString()};`).join('\n');
  return `"use strict";
(() => {
const post = self.postMessage.bind(self);
const listen = self.addEventListener.bind(self);
const mulberry32 = ${mulberry32.toString()};

${helperSrc}
self.helpers = { ${names.map((n) => `${n}: self.${n}`).join(', ')} };

for (const name of ${JSON.stringify(BLOCKED)}) {
  let o = self;
  while (o) {
    try { if (Object.prototype.hasOwnProperty.call(o, name)) delete o[name]; } catch (e) {}
    o = Object.getPrototypeOf(o);
  }
  try { Object.defineProperty(self, name, { value: undefined, writable: false, configurable: false }); } catch (e) {}
}

let think = null;
const memory = {};
let logBudget = 0;
const fmt = (v) => {
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch (e) { return String(v); }
};
const say = (level) => (...args) => {
  if (logBudget <= 0) return;
  logBudget--;
  post({ type: 'log', level, text: args.map(fmt).join(' ').slice(0, 500) });
};
const fakeConsole = { log: say('log'), info: say('log'), debug: say('log'), warn: say('warn'), error: say('error') };
try { Object.defineProperty(self, 'console', { value: fakeConsole, writable: false, configurable: false }); } catch (e) {}

// "TypeError: boom" plus the stack frames inside the bot's own code. Line numbers
// inside new Function() are off by 2 (its header lines).
const errText = (err) => {
  const head = err instanceof Error ? err.name + ': ' + err.message : 'Thrown: ' + fmt(err);
  const frames = [];
  for (const line of String((err && err.stack) || '').split('\\n')) {
    const m = line.match(/(?:<anonymous>|Function):(\\d+):(\\d+)\\)?\\s*$/);
    if (!m) continue;
    const fn = (line.match(/^\\s*at\\s+([\\w$.]+)/) || line.match(/^([\\w$.]+)@/) || [])[1] || '(top level)';
    frames.push('  at ' + fn + ' (line ' + (Number(m[1]) - 2) + ':' + m[2] + ')');
  }
  return [head, ...frames.slice(0, 5)].join('\\n').slice(0, 800);
};

const DEBUG_KEYS = ${JSON.stringify(DEBUG_KEYS)};
const cleanDebug = (list) => {
  if (!Array.isArray(list)) return undefined;
  const out = [];
  for (const d of list.slice(0, ${MAX_DEBUG_ITEMS})) {
    if (!d || typeof d !== 'object') continue;
    const o = {};
    for (const k of DEBUG_KEYS) {
      const v = d[k];
      if (typeof v === 'number' && Number.isFinite(v)) o[k] = v;
      else if (typeof v === 'string') o[k] = v.slice(0, 80);
    }
    out.push(o);
  }
  return out;
};
const cleanCmd = (c) => {
  if (!c || typeof c !== 'object') return null;
  return {
    thrust: Number(c.thrust) || 0,
    turn: Number(c.turn) || 0,
    fire: !!c.fire, bomb: !!c.bomb,
    shield: c.shield === 'back' ? 'back' : c.shield ? 'front' : false,
    saw: !!c.saw, dash: !!c.dash,
    pigStat: typeof c.pigStat === 'string' ? c.pigStat : 'hp',
    debug: cleanDebug(c.debug),
  };
};

listen('message', (e) => {
  const m = e.data;
  if (!m || typeof m !== 'object') return;
  if (m.type === 'init') {
    Math.random = mulberry32(m.seed >>> 0); // seeded, so matches can be replayed
    logBudget = 20;
    try {
      const factory = new Function(m.code + '\\n;return typeof think === "function" ? think : undefined;');
      think = factory();
      if (typeof think !== 'function') throw new Error('Your bot must define a function named think(view, memory).');
      post({ type: 'ready' });
    } catch (err) {
      post({ type: 'initError', error: errText(err) });
    }
  } else if (m.type === 'tick' && think) {
    logBudget = 5;
    let cmd = null, error = null;
    try { cmd = cleanCmd(think(m.view, memory)); } catch (err) { error = errText(err); }
    post({ type: 'cmd', tick: m.tick, cmd, error });
  }
});
})();
`;
}
