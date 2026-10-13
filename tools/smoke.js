const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

// --- stub IPC used by preload (main.js is not loaded in smoke mode) ---
const SEED = () => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'seed-data.json'), 'utf8'));
ipcMain.handle('store:load', () => SEED());
ipcMain.handle('store:save', () => ({ ok: true }));
ipcMain.handle('export:xlsx', () => ({ ok: false, canceled: true }));
ipcMain.handle('export:pdf', () => ({ ok: false, canceled: true }));
ipcMain.handle('print:html', () => ({ ok: false }));
ipcMain.handle('import:workbook', () => ({ ok: false, canceled: true }));
ipcMain.handle('sync:gsheet', () => ({ ok: false, error: 'smoke: offline' }));
ipcMain.handle('dialog:info', () => ({ ok: true }));

const OUT = path.join(__dirname, '..', 'release');
fs.mkdirSync(OUT, { recursive: true });

app.setPath('userData', path.join(require('os').tmpdir(), 'devis-smoke-data'));

const errors = [];

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1440, height: 940, show: false,
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.webContents.on('console-message', (...args) => {
    const a = (args[0] && typeof args[0] === 'object' && 'message' in args[0])
      ? args[0]
      : { level: args[1], message: args[2], line: args[3], sourceId: args[4] };
    const line = `[console:${a.level}] ${a.message} (${a.sourceId}:${a.line})`;
    console.log(line);
    if (a.level >= 3) errors.push(line);
  });
  win.webContents.on('preload-error', (_e, p, err) => errors.push('preload-error ' + p + ' ' + err.message));
  win.webContents.on('did-fail-load', (_e, c, d, url) => errors.push('did-fail-load ' + c + ' ' + d + ' ' + url));

  await win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));

  const js = async (code) => win.webContents.executeJavaScript(code, true);

  // wait for app init
  for (let i = 0; i < 60; i++) {
    const ok = await js('!!(state && state.works && state.works.length)').catch(() => false);
    if (ok) break;
    await new Promise((r) => setTimeout(r, 250));
  }

  const ready = await js('!!(state && state.works && state.works.length)').catch(() => false);
  if (!ready) errors.push('APP DID NOT INITIALISE');

  // fill sample data
  await js(`
    state.current.client = { name:'Virginie Lambert', addr:'41 RUE DE LA RIPOSSERIE', city:'Nantes 44100' };
    state.current.site = { name:'Virginie Lambert', addr:'41 RUE DE LA RIPOSSERIE', city:'Nantes 44100' };
    bindDevisFields();
    addLine({ room:'Salon', desc: state.works[9].name, qty:33, unit:state.works[9].unit, price:state.works[9].price, workId:state.works[9].id });
    addLine({ room:'Salon', desc: state.works[30].name, qty:33, unit:state.works[30].unit, price:state.works[30].price, workId:state.works[30].id });
    addLine({ room:'Chambre 1', desc: state.works[43].name, qty:9.88, unit:'M2', price:49.83 });
    addLine({ room:'Chambre 1', desc: state.works[17].name, qty:9.88, unit:'M2', price:25 });
    addLine({ room:'Cuisine', desc: state.works[62].name, qty:12, unit:'M2', price:30 });
    calcTotals();
  `).catch((e) => errors.push('setup: ' + e.message));

  const shot = async (name) => {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(OUT, name), img.toPNG());
    console.log('shot ->', name);
  };

  await new Promise((r) => setTimeout(r, 600));
  await shot('smoke-1-calc.png');

  await js('document.querySelector(\'.tab[data-tab="preview"]\').click()');
  await new Promise((r) => setTimeout(r, 900));
  await shot('smoke-2-preview.png');

  await js('document.querySelector(\'.tab[data-tab="works"]\').click()');
  await new Promise((r) => setTimeout(r, 500));
  await shot('smoke-3-works.png');

  await js('document.querySelector(\'.tab[data-tab="rooms"]\').click()');
  await new Promise((r) => setTimeout(r, 500));
  await shot('smoke-4-rooms.png');

  await js('document.querySelector(\'.tab[data-tab="company"]\').click()');
  await new Promise((r) => setTimeout(r, 500));
  await shot('smoke-5-company.png');

  // xlsx export model sanity (no dialog): build model + html in renderer
  const check = await js(`(function(){
    const m = buildModel();
    const t = calcModelTotals(m);
    const html = buildDevisHTML(m);
    return { n:m.number, lines:m.lines.length, ht:t.ht, htmlLen:html.length, hasTable: html.indexOf('TOTAL HT')>0 };
  })()`).catch((e) => ({ err: e.message }));
  console.log('MODEL CHECK:', JSON.stringify(check));
  if (!check || check.err || !check.hasTable || !check.lines) errors.push('model check failed: ' + JSON.stringify(check));

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO ERRORS');
  app.exit(errors.length ? 1 : 0);
});

setTimeout(() => { console.log('TIMEOUT'); app.exit(2); }, 60000);
