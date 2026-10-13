const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const ExcelJS = require('exceljs');

const SEED_PATH = path.join(__dirname, 'src', 'seed-data.json');
let win = null;

function storePath() {
  return path.join(app.getPath('userData'), 'store.json');
}

function readStore() {
  try {
    const raw = fs.readFileSync(storePath(), 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    try {
      return JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
    } catch (e2) {
      return { works: [], rooms: [], units: [], company: {}, settings: {} };
    }
  }
}

function writeStore(data) {
  const p = storePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.copyFileSync(tmp, p);
  fs.unlinkSync(tmp);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1760,
    height: 1080,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: '#0d1117',
    title: 'Devis Rénovation',
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });

  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.once('ready-to-show', () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function buildMenu() {
  const template = [
    {
      label: 'Fichier',
      submenu: [
        { label: 'Nouveau devis', accelerator: 'CmdOrCtrl+N', click: () => win && win.webContents.send('menu', 'new') },
        { label: 'Enregistrer', accelerator: 'CmdOrCtrl+S', click: () => win && win.webContents.send('menu', 'save') },
        { type: 'separator' },
        { label: 'Exporter en Excel', accelerator: 'CmdOrCtrl+E', click: () => win && win.webContents.send('menu', 'xlsx') },
        { label: 'Exporter en PDF', accelerator: 'CmdOrCtrl+P', click: () => win && win.webContents.send('menu', 'pdf') },
        { type: 'separator' },
        { role: 'quit', label: 'Quitter' }
      ]
    },
    {
      label: 'Édition',
      submenu: [
        { role: 'undo', label: 'Annuler' },
        { role: 'redo', label: 'Rétablir' },
        { type: 'separator' },
        { role: 'cut', label: 'Couper' },
        { role: 'copy', label: 'Copier' },
        { role: 'paste', label: 'Coller' },
        { role: 'selectAll', label: 'Tout sélectionner' }
      ]
    },
    {
      label: 'Affichage',
      submenu: [
        { role: 'reload', label: 'Recharger' },
        { role: 'zoomIn', label: 'Zoom avant' },
        { role: 'zoomOut', label: 'Zoom arrière' },
        { role: 'resetZoom', label: 'Zoom par défaut' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Plein écran' }
      ]
    },
    {
      label: 'Aide',
      submenu: [
        {
          label: 'Ouvrir le dossier de données',
          click: () => shell.showItemInFolder(storePath())
        },
        {
          label: 'À propos',
          click: () =>
            dialog.showMessageBox(win, {
              type: 'info',
              title: 'À propos',
              message: 'Devis Rénovation 1.0.0',
              detail: 'Calculateur de coût de rénovation et générateur de devis.\nLes données sont enregistrées localement sur ce PC.'
            })
        }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ---------------- IPC ---------------- */

ipcMain.handle('store:load', () => readStore());

ipcMain.handle('store:save', (_e, data) => {
  writeStore(data);
  return { ok: true };
});

ipcMain.handle('export:xlsx', async (_e, { model, defaultName }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Exporter le devis en Excel',
    defaultPath: defaultName || 'devis.xlsx',
    filters: [{ name: 'Classeur Excel', extensions: ['xlsx'] }]
  });
  if (canceled || !filePath) return { ok: false, canceled: true };

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Devis');
  writeDevisSheet(ws, model);
  await wb.xlsx.writeFile(filePath);
  return { ok: true, filePath };
});

ipcMain.handle('export:pdf', async (_e, { html, defaultName }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Exporter le devis en PDF',
    defaultPath: defaultName || 'devis.pdf',
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (canceled || !filePath) return { ok: false, canceled: true };

  const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  const data = await w.webContents.printToPDF({
    printBackground: true,
    pageSize: 'A4',
    margins: { top: 0.47, bottom: 0.47, left: 0.39, right: 0.39 }
  });
  fs.writeFileSync(filePath, data);
  w.destroy();
  return { ok: true, filePath };
});

ipcMain.handle('print:html', async (_e, { html }) => {
  const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((resolve) => {
    w.webContents.print({ silent: false, printBackground: true, pageSize: 'A4' }, (ok, reason) => {
      if (!ok && reason !== 'cancelled') dialog.showErrorBox('Impression', String(reason));
      resolve();
    });
  });
  w.destroy();
  return { ok: true };
});

function parseWorkbook(wb) {
  const find = (frag) => {
    const n = wb.SheetNames.find((s) => s.toLowerCase().includes(frag));
    return n ? wb.Sheets[n] : null;
  };
  const rows = (ws) => (ws ? XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: null }) : []);

  const works = rows(find('description'))
    .map((r, i) => ({
      id: 'w' + Date.now().toString(36) + i,
      name: String(r[0] == null ? '' : r[0]).replace(/\s+/g, ' ').trim(),
      price: r[1] == null || r[1] === '' ? null : Number(r[1]) || null,
      unit: String(r[2] == null ? '' : r[2]).trim().toUpperCase() || 'M2'
    }))
    .filter((w) => w.name);

  const rooms = rows(find('pi'))
    .map((r, i) => ({
      id: 'r' + Date.now().toString(36) + i,
      name: String(r[0] == null ? '' : r[0]).replace(/\s+/g, ' ').trim()
    }))
    .filter((r) => r.name);

  const units = rows(find('unit'))
    .map((r) => String(r[0] == null ? '' : r[0]).trim().toUpperCase())
    .filter(Boolean);

  return { works, rooms, units };
}

ipcMain.handle('sync:gsheet', async (_e, { url }) => {
  const u = String(url || '').trim();
  const m = u.match(/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!m) return { ok: false, error: 'Некорректная ссылка на Google Таблицу' };
  const exportUrl = `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=xlsx`;
  let buf;
  try {
    const resp = await fetch(exportUrl, { redirect: 'follow' });
    if (!resp.ok) return { ok: false, error: `Таблица недоступна (HTTP ${resp.status}) — проверьте, что она расшарена «Все, у кого есть ссылка»` };
    buf = Buffer.from(await resp.arrayBuffer());
  } catch (e) {
    return { ok: false, error: 'Не удалось загрузить таблицу: ' + e.message };
  }
  let data;
  try {
    const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
    data = parseWorkbook(wb);
  } catch (e) {
    return { ok: false, error: 'Не удалось прочитать таблицу: ' + e.message };
  }
  return { ok: true, ...data, ts: Date.now() };
});

ipcMain.handle('import:workbook', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Importer un classeur (Description / pièces)',
    filters: [{ name: 'Classeur Excel', extensions: ['xlsx', 'xlsm', 'xls'] }],
    properties: ['openFile']
  });
  if (canceled || !filePaths.length) return { ok: false, canceled: true };

  const wb = XLSX.readFile(filePaths[0], { cellDates: true });
  const { works, rooms, units } = parseWorkbook(wb);

  return { ok: true, works, rooms, units, file: path.basename(filePaths[0]) };
});

