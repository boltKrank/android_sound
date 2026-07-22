/* ============================================================
   Soundboard app logic
   - entries persist in localStorage (name + settings)
   - audio blobs persist in IndexedDB (keyed by entry id)
   - "Build" validates entries and renders playable pads
   ============================================================ */

const DB_NAME = 'soundboard-db';
const DB_STORE = 'sounds';
const LS_ENTRIES = 'soundboard.entries';
const LS_SETTINGS = 'soundboard.settings';

let db = null;
let entries = [];           // [{ id, name, fileName, mimeType }]
let settings = { appName: 'My Soundboard', pageTitle: 'My Soundboard' };
let audioCtx = null;
let bufferCache = new Map(); // id -> decoded AudioBuffer

/* ---------------- IndexedDB helpers ---------------- */

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(key, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function idbGet(key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const req = tx.objectStore(DB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbDelete(key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/* ---------------- persistence ---------------- */

function saveEntries() {
  localStorage.setItem(LS_ENTRIES, JSON.stringify(entries));
}
function saveSettings() {
  localStorage.setItem(LS_SETTINGS, JSON.stringify(settings));
}
function loadState() {
  try { entries = JSON.parse(localStorage.getItem(LS_ENTRIES)) || []; } catch { entries = []; }
  try { settings = { ...settings, ...JSON.parse(localStorage.getItem(LS_SETTINGS)) }; } catch {}
}

/* ---------------- utils ---------------- */

function uid() { return 'p_' + Math.random().toString(36).slice(2, 10); }

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result); // data URL
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

function base64ToBlob(dataUrl) {
  return fetch(dataUrl).then(r => r.blob());
}

/* ---------------- rendering: edit view ---------------- */

const entryListEl = document.getElementById('entryList');
const entryCountEl = document.getElementById('entryCount');
const issueListEl = document.getElementById('issueList');

function renderEntries() {
  entryCountEl.textContent = entries.length;
  entryListEl.innerHTML = '';
  entries.forEach((entry, i) => {
    const row = document.createElement('div');
    row.className = 'entry-row';
    row.dataset.id = entry.id;

    row.innerHTML = `
      <div class="entry-row__idx">${String(i + 1).padStart(2, '0')}</div>
      <input type="text" class="entry-name" placeholder="Pad name" value="${escapeAttr(entry.name || '')}" />
      <label class="file-label ${entry.fileName ? 'has-file' : ''}">
        <span class="file-label__text">${entry.fileName ? escapeHtml(entry.fileName) : 'Choose sound file…'}</span>
        <input type="file" accept="audio/*" hidden />
      </label>
      <button type="button" class="entry-row__remove" aria-label="Remove pad">✕</button>
    `;

    row.querySelector('.entry-name').addEventListener('input', (e) => {
      entry.name = e.target.value;
      saveEntries();
    });

    row.querySelector('input[type="file"]').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      await idbPut(entry.id, file);
      entry.fileName = file.name;
      entry.mimeType = file.type;
      saveEntries();
      renderEntries();
    });

    row.querySelector('.entry-row__remove').addEventListener('click', async () => {
      entries = entries.filter(e2 => e2.id !== entry.id);
      await idbDelete(entry.id);
      bufferCache.delete(entry.id);
      saveEntries();
      renderEntries();
    });

    entryListEl.appendChild(row);
  });
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

function addEntry() {
  entries.push({ id: uid(), name: '', fileName: null, mimeType: null });
  saveEntries();
  renderEntries();
}

/* ---------------- validation + build ---------------- */

async function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') await audioCtx.resume();
  return audioCtx;
}

// Validate one entry: name present, file present, and audio actually decodes.
async function validateEntry(entry) {
  const problems = [];
  if (!entry.name || !entry.name.trim()) problems.push('missing name');
  if (!entry.fileName) problems.push('no sound file');

  if (problems.length) return { ok: false, problems };

  const blob = await idbGet(entry.id);
  if (!blob) return { ok: false, problems: ['sound file missing from storage'] };

  try {
    const ctx = await getAudioCtx();
    const arrayBuf = await blob.arrayBuffer();
    // decodeAudioData both validates the codec AND gives us a ready-to-play buffer
    const audioBuffer = await ctx.decodeAudioData(arrayBuf.slice(0));
    bufferCache.set(entry.id, audioBuffer);
    return { ok: true };
  } catch (err) {
    return { ok: false, problems: ['file is not a decodable audio format'] };
  }
}

async function buildSoundboard() {
  const issues = [];
  const valid = [];

  for (const entry of entries) {
    const result = await validateEntry(entry);
    if (result.ok) {
      valid.push(entry);
    } else {
      issues.push(`"${entry.name || entry.fileName || 'untitled pad'}" skipped — ${result.problems.join(', ')}`);
    }
  }

  if (issues.length) {
    issueListEl.hidden = false;
    issueListEl.innerHTML = issues.map(i => `<li>⚠ ${escapeHtml(i)}</li>`).join('');
  } else {
    issueListEl.hidden = true;
    issueListEl.innerHTML = '';
  }

  renderBoard(valid);
  setMode('board');
}

/* ---------------- board view ---------------- */

const padGrid = document.getElementById('padGrid');
const boardEmpty = document.getElementById('boardEmpty');
const boardTitle = document.getElementById('boardTitle');

function renderBoard(validEntries) {
  padGrid.innerHTML = '';
  boardEmpty.hidden = validEntries.length > 0;

  validEntries.forEach(entry => {
    const pad = document.createElement('button');
    pad.type = 'button';
    pad.className = 'pad';
    pad.innerHTML = `<span class="pad__ring"></span><span class="pad__label">${escapeHtml(entry.name)}</span>`;
    pad.addEventListener('click', () => playPad(entry.id, pad));
    padGrid.appendChild(pad);
  });
}

async function playPad(id, padEl) {
  const buffer = bufferCache.get(id);
  if (!buffer) return;
  const ctx = await getAudioCtx();
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start(0);

  padEl.classList.add('is-playing');
  source.onended = () => padEl.classList.remove('is-playing');
}

/* ---------------- mode toggle ---------------- */

const editView = document.getElementById('editView');
const boardView = document.getElementById('boardView');
const modeToggle = document.getElementById('modeToggle');

function setMode(mode) {
  const isBoard = mode === 'board';
  editView.hidden = isBoard;
  boardView.hidden = !isBoard;
  modeToggle.setAttribute('aria-pressed', String(isBoard));
  modeToggle.querySelector('.switch__label').textContent = isBoard ? 'PLAY' : 'EDIT';
}

modeToggle.addEventListener('click', () => {
  setMode(editView.hidden ? 'edit' : 'board');
});

/* ---------------- settings ---------------- */

const appNameInput = document.getElementById('appNameInput');
const pageTitleInput = document.getElementById('pageTitleInput');

function applySettingsToUi() {
  appNameInput.value = settings.appName;
  pageTitleInput.value = settings.pageTitle;
  boardTitle.textContent = settings.pageTitle;
  document.title = settings.pageTitle;
}

appNameInput.addEventListener('input', (e) => {
  settings.appName = e.target.value;
  saveSettings();
});
pageTitleInput.addEventListener('input', (e) => {
  settings.pageTitle = e.target.value;
  boardTitle.textContent = e.target.value || 'Soundboard';
  document.title = e.target.value || 'Soundboard';
  saveSettings();
});

/* ---------------- export / import ---------------- */

document.getElementById('exportBtn').addEventListener('click', async () => {
  const out = { settings, entries: [] };
  for (const entry of entries) {
    const blob = await idbGet(entry.id);
    const base64 = blob ? await blobToBase64(blob) : null;
    out.entries.push({ name: entry.name, fileName: entry.fileName, mimeType: entry.mimeType, data: base64 });
  }
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'config.json';
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('importInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  const parsed = JSON.parse(text);

  settings = { ...settings, ...(parsed.settings || {}) };
  saveSettings();
  applySettingsToUi();

  entries = [];
  for (const item of (parsed.entries || [])) {
    const id = uid();
    entries.push({ id, name: item.name, fileName: item.fileName, mimeType: item.mimeType });
    if (item.data) {
      const blob = await base64ToBlob(item.data);
      await idbPut(id, blob);
    }
  }
  saveEntries();
  renderEntries();
  e.target.value = '';
});

/* ---------------- wiring ---------------- */

document.getElementById('addRow').addEventListener('click', addEntry);
document.getElementById('buildBtn').addEventListener('click', buildSoundboard);

(async function init() {
  db = await openDb();
  loadState();
  if (entries.length === 0) addEntry();
  renderEntries();
  applySettingsToUi();
  setMode('edit');
})();
