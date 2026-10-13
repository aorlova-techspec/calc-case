/* ============================================================
   Devis Rénovation — калькулятор стоимости ремонта
   ============================================================ */
'use strict';

/* ---------- utils ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const uid = (p = 'x') => p + Math.random().toString(36).slice(2, 9);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim();
const fold = (s) => norm(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const num = (v) => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const money = (v) => new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num(v)) + ' €';
const DEFAULT_GSHEET_URL = 'https://docs.google.com/spreadsheets/d/1O5kUh0DbEFlV0URskoVfO9VFTTAIeRhC/edit';

/* ---------- theme ---------- */
const THEME_KEY = 'devis-theme';
const readStoredTheme = () => { try { return localStorage.getItem(THEME_KEY); } catch (e) { return null; } };
const currentTheme = () => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
function applyTheme(t, save = true) {
  document.documentElement.dataset.theme = t;
  const b = $('#btnTheme');
  if (b) b.textContent = t === 'dark' ? '🌙' : '☀️';
  if (save) {
    try { localStorage.setItem(THEME_KEY, t); } catch (e) {}
    state.settings.theme = t;
    persist();
  }
}
applyTheme(readStoredTheme() || 'light', false); // до отрисовки, чтобы не мигало

const fmtDateNum = (iso) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}${m}${y}`; // DDMMYYYY
};
const fmtDateFr = (iso) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};
const todayIso = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

function toast(msg, err) {
  const box = $('#toaster');
  const t = document.createElement('div');
  t.className = 'toast' + (err ? ' err' : '');
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, 2600);
}

function infoDialog(title, text) {
  return new Promise((resolve) => {
    const root = $('#modalRoot');
    root.hidden = false;
    root.innerHTML = `<div class="modal" style="max-width:520px">
      <h3>${esc(title)}</h3>
      <p class="sub" style="white-space:pre-wrap;text-align:left">${esc(text)}</p>
      <div style="display:flex;justify-content:flex-end">
        <button class="btn" data-x="1">ОК</button>
      </div></div>`;
    const done = () => { root.hidden = true; root.innerHTML = ''; resolve(true); };
    root.onclick = (e) => { if (e.target === root) done(); };
    $('#modalRoot [data-x]').onclick = done;
  });
}

function confirmDialog(title, text, okLabel = 'Удалить') {
  return new Promise((resolve) => {
    const root = $('#modalRoot');
    root.hidden = false;
    root.innerHTML = `<div class="modal" style="max-width:440px">
      <h3>${esc(title)}</h3><p class="sub">${esc(text)}</p>
      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button class="btn ghost" data-x="0">Отмена</button>
        <button class="btn" style="border-color:#ff5f6d;color:#ffb7bd" data-x="1">${esc(okLabel)}</button>
      </div></div>`;
    const done = (v) => { root.hidden = true; root.innerHTML = ''; resolve(v); };
    root.onclick = (e) => { if (e.target === root) done(false); };
    $$('#modalRoot [data-x]').forEach((b) => b.onclick = () => done(b.dataset.x === '1'));
  });
}

/* ============================================================
   STATE
   ============================================================ */
let SEED = null;
const state = {
  works: [], rooms: [], units: [],
  company: { header: '', title: '', validity: '', signature: '', conditions: [] },
  settings: { tvaRate: 0, acompteRate: 30, tvaLabel: '', gsheetUrl: '' },
  devisList: [],
  current: null
};

function blankDevis() {
  const c = state.company || {};
  const s = state.settings || {};
  return {
    id: uid('d'),
    date: todayIso(),
    validity: c.validity || '1 mois',
    title: c.title || 'Descriptif des travaux : rénovation',
    client: { name: '', addr: '', city: '' },
    site: { name: '', addr: '', city: '' },
    lines: []
  };
}

const persist = debounce(() => api.save(JSON.parse(JSON.stringify(state))).catch(() => {}), 350);

function normalizeState() {
  if (!state.current) state.current = blankDevis();
  state.works = state.works || [];
  state.rooms = state.rooms || [];
  state.units = (state.units && state.units.length) ? state.units : ['M2', 'ML', 'U'];
  state.company = Object.assign({ conditions: [] }, state.company || {});
  state.settings = Object.assign({ tvaRate: 0, acompteRate: 30, tvaLabel: '', gsheetUrl: DEFAULT_GSHEET_URL, theme: 'light' }, state.settings || {});
  if (!state.settings.gsheetUrl) state.settings.gsheetUrl = DEFAULT_GSHEET_URL;
  if (!state.settings.theme) state.settings.theme = 'light';
  state.devisList = state.devisList || [];
  state.current.lines = state.current.lines || [];
}

/* ============================================================
   COMBOBOX
   ============================================================ */
const allCombos = [];
document.addEventListener('mousedown', (e) => {
  allCombos.forEach((c) => c.closeIfOutside(e));
});

function makeCombo({ value = '', placeholder = '', getOptions, onPick }) {
  const wrap = document.createElement('div');
  wrap.className = 'combo';
  wrap.innerHTML = `
    <input class="combo-input" spellcheck="false" placeholder="${esc(placeholder)}">
    <span class="combo-caret">▾</span>
    <div class="combo-list"></div>`;
  const input = wrap.querySelector('.combo-input');
  const list = wrap.querySelector('.combo-list');
  let selected = value;
  let query = '';
  let hl = -1;
  let opts = [];
  let closeTimer = null;

  const paint = () => {
    opts = getOptions(query);
    if (!opts.length) {
      list.innerHTML = `<div class="combo-empty">Нет совпадений</div>`;
      return;
    }
    const mark = (label) => {
      const q = fold(query);
      if (!q) return esc(label);
      const i = fold(label).indexOf(q);
      if (i < 0) return esc(label);
      return esc(label.slice(0, i)) + '<b>' + esc(label.slice(i, i + q.length)) + '</b>' + esc(label.slice(i + q.length));
    };
    list.innerHTML = opts.map((o, i) => {
      const right = o.price != null ? `<span class="price">${money(o.price)}<span class="unit">/${esc(o.unit || '')}</span></span>` : '';
      return `<div class="combo-opt${i === hl ? ' hl' : ''}" data-i="${i}">
        <span>${mark(o.label)}${o.hint ? `<small>${esc(o.hint)}</small>` : ''}</span>${right}</div>`;
    }).join('');
  };

  const open = () => {
    clearTimeout(closeTimer);
    wrap.classList.add('open');
    list.hidden = false;
    hl = -1;
    paint();
  };
  const close = () => {
    wrap.classList.remove('open');
    closeTimer = setTimeout(() => { list.hidden = true; }, 170);
  };

  const commit = () => {
    const v = input.value.trim();
    if (!v) { selected = ''; if (onPick) onPick({ label: '', id: null, create: false, empty: true }); return; }
    if (v === selected) return;
    const exact = getOptions('').find((o) => fold(o.label) === fold(v));
    if (exact) { pick(exact); return; }
    selected = v;
    if (onPick) onPick({ label: v, id: null, create: true });
  };

  const pick = (o) => {
    selected = o.label;
    input.value = o.label;
    close();
    if (onPick) onPick(o);
  };

  input.value = value;
  input.addEventListener('focus', () => { input.select(); open(); });
  input.addEventListener('click', open);
  input.addEventListener('change', commit);
  input.addEventListener('blur', () => setTimeout(() => { if (input.value.trim() !== selected) commit(); }, 120));
  input.addEventListener('input', () => { query = input.value; hl = -1; if (!wrap.classList.contains('open')) open(); else paint(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!wrap.classList.contains('open')) open();
      hl = Math.max(0, Math.min(opts.length - 1, hl + (e.key === 'ArrowDown' ? 1 : -1)));
      paint();
      const cur = list.querySelector('.hl');
      if (cur) cur.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (wrap.classList.contains('open') && opts.length && query !== selected) pick(opts[hl >= 0 ? hl : 0]);
      else { commit(); input.blur(); }
    } else if (e.key === 'Escape') { close(); input.value = selected; }
  });
  list.addEventListener('mousedown', (e) => {
    const o = e.target.closest('.combo-opt');
    if (!o) return;
    e.preventDefault();
    pick(opts[+o.dataset.i]);
  });

  const api2 = {
    set: (v) => { selected = v; input.value = v; },
    get: () => input.value,
    focus: () => input.focus(),
    closeIfOutside: (e) => { if (wrap.classList.contains('open') && !wrap.contains(e.target)) close(); }
  };
  wrap.api = api2;
  allCombos.push(api2);
  return wrap;
}

/* ============================================================
   TABS
   ============================================================ */
function initTabs() {
  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('.tab');
    if (!b) return;
    $$('.tab').forEach((t) => t.classList.toggle('active', t === b));
    $$('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + b.dataset.tab));
    if (b.dataset.tab === 'preview') refreshPreview();
    if (b.dataset.tab === 'archive') renderArchive();
  });
}
const goTo = (name) => $(`.tab[data-tab="${name}"]`).click();

/* ============================================================
   CALCULATOR
   ============================================================ */
function bindDevisFields() {
  const c = state.current;
  $('#devDate').value = c.date || todayIso();
  $('#devValidity').value = c.validity || '';
  $('#devTitle').value = c.title || '';
  $('#cliName').value = c.client.name;
  $('#cliAddr').value = c.client.addr;
  $('#cliCity').value = c.client.city;
  $('#siteName').value = c.site.name;
  $('#siteAddr').value = c.site.addr;
  $('#siteCity').value = c.site.city;
  $('#tvaRate').value = state.settings.tvaRate;
  $('#acompteRate').value = state.settings.acompteRate;
  $('#tvaLabel').textContent = state.settings.tvaLabel || '';
  paintNumber();
}

function paintNumber() {
  $('#devNumber').textContent = fmtDateNum(state.current.date) || '—';
}

function bindInputs() {
  const on = (sel, fn) => $(sel).addEventListener('input', (e) => { fn(e.target.value); persist(); });

  on('#devDate', (v) => { state.current.date = v; paintNumber(); schedulePreview(); });
  on('#devValidity', (v) => { state.current.validity = v; schedulePreview(); });
  on('#devTitle', (v) => { state.current.title = v; schedulePreview(); });
  on('#cliName', (v) => { state.current.client.name = v; schedulePreview(); });
  on('#cliAddr', (v) => { state.current.client.addr = v; schedulePreview(); });
  on('#cliCity', (v) => { state.current.client.city = v; schedulePreview(); });
  on('#siteName', (v) => { state.current.site.name = v; schedulePreview(); });
  on('#siteAddr', (v) => { state.current.site.addr = v; schedulePreview(); });
  on('#siteCity', (v) => { state.current.site.city = v; schedulePreview(); });

  $('#tvaRate').addEventListener('input', (e) => { state.settings.tvaRate = num(e.target.value); calcTotals(); persist(); });
  $('#acompteRate').addEventListener('input', (e) => { state.settings.acompteRate = num(e.target.value); calcTotals(); persist(); });
}

function roomOptions(query) {
  const q = fold(query);
  const list = state.rooms.map((r) => ({ label: r.name, id: r.id }));
  const filtered = q ? list.filter((o) => fold(o.label).includes(q)) : list;
  if (q && !filtered.some((o) => fold(o.label) === q)) {
    filtered.unshift({ label: query.trim(), id: null, create: true });
  }
  return filtered;
}

function workOptions(query) {
  const q = fold(query);
  const list = state.works.map((w) => ({ label: w.name, id: w.id, price: w.price, unit: w.unit }));
  const filtered = q ? list.filter((o) => fold(o.label).includes(q)) : list;
  if (q && !filtered.some((o) => fold(o.label) === q)) {
    filtered.unshift({ label: query.trim(), id: null, create: true });
  }
  return filtered;
}

function makeRow(line, index) {
  const tr = document.createElement('tr');
  tr.dataset.uid = line.uid;
  tr.dataset.room = line.room || '';
  tr.dataset.search = norm((line.room || '') + ' ' + (line.desc || ''));

  const tdIdx = document.createElement('td');
  tdIdx.className = 'c-num';
  tr.appendChild(tdIdx);

  // PIÈCE
  const tdRoom = document.createElement('td');
  const roomCombo = makeCombo({
    value: line.room || '',
    placeholder: 'Помещение…',
    getOptions: roomOptions,
    onPick: (o) => {
      line.room = o.label;
      if (o.create) ensureRoom(o.label);
      tr.dataset.room = line.room;
      refreshRoomFilter();
      persist(); schedulePreview();
    }
  });
  roomCombo.classList.add('cell');
  tdRoom.appendChild(roomCombo);
  tr.appendChild(tdRoom);

  // DESCRIPTION
  const tdDesc = document.createElement('td');
  const descCombo = makeCombo({
    value: line.desc || '',
    placeholder: 'Выберите работу из каталога…',
    getOptions: workOptions,
    onPick: (o) => {
      line.desc = o.label;
      line.workId = o.id;
      if (o.create) {
        const w = { id: uid('w'), name: o.label, price: line.price ?? null, unit: line.unit || 'M2' };
        state.works.push(w);
        line.workId = w.id;
        renderWorks();
      } else {
        const w = state.works.find((x) => x.id === o.id);
        if (w) {
          if (w.price != null) line.price = w.price;
          if (w.unit) line.unit = w.unit;
          tdPU.querySelector('input').value = line.price ?? '';
          unitSel.value = line.unit;
        }
      }
      tr.dataset.search = norm((line.room || '') + ' ' + (line.desc || ''));
      updateRowTotal(tr, line);
      calcTotals(); persist(); schedulePreview();
    }
  });
  descCombo.classList.add('cell');
  tdDesc.appendChild(descCombo);
  tr.appendChild(tdDesc);

  // QT
  const tdQty = document.createElement('td');
  const qty = document.createElement('input');
  qty.type = 'number'; qty.min = '0'; qty.step = '0.01'; qty.className = 'cell-in num';
  qty.value = line.qty ?? '';
  qty.placeholder = '0';
  qty.addEventListener('input', () => { line.qty = qty.value === '' ? '' : num(qty.value); updateRowTotal(tr, line); calcTotals(); persist(); schedulePreview(); });
  tdQty.appendChild(qty);
  tr.appendChild(tdQty);

  // PU HT
  const tdPU = document.createElement('td');
  const pu = document.createElement('input');
  pu.type = 'number'; pu.min = '0'; pu.step = '0.01'; pu.className = 'cell-in num';
  pu.value = line.price ?? '';
  pu.placeholder = '0,00';
  pu.addEventListener('input', () => { line.price = pu.value === '' ? null : num(pu.value); updateRowTotal(tr, line); calcTotals(); persist(); schedulePreview(); });
  tdPU.appendChild(pu);
  tr.appendChild(tdPU);

  // UNITÉ
  const tdUnit = document.createElement('td');
  const unitSel = document.createElement('select');
  unitSel.className = 'unit-select cell-in';
  const fillUnits = () => {
    unitSel.innerHTML = state.units.map((u) => `<option${u === line.unit ? ' selected' : ''}>${esc(u)}</option>`).join('');
  };
  fillUnits();
  unitSel._fill = fillUnits;
  unitSel.addEventListener('change', () => { line.unit = unitSel.value; persist(); schedulePreview(); });
  tdUnit.appendChild(unitSel);
  tr.appendChild(tdUnit);

  // TOTAL
  const tdTot = document.createElement('td');
  tdTot.className = 'total-cell';
  tr.appendChild(tdTot);

  // DEL
  const tdX = document.createElement('td');
  const del = document.createElement('button');
  del.className = 'row-del';
  del.title = 'Удалить строку';
  del.innerHTML = '&times;';
  del.addEventListener('click', () => {
    tr.classList.add('row-fade');
    setTimeout(() => {
      state.current.lines = state.current.lines.filter((l) => l.uid !== line.uid);
      tr.remove();
      renumber(); calcTotals(); renderEmpty(); refreshRoomFilter(); persist(); schedulePreview();
    }, 190);
  });
  tdX.appendChild(del);
  tr.appendChild(tdX);

  updateRowTotal(tr, line);
  return tr;
}

function updateRowTotal(tr, line) {
  const q = num(line.qty);
  const p = line.price == null ? 0 : num(line.price);
  tr.querySelector('.total-cell').textContent = line.price == null && line.qty === '' ? '—' : money(q * p);
}

function renumber() {
  $$('#linesBody tr').forEach((tr, i) => { tr.querySelector('.c-num').textContent = i + 1; });
}

function addLine(partial = {}) {
  const line = Object.assign({ uid: uid('l'), room: '', desc: '', workId: null, qty: '', unit: state.units[0] || 'M2', price: null }, partial);
  state.current.lines.push(line);
  const tr = makeRow(line);
  $('#linesBody').appendChild(tr);
  tr.classList.add('row-in');
  setTimeout(() => tr.classList.remove('row-in'), 320);
  renumber(); renderEmpty(); refreshRoomFilter(); calcTotals(); persist(); schedulePreview();
  return tr;
}

function renderLines() {
  const body = $('#linesBody');
  body.innerHTML = '';
  state.current.lines.forEach((line) => body.appendChild(makeRow(line)));
  renumber(); renderEmpty(); refreshRoomFilter(); calcTotals(); applyFilters();
}

function renderEmpty() {
  $('#linesEmpty').classList.toggle('show', $$('#linesBody tr').length === 0);
}

function refreshRoomFilter() {
  const sel = $('#roomFilter');
  const cur = sel.value;
  const used = [...new Set(state.current.lines.map((l) => l.room).filter(Boolean))];
  sel.innerHTML = '<option value="">Все помещения</option>' +
    used.map((r) => `<option${r === cur ? ' selected' : ''}>${esc(r)}</option>`).join('');
}

function applyFilters() {
  const q = norm($('#lineSearch').value);
  const rf = $('#roomFilter').value;
  let visible = 0;
  $$('#linesBody tr').forEach((tr) => {
    const ok = (!q || tr.dataset.search.includes(q)) && (!rf || tr.dataset.room === rf);
    if (ok) {
      visible++;
      if (tr.classList.contains('filtered-out')) {
        tr.classList.remove('filtered-out');
        tr.classList.add('row-in');
        setTimeout(() => tr.classList.remove('row-in'), 320);
      }
    } else if (!tr.classList.contains('filtered-out')) {
      tr.classList.add('row-fade');
      setTimeout(() => { tr.classList.add('filtered-out'); tr.classList.remove('row-fade'); }, 170);
    }
  });
  const empty = $('#linesEmpty');
  if ($$('#linesBody tr').length && !visible) {
    empty.classList.add('show');
    empty.querySelector('p').textContent = 'Ничего не найдено';
    empty.querySelector('span').textContent = 'Измените поисковый запрос или фильтр по помещениям';
  } else if (!$$('#linesBody tr').length) {
    empty.classList.add('show');
    empty.querySelector('p').textContent = 'В devis пока нет строк';
    empty.querySelector('span').textContent = 'Выберите помещение и работу из каталога — метражи и цены подставятся автоматически';
  } else empty.classList.remove('show');
}

function calcTotals() {
  const ht = state.current.lines.reduce((s, l) => s + num(l.qty) * (l.price == null ? 0 : num(l.price)), 0);
  const tva = ht * (num(state.settings.tvaRate) / 100);
  const ttc = ht + tva;
  const acompte = ttc * (num(state.settings.acompteRate) / 100);
  const solde = ttc - acompte;

  const set = (id, val) => {
    const el = $(id);
    if (el.textContent !== val) { el.textContent = val; el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
  };
  set('#totHT', money(ht));
  set('#totTVA', money(tva));
  set('#totTTC', money(ttc));
  set('#totAcompte', money(acompte));
  set('#totSolde', money(solde));

  $('#stLines').textContent = state.current.lines.length;
  $('#stRooms').textContent = new Set(state.current.lines.map((l) => l.room).filter(Boolean)).size;
  $('#stQty').textContent = state.current.lines.reduce((s, l) => s + num(l.qty), 0).toLocaleString('fr-FR');

  const byRoom = {};
  state.current.lines.forEach((l) => {
    if (!l.room) return;
    byRoom[l.room] = (byRoom[l.room] || 0) + num(l.qty) * (l.price == null ? 0 : num(l.price));
  });
  const top = Object.entries(byRoom).sort((a, b) => b[1] - a[1]).slice(0, 5);
  $('#roomShare').innerHTML = top.map(([r, v]) => {
    const w = ht > 0 ? Math.max(3, (v / ht) * 100) : 0;
    return `<div class="share-row"><div class="lbl"><span>${esc(r)}</span><span>${money(v)}</span></div>
      <div class="share-bar"><i style="width:${w}%"></i></div></div>`;
  }).join('');
}

function ensureRoom(name) {
  if (!name) return;
  if (!state.rooms.some((r) => norm(r.name) === norm(name))) {
    state.rooms.push({ id: uid('r'), name });
    renderRooms();
  }
}

function mergeCatalog(remote) {
  const changes = { worksAdded: [], worksUpdated: [], roomsAdded: [], unitsAdded: [] };
  const byKey = new Map(state.works.map((w) => [fold(w.name), w]));

  remote.works.forEach((rw) => {
    const key = fold(rw.name);
    const local = byKey.get(key);
    if (!local) {
      const w = { id: uid('w'), name: rw.name, price: rw.price, unit: rw.unit };
      state.works.push(w);
      byKey.set(key, w);
      changes.worksAdded.push(rw.name);
      return;
    }
    const diff = [];
    if (rw.price != null && rw.price !== num(local.price)) {
      diff.push(`цена ${money(local.price)} → ${money(rw.price)}`);
      local.price = rw.price;
    }
    if (rw.unit && local.unit !== rw.unit) {
      diff.push(`ед. ${local.unit} → ${rw.unit}`);
      local.unit = rw.unit;
    }
    if (diff.length) changes.worksUpdated.push(`${rw.name} (${diff.join(', ')})`);
  });

  remote.rooms.forEach((rr) => {
    if (!state.rooms.some((r) => fold(r.name) === fold(rr.name))) {
      state.rooms.push({ id: uid('r'), name: rr.name });
      changes.roomsAdded.push(rr.name);
    }
  });

  remote.units.forEach((u) => {
    const U = String(u || '').trim().toUpperCase();
    if (U && !state.units.includes(U)) {
      state.units.push(U);
      changes.unitsAdded.push(U);
    }
  });

  return changes;
}

/* ---------- quick pick modal ---------- */
function openRoomPicker() {
  const root = $('#modalRoot');
  root.hidden = false;
  root.innerHTML = `<div class="modal">
    <h3>Добавить помещение в devis</h3>
    <p class="sub">Кликните по помещению — будет добавлена новая строка</p>
    <div class="room-pick">
      ${state.rooms.map((r) => `<button data-room="${esc(r.name)}">${esc(r.name)}</button>`).join('') || '<span class="hint">Список помещений пуст — добавьте их на вкладке «Помещения»</span>'}
    </div>
    <div class="modal-close"><button class="btn ghost" data-close>Закрыть</button></div>
  </div>`;
  const close = () => { root.hidden = true; root.innerHTML = ''; };
  root.onclick = (e) => { if (e.target === root) close(); };
  $$('#modalRoot [data-close]').forEach((b) => b.onclick = close);
  $$('#modalRoot [data-room]').forEach((b) => b.onclick = () => {
    const tr = addLine({ room: b.dataset.room });
    close();
    const combos = $$('#linesBody tr:last-child .combo-input');
    if (combos[1]) setTimeout(() => combos[1].focus(), 60);
    if (tr) tr.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
}

/* ============================================================
   WORKS CATALOG
   ============================================================ */
function renderWorks() {
  const body = $('#worksBody');
  const q = norm($('#workSearch').value);
  const uf = $('#unitFilter').value;
  body.innerHTML = '';
  let shown = 0;

  state.works.forEach((w) => {
    const ok = (!q || norm(w.name).includes(q)) && (!uf || w.unit === uf);
    if (ok) shown++;
    const tr = document.createElement('tr');
    if (!ok) tr.style.display = 'none';
    tr.innerHTML = `
      <td class="c-id">${esc(w.id)}</td>
      <td><input class="cell-in" data-f="name" value="${esc(w.name)}"></td>
      <td><input class="cell-in num" data-f="price" type="number" step="0.01" min="0" value="${w.price ?? ''}" placeholder="—"></td>
      <td>
        <select class="unit-select cell-in" data-f="unit">
          ${state.units.map((u) => `<option${u === w.unit ? ' selected' : ''}>${esc(u)}</option>`).join('')}
        </select>
      </td>
      <td style="text-align:right"><button class="row-del" title="Удалить">&times;</button></td>`;

    tr.querySelector('[data-f="name"]').addEventListener('input', (e) => { w.name = e.target.value; persist(); schedulePreview(); });
    tr.querySelector('[data-f="price"]').addEventListener('input', (e) => { w.price = e.target.value === '' ? null : num(e.target.value); persist(); });
    tr.querySelector('[data-f="unit"]').addEventListener('change', (e) => { w.unit = e.target.value; persist(); });
    tr.querySelector('.row-del').addEventListener('click', async () => {
      if (!(await confirmDialog('Удалить работу?', w.name.slice(0, 90)))) return;
      state.works = state.works.filter((x) => x.id !== w.id);
      renderWorks(); persist(); toast('Работа удалена из каталога');
    });
    body.appendChild(tr);
  });

  $('#workCounter').textContent = `${shown} / ${state.works.length}`;
  $('#worksEmpty').classList.toggle('show', shown === 0);
}

function renderUnitFilter() {
  const sel = $('#unitFilter');
  const cur = sel.value;
  sel.innerHTML = '<option value="">Все единицы</option>' +
    state.units.map((u) => `<option${u === cur ? ' selected' : ''}>${esc(u)}</option>`).join('');
}

/* ============================================================
   ROOMS
   ============================================================ */
function renderRooms() {
  const grid = $('#roomsGrid');
  const q = norm($('#roomSearch').value);
  grid.innerHTML = '';
  let shown = 0;

  state.rooms.forEach((r) => {
    if (q && !norm(r.name).includes(q)) return;
    shown++;
    const card = document.createElement('div');
    card.className = 'room-card';
    card.innerHTML = `<div class="ico">⌂</div><input value="${esc(r.name)}"><button class="row-del" title="Удалить">&times;</button>`;
    card.querySelector('input').addEventListener('input', (e) => { r.name = e.target.value; persist(); refreshRoomFilter(); });
    card.querySelector('.row-del').addEventListener('click', async () => {
      if (!(await confirmDialog('Удалить помещение?', r.name))) return;
      state.rooms = state.rooms.filter((x) => x.id !== r.id);
      renderRooms(); persist(); toast('Помещение удалено');
    });
    grid.appendChild(card);
  });

  $('#roomCounter').textContent = `${shown} / ${state.rooms.length}`;
  $('#roomsEmpty').classList.toggle('show', shown === 0);
}

/* ============================================================
   COMPANY / SETTINGS
   ============================================================ */
function bindCompany() {
  const c = state.company;
  const s = state.settings;

  const on = (sel, fn) => $(sel).addEventListener('input', (e) => { fn(e.target.value); persist(); });
  on('#cmpHeader', (v) => c.header = v);
  on('#cmpTitle', (v) => c.title = v);
  on('#cmpValidity', (v) => c.validity = v);
  on('#cmpSignature', (v) => c.signature = v);
  on('#cmpConditions', (v) => c.conditions = v.split('\n'));
  on('#setTvaLabel', (v) => { s.tvaLabel = v; $('#tvaLabel').textContent = v; schedulePreview(); });
  on('#setTva', (v) => { s.tvaRate = num(v); $('#tvaRate').value = num(v); calcTotals(); });
  on('#setAcompte', (v) => { s.acompteRate = num(v); $('#acompteRate').value = num(v); calcTotals(); });
  on('#setGsheetUrl', (v) => { s.gsheetUrl = v; });
}

function fillCompany() {
  const c = state.company;
  const s = state.settings;
  const set = (sel, val) => { $(sel).value = val == null ? '' : val; };
  set('#cmpHeader', c.header);
  set('#cmpTitle', c.title);
  set('#cmpValidity', c.validity);
  set('#cmpSignature', c.signature);
  $('#cmpConditions').value = (c.conditions || []).join('\n');
  set('#setTvaLabel', s.tvaLabel);
  set('#setTva', s.tvaRate);
  set('#setAcompte', s.acompteRate);
  set('#setGsheetUrl', s.gsheetUrl);
  renderUnits();
}

function renderUnits() {
  $('#unitsRow').innerHTML = state.units.map((u, i) =>
    `<span class="unit-chip">${esc(u)}<button data-i="${i}" title="Удалить">×</button></span>`).join('');
  $$('#unitsRow button').forEach((b) => b.onclick = () => {
    const i = +b.dataset.i;
    if (state.units.length <= 1) return toast('Должна остаться хотя бы одна единица', true);
    state.units.splice(i, 1);
    renderUnits(); renderUnitFilter(); persist();
    $$('#linesBody .unit-select').forEach((sel) => sel._fill && sel._fill());
  });
}

/* ============================================================
   ARCHIVE
   ============================================================ */
function renderArchive() {
  const body = $('#archBody');
  const q = norm($('#archSearch').value);
  body.innerHTML = '';
  let shown = 0;

  const list = [...state.devisList].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  list.forEach((d) => {
    const hay = norm([d.number, d.client.name, d.client.addr, d.client.city, d.site.addr].join(' '));
    if (q && !hay.includes(q)) return;
    shown++;
    const ht = d.lines.reduce((s, l) => s + num(l.qty) * (l.price == null ? 0 : num(l.price)), 0);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-family:Consolas,monospace;color:var(--accent)">${esc(d.number)}</td>
      <td>${esc(fmtDateFr(d.date))}</td>
      <td>${esc(d.client.name || '—')}</td>
      <td>${esc(d.site.addr || d.client.addr || '—')}</td>
      <td class="total-cell">${money(ht)}</td>
      <td style="text-align:right;white-space:nowrap">
        <button class="btn sm" data-a="open">Открыть</button>
        <button class="btn sm" data-a="xlsx">Excel</button>
        <button class="btn sm accent" data-a="pdf">PDF</button>
        <button class="btn sm danger" data-a="del">×</button>
      </td>`;
    tr.querySelector('[data-a="open"]').onclick = () => {
      state.current = JSON.parse(JSON.stringify(d));
      renderAll(); goTo('calc'); toast(`Devis ${d.number} открыт`);
    };
    tr.querySelector('[data-a="xlsx"]').onclick = () => exportXlsx(d);
    tr.querySelector('[data-a="pdf"]').onclick = () => exportPdf(d);
    tr.querySelector('[data-a="del"]').onclick = async () => {
      if (!(await confirmDialog('Удалить devis?', `Devis ${d.number} — ${d.client.name || ''}`))) return;
      state.devisList = state.devisList.filter((x) => x.id !== d.id);
      renderArchive(); updateBadge(); persist(); toast('Devis удалён из архива');
    };
    body.appendChild(tr);
  });

  $('#archCounter').textContent = `${shown} / ${state.devisList.length}`;
  $('#archEmpty').classList.toggle('show', shown === 0);
}

