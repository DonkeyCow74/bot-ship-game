// Runs one bot in its own Web Worker and enforces the time limits.
import { buildWorkerSource } from './sandbox.js';

export const TICK_BUDGET_MS = 20;  // answer slower than this and the ship gets no input that tick
export const KILL_AFTER_MS = 3000; // no answer at all for this long and the bot is shut down
const INIT_TIMEOUT_MS = 3000;
const MAX_LOGS = 500;

let workerUrl = null;
function getWorkerUrl() {
  if (!workerUrl) {
    workerUrl = URL.createObjectURL(new Blob([buildWorkerSource()], { type: 'text/javascript' }));
  }
  return workerUrl;
}

export class BotRunner {
  constructor({ name, code, seed, budgetMs = TICK_BUDGET_MS }) {
    this.name = name;
    this.code = code;
    this.seed = seed >>> 0;
    this.budgetMs = budgetMs;
    this.status = 'loading'; // loading | ready | error | killed
    this.logs = [];
    this.errors = 0;
    this.timeouts = 0;
    this.lastError = null;
    this.pending = null;
    this.worker = null;
    this.tick = 0;
  }

  init() {
    return new Promise((resolve) => {
      this._initDone = (ok) => {
        clearTimeout(this._initTimer);
        this._initDone = null;
        resolve(ok);
      };
      try {
        this.worker = new Worker(getWorkerUrl());
      } catch (err) {
        this._fail('Could not start bot: ' + err.message);
        return;
      }
      this.worker.onmessage = (e) => this._onMessage(e.data);
      this.worker.onerror = (e) => {
        e.preventDefault();
        this.errors++;
        this.lastError = e.message || 'Unknown error in bot';
        this.log('error', this.lastError);
      };
      this._initTimer = setTimeout(() => this._fail('Bot took more than 3 s to load.'), INIT_TIMEOUT_MS);
      this.worker.postMessage({ type: 'init', code: this.code, seed: this.seed });
    });
  }

  log(level, text) {
    this.logs.push({ tick: this.tick, level, text });
    if (this.logs.length > MAX_LOGS) this.logs.shift();
  }

  _fail(reason) {
    this.status = 'error';
    this.lastError = reason;
    this.log('error', reason);
    this.terminate();
    this._initDone?.(false);
  }

  _onMessage(m) {
    if (!m || typeof m !== 'object') return;
    if (m.type === 'ready' && this.status === 'loading') {
      this.status = 'ready';
      this.loadout = m.loadout;
      this._initDone?.(true);
    } else if (m.type === 'initError' && this.status === 'loading') {
      this._fail(String(m.error));
    } else if (m.type === 'log') {
      this.log(m.level === 'warn' || m.level === 'error' ? m.level : 'log', String(m.text).slice(0, 500));
    } else if (m.type === 'cmd' && this.pending && m.tick === this.pending.tick) {
      const p = this.pending;
      this.pending = null;
      if (m.error) {
        this.errors++;
        this.lastError = String(m.error);
        if (this.errors <= 10 || this.errors % 100 === 0) this.log('error', `think() crashed (#${this.errors}): ${m.error}`);
      }
      if (!p.done) {
        p.done = true;
        clearTimeout(p.timer);
        p.resolve(m.cmd || null);
      }
    }
  }

  // Resolves with the bot's command, or null if it's too slow / broken.
  request(view, tick) {
    this.tick = tick;
    if (this.status !== 'ready') return Promise.resolve(null);
    if (this.pending) {
      // Still chewing on an older tick: this tick gets no input
      if (performance.now() - this.pending.sentAt > KILL_AFTER_MS) {
        this.kill(`Bot froze (no answer for ${KILL_AFTER_MS / 1000} s) and was shut down. Check for infinite loops.`);
      }
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      const p = { tick, resolve, done: false, sentAt: performance.now() };
      p.timer = setTimeout(() => {
        if (p.done) return;
        p.done = true;
        this.timeouts++;
        if (this.timeouts <= 5 || this.timeouts % 100 === 0) {
          this.log('warn', `Too slow: think() took over ${this.budgetMs} ms (tick ${tick} skipped, ${this.timeouts} total)`);
        }
        resolve(null);
      }, this.budgetMs);
      this.pending = p;
      this.worker.postMessage({ type: 'tick', tick, view });
    });
  }

  kill(reason) {
    this.status = 'killed';
    this.lastError = reason;
    this.log('error', reason);
    this.terminate();
  }

  terminate() {
    if (this.worker) this.worker.terminate();
    this.worker = null;
    if (this.pending && !this.pending.done) {
      this.pending.done = true;
      clearTimeout(this.pending.timer);
      this.pending.resolve(null);
    }
    this.pending = null;
  }
}
