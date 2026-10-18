import { BotStore } from './storage.js';
import { decodeBot } from './share.js';
import { renderMarkdown } from './markdown.js';
import { Arena } from './arena.js';
import { Lab } from './lab.js';
import { Tournament } from './tournament.js';

const TAB_KEY = 'shipArena.tab';

function showTab(name) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.page').forEach((p) => p.classList.toggle('active', p.id === `page-${name}`));
  try { localStorage.setItem(TAB_KEY, name); } catch {}
}

async function loadDocs() {
  const box = document.getElementById('docs');
  try {
    const md = await (await fetch('docs/BOT_API.md')).text();
    box.innerHTML = renderMarkdown(md);
  } catch {
    box.textContent = 'Could not load docs/BOT_API.md';
  }
}

async function main() {
  const store = new BotStore();
  await store.load();

  const arena = new Arena(store);
  const lab = new Lab(store, (botId, opponentId) => {
    arena.setSlots([botId, opponentId]);
    showTab('arena');
    arena.startFromSetup();
  });
  new Tournament(store, (replay) => {
    showTab('arena');
    arena.playReplay(replay);
  });
  store.onChange(() => arena.refreshBots());

  document.querySelectorAll('.tab').forEach((t) => { t.onclick = () => showTab(t.dataset.tab); });
  let tab = 'arena';
  try { tab = localStorage.getItem(TAB_KEY) || 'arena'; } catch {}
  showTab(document.getElementById(`page-${tab}`) ? tab : 'arena');
  loadDocs();

  // Opened a share link? (also works when pasted into an already-open tab)
  const checkShareLink = async () => {
    const m = location.hash.match(/^#bot=(.+)$/);
    if (!m) return;
    history.replaceState(null, '', location.pathname + location.search);
    try {
      const bot = await decodeBot(m[1]);
      showTab('lab');
      lab.importShared(bot);
    } catch (err) {
      alert('That share link seems broken: ' + err.message);
    }
  };
  window.addEventListener('hashchange', checkShareLink);
  checkShareLink();
}

main();