function updateBadge() { $('#archiveBadge').textContent = state.devisList.length; }

function saveDevis(silent) {
  const c = state.current;
  c.number = fmtDateNum(c.date);
  const copy = JSON.parse(JSON.stringify(c));
  const i = state.devisList.findIndex((d) => d.id === c.id);
  if (i >= 0) state.devisList[i] = copy;
  else state.devisList.push(copy);
  updateBadge();
  persist();
  if (!silent) toast(`Devis ${c.number} сохранён`);
}

function newDevis() {
  state.current = blankDevis();
  renderAll();
  goTo('calc');
  toast('Создан новый devis');
}

/* ============================================================
   DOCUMENT MODEL + HTML
   ============================================================ */
function buildModel(d) {
  const c = d || state.current;
  return {
    company: state.company,
    number: fmtDateNum(c.date),
    dateObj: new Date((c.date || todayIso()) + 'T00:00:00'),
    dateFr: fmtDateFr(c.date),
    validity: c.validity,
    title: c.title,
    client: c.client,
    site: c.site,
    lines: c.lines.map((l) => ({
      room: l.room, desc: l.desc, qty: num(l.qty),
      unit: l.unit, price: l.price == null ? null : num(l.price)
    })),
    tvaLabel: state.settings.tvaLabel,
    tvaRate: num(state.settings.tvaRate),
    acompteRate: num(state.settings.acompteRate) / 100,
    conditions: state.company.conditions || [],
    signature: state.company.signature
  };
}