ipcMain.handle('dialog:info', async (_e, { title, message }) => {
  await dialog.showMessageBox(win, { type: 'info', title, message });
  return { ok: true };
});

/* -------------- Excel document model -------------- */

function writeDevisSheet(ws, model) {
  const thin = { style: 'thin' };
  const border = (sides) => {
    const b = {};
    if (sides.includes('top')) b.top = thin;
    if (sides.includes('bottom')) b.bottom = thin;
    if (sides.includes('left')) b.left = thin;
    if (sides.includes('right')) b.right = thin;
    return b;
  };

  ws.columns = [
    { width: 12 }, { width: 46 }, { width: 7 },
    { width: 9 }, { width: 9 }, { width: 13 }
  ];
  ws.getRow(1).height = 45;

  const put = (r, c, v, opts = {}) => {
    const cell = ws.getCell(r, c);
    if (opts.formula) cell.value = { formula: opts.formula, result: 0 };
    else cell.value = v;
    if (opts.numFmt) cell.numFmt = opts.numFmt;
    if (opts.bold) cell.font = { bold: true };
    return cell;
  };

  put(1, 2, model.company.header || '');
  put(2, 1, 'DEVIS n°');
  put(2, 5, 'Date : ');
  put(2, 6, model.dateObj, { numFmt: 'dd/mm/yyyy' });
  put(3, 1, model.number);
  put(3, 5, 'validité : ');
  put(3, 6, model.validity || '1 mois');

  put(5, 1, 'A l’attention de: ');
  put(5, 4, 'Adresse du chantier: ');
  const labels = ['NOM', 'AD', 'CP VILLE'];
  const keys = ['name', 'addr', 'city'];
  labels.forEach((lab, i) => {
    put(6 + i, 1, lab);
    put(6 + i, 2, (model.client && model.client[keys[i]]) || '');
    put(6 + i, 4, lab);
    put(6 + i, 5, (model.site && model.site[keys[i]]) || '');
  });

  put(10, 1, model.title || '');
  ws.mergeCells(10, 1, 10, 6);
  const heads = ['PIECE', 'DESCRIPTION', 'QT', 'PU HT', 'UNITE', 'TOTAL HT'];
  heads.forEach((h, i) => put(11, i + 1, h, { bold: true }));

  let r = 12;
  const firstData = r;
  model.lines.forEach((ln) => {
    put(r, 1, ln.room || '');
    put(r, 2, ln.desc || '');
    put(r, 3, Number(ln.qty) || 0, { numFmt: '0.00' });
    if (ln.price == null) {
      put(r, 4, '');
      put(r, 6, 0, { numFmt: '#,##0.00' });
    } else {
      put(r, 4, Number(ln.price), { numFmt: '#,##0.00' });
      put(r, 6, 0, { formula: `C${r}*D${r}`, numFmt: '#,##0.00' });
    }
    put(r, 5, ln.unit || '');
    r++;
  });
  if (!model.lines.length) {
    put(r, 1, '');
    put(r, 3, 0);
    put(r, 6, 0, { numFmt: '#,##0.00' });
    r++;
  }
  const lastData = r - 1;

  const totalRow = r;
  put(totalRow, 5, 'TOTAL HT', { bold: true });
  put(totalRow, 6, 0, { formula: `SUM(F${firstData}:F${lastData})`, numFmt: '#,##0.00', bold: true });

  put(totalRow + 1, 3, model.tvaLabel || '');
  put(totalRow + 1, 5, 'TOTAL TVA');
  put(totalRow + 1, 6, 0, { formula: `${Number(model.tvaRate) || 0}%*F${totalRow}`, numFmt: '#,##0.00' });

  put(totalRow + 2, 5, 'TOTAL TTC');
  put(totalRow + 2, 6, 0, { formula: `F${totalRow}+F${totalRow + 1}`, numFmt: '#,##0.00' });

  put(totalRow + 3, 5, `ACOMPTE ${Math.round((Number(model.acompteRate) || 0) * 100)}%`);
  put(totalRow + 3, 6, 0, { formula: `F${totalRow + 2}*${Number(model.acompteRate) || 0}`, numFmt: '#,##0.00' });

  put(totalRow + 4, 5, 'SOLDE');
  put(totalRow + 4, 6, 0, { formula: `F${totalRow + 2}-F${totalRow + 3}`, numFmt: '#,##0.00' });

  let cr = totalRow + 6;
  (model.conditions || []).forEach((line) => {
    put(cr, 1, line);
    ws.mergeCells(cr, 1, cr, 6);
    cr++;
  });
  cr += 1;
  put(cr, 1, model.signature || '');

  // рамки таблицы как в примере: контур B..F вокруг строк данных + линия над итогами
  for (let rr = firstData; rr <= lastData; rr++) {
    const sides = [];
    if (rr === firstData) sides.push('top');
    ws.getCell(rr, 2).border = border([...sides, 'left']);
    for (let cc = 3; cc <= 5; cc++) ws.getCell(rr, cc).border = border(sides);
    ws.getCell(rr, 6).border = border([...sides, 'right']);
  }
  for (let cc = 1; cc <= 6; cc++) ws.getCell(totalRow, cc).border = border(['top']);
}

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
