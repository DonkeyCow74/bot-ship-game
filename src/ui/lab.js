import { parseMeta, withMeta } from './storage.js';
import { shareLink } from './share.js';
import { downloadText, pickFiles, safeFileName, el } from './files.js';

const $ = (id) => document.getElementById(id);
const SELECTED_KEY = 'shipArena.labSelected';

export class Lab {
  // onFight(botId, opponentId) is called when the Fight button is pressed
  constructor(store, onFight) {
    this.store = store;
    this.onFight = onFight;
    this.selected = null;
    this.saveTimer = null;
    this.code = $('lab-code');
    this.bind();
    let saved = null;
    try { saved = localStorage.getItem(SELECTED_KEY); } catch {}
    this.select(store.get(saved) ? saved : (store.user[0] || store.builtins[0]).id);
  }

  bind() {
    $('lab-new').onclick = () => {
      const bot = this.store.create({ name: 'My Bot' });
      this.select(bot.id);
      this.code.focus();
    };
    $('lab-upload').onclick = () => this.upload();
    $('lab-duplicate').onclick = () => {
      const src = this.current();
      const bot = this.store.create({ name: `${src.name} copy`, color: src.color, code: src.code });
      this.select(bot.id);
    };
    $('lab-delete').onclick = () => {
      const bot = this.current();
      if (bot.builtin || !confirm(`Delete "${bot.name}"? Download it first if you want to keep a copy.`)) return;
      this.store.remove(bot.id);
      this.select((this.store.user[0] || this.store.builtins[0]).id);
    };
    $('lab-download').onclick = () => {
      const bot = this.current();
      downloadText(`${safeFileName(bot.name)}.js`, withMeta(bot.code, bot.name, bot.color), 'text/javascript');
    };
    $('lab-share').onclick = () => this.share();
    $('lab-fight').onclick = () => {
      this.flushSave();
      this.onFight(this.selected, $('lab-opponent').value);
    };

    $('lab-name').addEventListener('input', () => this.queueSave());
    $('lab-name').addEventListener('change', () => this.flushSave());
    $('lab-color').addEventListener('input', () => this.queueSave());
    this.code.addEventListener('input', () => { this.updateGutter(); this.check(); this.queueSave(); });
    this.code.addEventListener('scroll', () => { $('lab-gutter').scrollTop = this.code.scrollTop; });
    this.code.addEventListener('keydown', (e) => this.editorKeys(e));
    this.store.onChange(() => this.renderLists());
  }

  current() {
    return this.store.get(this.selected);
  }

  select(id) {
    this.flushSave();
    const bot = this.store.get(id);
    if (!bot) return;
    this.selected = id;
    try { localStorage.setItem(SELECTED_KEY, id); } catch {}
    $('lab-name').value = bot.name;
    $('lab-color').value = bot.color;
    this.code.value = bot.code;
    const ro = !!bot.builtin;
    this.code.readOnly = ro;
    $('lab-name').disabled = ro;
    $('lab-color').disabled = ro;
    $('lab-delete').disabled = ro;
    $('lab-readonly').classList.toggle('hidden', !ro);
    $('lab-saved').textContent = ro ? '' : 'Saved in this browser';
    this.code.scrollTop = 0;
    this.updateGutter();
    this.check();
    this.renderLists();
  }

  renderLists() {
    const item = (b) => el('button', {
      class: 'bot-item' + (b.id === this.selected ? ' selected' : ''),
      onclick: () => this.select(b.id),
    }, el('span', { class: 'dot', style: `background:${b.color}` }), b.name);
    $('lab-mine').replaceChildren(...(this.store.user.length
      ? this.store.user.map(item)
      : [el('p', { class: 'muted small' }, 'No bots yet. Click "New bot" to start from a simple template, or copy a sample bot.')]));
    $('lab-builtin').replaceChildren(...this.store.builtins.map(item));

    const opp = $('lab-opponent');
    const prev = opp.value;
    opp.replaceChildren(...this.store.all().map((b) => el('option', { value: b.id }, b.name)));
    opp.value = [...opp.options].some((o) => o.value === prev) ? prev : this.store.builtins[0]?.id;
  }

  queueSave() {
    const bot = this.current();
    if (!bot || bot.builtin) return;
    $('lab-saved').textContent = 'Saving…';
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flushSave(), 400);
  }

  flushSave() {
    if (!this.saveTimer) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    const bot = this.current();
    if (!bot || bot.builtin) return;
    const updated = this.store.update(bot.id, {
      name: $('lab-name').value.trim() || 'My Bot',
      color: $('lab-color').value,
      code: this.code.value,
    });
    if (updated && document.activeElement !== $('lab-name')) $('lab-name').value = updated.name;
    $('lab-saved').textContent = 'Saved in this browser';
  }

  // Compile without running, to catch typos before a match.
  check() {
    const code = this.code.value;
    const line = $('lab-check');
    const details = $('lab-errors');
    try {
      new Function(code);
      if (!/function\s+think\s*\(|\bthink\s*=/.test(code)) {
        line.className = 'check-line bad';
        line.textContent = '✗ No think(view, memory) function found.';
      } else {
        line.className = 'check-line ok';
        line.textContent = '✓ No syntax errors.';
      }
      details.textContent = '';
    } catch (err) {
      line.className = 'check-line bad';
      line.textContent = `✗ ${err.name}: ${err.message}`;
      const m = String(err.stack || '').match(/(?:<anonymous>|Function):(\d+):(\d+)/) ||
        (err.lineNumber ? [null, err.lineNumber, err.columnNumber] : null);
      details.textContent = m ? `Around line ${Number(m[1]) - 2}` : '';
    }
  }

  updateGutter() {
    const n = this.code.value.split('\n').length;
    if (n === this.lineCount) return;
    this.lineCount = n;
    $('lab-gutter').textContent = Array.from({ length: n }, (_, i) => i + 1).join('\n') + '\n';
  }

  editorKeys(e) {
    const ta = this.code;
    if (ta.readOnly) return;
    const { selectionStart: s, selectionEnd: end, value } = ta;
    if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      ta.setRangeText('  ', s, end, 'end');
      ta.dispatchEvent(new Event('input'));
    } else if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      const lineStart = value.lastIndexOf('\n', s - 1) + 1;
      let indent = value.slice(lineStart, s).match(/^\s*/)[0];
      if (/[{[(]\s*$/.test(value.slice(lineStart, s))) indent += '  ';
      e.preventDefault();
      ta.setRangeText('\n' + indent, s, end, 'end');
      ta.dispatchEvent(new Event('input'));
    } else if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      this.flushSave();
    }
  }

  async upload() {
    const files = await pickFiles('.js,text/javascript', true);
    let last = null;
    for (const f of files) {
      const meta = parseMeta(f.text);
      last = this.store.create({ name: meta.name || f.name.replace(/\.js$/i, ''), color: meta.color, code: f.text });
    }
    if (last) this.select(last.id);
  }

  async share() {
    this.flushSave();
    const bot = this.current();
    const link = await shareLink(bot);
    try {
      await navigator.clipboard.writeText(link);
      $('lab-saved').textContent = `Share link copied! (${Math.round(link.length / 1024)} KB)`;
    } catch {
      prompt('Copy this link and send it to a friend:', link);
    }
  }

  // Called when someone opens a share link
  importShared(bot) {
    if (!confirm(`Someone shared a bot with you: "${bot.name}". Add it to your bots?`)) return false;
    const created = this.store.create(bot);
    this.select(created.id);
    return true;
  }
}