function calcModelTotals(m) {
  const ht = m.lines.reduce((s, l) => s + l.qty * (l.price || 0), 0);
  const tva = ht * (m.tvaRate / 100);
  const ttc = ht + tva;
  const acompte = ttc * m.acompteRate;
  return { ht, tva, ttc, acompte, solde: ttc - acompte };
}

function buildDevisHTML(m) {
  const t = calcModelTotals(m);
  let lastRoom = null;
  const rows = m.lines.map((l, i) => {
    const showRoom = l.room !== lastRoom ? l.room : '';
    lastRoom = l.room;
    return `<tr>
      <td class="a">${esc(showRoom)}</td>
      <td class="b">${esc(l.desc)}</td>
      <td class="c num">${l.qty}</td>
      <td class="d num">${l.price == null ? '' : money(l.price)}</td>
      <td class="e">${esc(l.unit)}</td>
      <td class="f num">${money(l.qty * (l.price || 0))}</td>
    </tr>`;
  }).join('') || `<tr><td class="a"></td><td class="b"></td><td class="c"></td><td class="d"></td><td class="e"></td><td class="f num">0,00 €</td></tr>`;

  const cond = (m.conditions || []).map((l) => `<p class="cond">${esc(l)}</p>`).join('');

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">
<title>Devis ${esc(m.number)}</title>
<style>
  *{box-sizing:border-box;}
  body{margin:0;padding:26px 30px;background:#fff;color:#111;
       font:11.5pt/1.45 "Segoe UI",Arial,Helvetica,sans-serif;}
  .head{font-size:12pt;color:#333;padding-bottom:10px;border-bottom:2px solid #111;margin-bottom:14px;}
  .meta{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;}
  .meta .left{font-size:15pt;font-weight:700;letter-spacing:.5px;}
  .meta .right{font-size:10.5pt;line-height:1.7;text-align:left;}
  .two{display:flex;gap:34px;margin-bottom:16px;}
  .two .col{flex:1;}
  .two h4{margin:0 0 7px;font-size:10.5pt;text-transform:none;color:#555;font-weight:600;}
  .two .box{border:1px solid #ccc;padding:9px 11px;border-radius:4px;min-height:74px;font-size:10.5pt;}
  .two .box b{display:inline-block;width:74px;color:#666;font-weight:600;}
  .title{background:#111;color:#fff;padding:7px 11px;font-weight:600;font-size:11pt;margin-bottom:0;}
  table{width:100%;border-collapse:collapse;}
  th{background:#eaeaea;font-size:9pt;letter-spacing:.5px;text-align:left;padding:7px 8px;border:1px solid #bbb;}
  td{padding:7px 8px;border:1px solid #ccc;vertical-align:top;font-size:10pt;}
  td.c,td.d,td.f{text-align:right;white-space:nowrap;}
  td.e{text-align:center;}
  td.a{font-weight:600;background:#f7f7f7;width:9%;}
  td.b{width:47%;}
  td.c{width:7%;} td.d{width:10%;} td.e{width:7%;} td.f{width:12%;}
  .sums{margin-top:14px;display:flex;justify-content:space-between;align-items:flex-start;gap:24px;}
  .tva-note{font-size:9.5pt;color:#444;max-width:48%;}
  .sumtbl{border-collapse:collapse;min-width:300px;}
  .sumtbl td{border:1px solid #ccc;padding:6px 10px;font-size:10.5pt;}
  .sumtbl td.l{text-align:left;background:#f2f2f2;font-weight:600;width:52%;}
  .sumtbl td.r{text-align:right;font-family:Consolas,monospace;white-space:nowrap;}
  .sumtbl tr.total td{background:#111;color:#fff;font-weight:700;}
  .conds{margin-top:20px;font-size:9.5pt;line-height:1.65;color:#222;}
  .conds p.cond{margin:0;}
  .sign{margin-top:34px;font-size:10pt;font-weight:600;}
  @page{size:A4;margin:12mm;}
  @media print{body{padding:0;}}
</style></head><body>
  <div class="head">${esc(m.company.header || '')}</div>
  <div class="meta">
    <div class="left">DEVIS n° ${esc(m.number)}</div>
    <div class="right">Date : <b>${esc(m.dateFr)}</b><br>validité : <b>${esc(m.validity || '')}</b></div>
  </div>
  <div class="two">
    <div class="col"><h4>A l’attention de:</h4><div class="box">
      <b>NOM</b>${esc(m.client.name)}<br><b>AD</b>${esc(m.client.addr)}<br><b>CP VILLE</b>${esc(m.client.city)}
    </div></div>
    <div class="col"><h4>Adresse du chantier:</h4><div class="box">
      <b>NOM</b>${esc(m.site.name)}<br><b>AD</b>${esc(m.site.addr)}<br><b>CP VILLE</b>${esc(m.site.city)}
    </div></div>
  </div>
  <div class="title">${esc(m.title || '')}</div>
  <table>
    <thead><tr><th>PIECE</th><th>DESCRIPTION</th><th>QT</th><th>PU HT</th><th>UNITE</th><th>TOTAL HT</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="sums">
    <div class="tva-note">${esc(m.tvaLabel || '')}</div>
    <table class="sumtbl">
      <tr><td class="l">TOTAL HT</td><td class="r">${money(t.ht)}</td></tr>
      <tr><td class="l">TOTAL TVA (${m.tvaRate}%)</td><td class="r">${money(t.tva)}</td></tr>
      <tr class="total"><td class="l">TOTAL TTC</td><td class="r">${money(t.ttc)}</td></tr>
      <tr><td class="l">ACOMPTE ${Math.round(m.acompteRate * 100)}%</td><td class="r">${money(t.acompte)}</td></tr>
      <tr><td class="l">SOLDE</td><td class="r">${money(t.solde)}</td></tr>
    </table>
  </div>
  <div class="conds">${cond}</div>
  <div class="sign">${esc(m.signature || '')}</div>
</body></html>`;
}

const schedulePreview = debounce(refreshPreview, 500);
function refreshPreview() {
  const f = $('#devisFrame');
  if (f && $('#tab-preview').classList.contains('active')) f.srcdoc = buildDevisHTML(buildModel());
  else if (f) f.srcdoc = buildDevisHTML(buildModel());
}

/* ============================================================
   EXPORT
   ============================================================ */
async function exportXlsx(d) {
  try {
    const model = buildModel(d);
    const res = await api.exportXlsx(model, `Devis_${model.number}.xlsx`);
    if (res && res.ok) toast('Excel сохранён: ' + res.filePath.split(/[\\/]/).pop());
  } catch (e) { toast('Ошибка экспорта Excel: ' + e.message, true); }
}
async function exportPdf(d) {
  try {
    const m = buildModel(d);
    const res = await api.exportPdf(buildDevisHTML(m), `Devis_${m.number}.pdf`);
    if (res && res.ok) toast('PDF сохранён: ' + res.filePath.split(/[\\/]/).pop());
  } catch (e) { toast('Ошибка экспорта PDF: ' + e.message, true); }
}
async function printDevis() {
  try { await api.printHtml(buildDevisHTML(buildModel())); toast('Открыто окно печати'); }
  catch (e) { toast('Ошибка печати: ' + e.message, true); }
}

/* ============================================================
   RENDER ALL / INIT
   ============================================================ */
function renderAll() {
  bindDevisFields();
  renderLines();
  renderWorks();
  renderUnitFilter();
  renderRooms();
  fillCompany();
  renderArchive();
  updateBadge();
  refreshPreview();
}

async function init() {
  initTabs();
  const data = await api.load();
  SEED = JSON.parse(JSON.stringify(data));
  Object.assign(state, data);
  normalizeState();
  applyTheme(state.settings.theme || readStoredTheme() || 'light', false);

  $('#btnTheme').addEventListener('click', () => {
    applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
    toast(currentTheme() === 'dark' ? 'Тёмная тема' : 'Светлая тема');
  });

  bindInputs();
  bindCompany();
  renderAll();

  // toolbar
  $('#lineSearch').addEventListener('input', applyFilters);
  $('#roomFilter').addEventListener('change', applyFilters);
  $('#btnAddLine').addEventListener('click', () => {
    const last = [...state.current.lines].reverse().find((l) => l.room);
    const tr = addLine({ room: last ? last.room : '' });
    tr.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const combos = tr.querySelectorAll('.combo-input');
    if (combos[1]) setTimeout(() => combos[1].focus(), 80);
  });
  $('#btnAddRoom').addEventListener('click', openRoomPicker);

  // works
  $('#workSearch').addEventListener('input', renderWorks);
  $('#unitFilter').addEventListener('change', renderWorks);
  $('#btnAddWork').addEventListener('click', () => {
    const w = { id: uid('w'), name: '', price: null, unit: state.units[0] || 'M2' };
    state.works.unshift(w);
    renderWorks(); persist();
    const inp = $('#worksBody tr:first-child [data-f="name"]');
    if (inp) { inp.focus(); inp.scrollIntoView({ block: 'center' }); }
  });
  $('#btnImportXlsx').addEventListener('click', async () => {
    const res = await api.importWorkbook();
    if (!res || res.ok === false) return;
    const doImport = res.works.length + res.rooms.length > 0
      ? await confirmDialog('Импорт из ' + res.file,
          `Заменить каталог: работ ${res.works.length}, помещений ${res.rooms.length}${res.units.length ? ', единиц ' + res.units.length : ''}?`, 'Импортировать')
      : false;
    if (!doImport) return;
    if (res.works.length) state.works = res.works;
    if (res.rooms.length) state.rooms = res.rooms;
    if (res.units.length) state.units = res.units;
    renderAll(); persist(); toast('Данные импортированы из ' + res.file);
  });

  $('#btnSyncGsheet').addEventListener('click', async () => {
    const url = (state.settings.gsheetUrl || '').trim() || DEFAULT_GSHEET_URL;
    const btn = $('#btnSyncGsheet');
    btn.disabled = true;
    btn.textContent = '⏳ Загрузка…';
    const res = await api.syncGsheet(url);
    btn.disabled = false;
    btn.textContent = '⟳ Обновить данные';
    if (!res || !res.ok) return toast((res && res.error) || 'Не удалось обновить данные', true);

    const changes = mergeCatalog(res);
    renderAll(); persist();

    const parts = [];
    if (changes.worksAdded.length) parts.push(`+${changes.worksAdded.length} новых работ`);
    if (changes.worksUpdated.length) parts.push(`~${changes.worksUpdated.length} изменено`);
    if (changes.roomsAdded.length) parts.push(`+${changes.roomsAdded.length} помещений`);
    if (changes.unitsAdded.length) parts.push(`+${changes.unitsAdded.length} единиц`);
    const summary = parts.length ? parts.join(', ') : 'изменений нет';

    const lines = [
      ...changes.worksAdded.map((n) => '+ ' + n),
      ...changes.worksUpdated.map((t) => '~ ' + t),
      ...changes.roomsAdded.map((n) => '+ помещение: ' + n),
      ...changes.unitsAdded.map((n) => '+ единица: ' + n)
    ].slice(0, 40);

    await infoDialog('Обновление из Google Таблицы',
      `Синхронизировано: работ ${res.works.length}, помещений ${res.rooms.length}.\n\n${summary}` +
      (lines.length ? '\n\n' + lines.join('\n') : '') +
      (lines.length === 40 ? '\n…' : ''));
    toast('Каталог обновлён: ' + summary);
  });

  // rooms
  $('#roomSearch').addEventListener('input', renderRooms);
  const addRoom = () => {
    const v = $('#newRoomInput').value.trim();
    if (!v) return;
    ensureRoom(v);
    $('#newRoomInput').value = '';
    renderRooms(); persist(); toast(`Помещение «${v}» добавлено`);
  };
  $('#btnAddRoom2').addEventListener('click', addRoom);
  $('#newRoomInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') addRoom(); });

  // units
  $('#btnAddUnit').addEventListener('click', () => {
    const v = $('#newUnitInput').value.trim().toUpperCase();
    if (!v) return;
    if (state.units.includes(v)) return toast('Такая единица уже есть', true);
    state.units.push(v);
    $('#newUnitInput').value = '';
    renderUnits(); renderUnitFilter(); persist();
    $$('#linesBody .unit-select').forEach((s) => s._fill && s._fill());
  });

  // archive search
  $('#archSearch').addEventListener('input', renderArchive);

  // main actions
  $('#btnNew').addEventListener('click', newDevis);
  $('#btnSave').addEventListener('click', () => saveDevis(false));
  $('#btnXlsx').addEventListener('click', () => exportXlsx());
  $('#btnPdf').addEventListener('click', () => exportPdf());
  $('#btnPrint').addEventListener('click', printDevis);
  $('#btnPrevXlsx').addEventListener('click', () => exportXlsx());
  $('#btnPrevPdf').addEventListener('click', () => exportPdf());
  $('#btnPrevPrint').addEventListener('click', printDevis);

  // shortcuts
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === 's') { e.preventDefault(); saveDevis(false); }
    else if (k === 'e') { e.preventDefault(); exportXlsx(); }
    else if (k === 'p') { e.preventDefault(); exportPdf(); }
    else if (k === 'n') { e.preventDefault(); newDevis(); }
  });

  api.onMenu((action) => {
    if (action === 'new') newDevis();
    else if (action === 'save') saveDevis(false);
    else if (action === 'xlsx') exportXlsx();
    else if (action === 'pdf') exportPdf();
  });

  window.addEventListener('beforeunload', () => {
    api.save(JSON.parse(JSON.stringify(state)));
  });

  refreshPreview();
}

document.addEventListener('DOMContentLoaded', init);
