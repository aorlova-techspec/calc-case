const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const src = path.join(__dirname, '..', 'data.xlsx');
const out = path.join(__dirname, '..', 'src', 'seed-data.json');

const wb = XLSX.readFile(src, { cellDates: true });

const sheetBy = (frag) => {
  const name = wb.SheetNames.find((n) => n.toLowerCase().includes(frag));
  return name ? { name, ws: wb.Sheets[name] } : null;
};

const rowsOf = (ws) => (ws ? XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: null }) : []);

// --- Description : catalogue des travaux (libelle, prix, unite)
const desc = sheetBy('description');
const works = rowsOf(desc && desc.ws)
  .map((r, i) => ({
    id: 'w' + (i + 1),
    name: String(r[0] == null ? '' : r[0]).trim(),
    price: typeof r[1] === 'number' ? r[1] : r[1] == null || r[1] === '' ? null : Number(r[1]) || null,
    unit: String(r[2] == null ? '' : r[2]).trim().toUpperCase() || 'M2'
  }))
  .filter((w) => w.name);

// --- pieces : liste des lieux
const pieces = sheetBy('pi');
const rooms = rowsOf(pieces && pieces.ws)
  .map((r, i) => ({ id: 'r' + (i + 1), name: String(r[0] == null ? '' : r[0]).replace(/\s+/g, ' ').trim() }))
  .filter((r) => r.name);

// --- Unites
const units = rowsOf(sheetBy('unit') && sheetBy('unit').ws)
  .map((r) => String(r[0] == null ? '' : r[0]).trim().toUpperCase())
  .filter(Boolean);

// --- Devis : en-tete + conditions
const dev = sheetBy('devis');
const cell = (c) => {
  const v = dev && dev.ws[c] ? dev.ws[c].v : null;
  return v == null ? '' : String(v).trim();
};

const condLines = [];
for (let i = 28; i <= 39; i++) {
  const v = cell('A' + i);
  if (v) condLines.push(v);
}
const signature = cell('A41');

const seed = {
  units: units.length ? units : ['M2', 'ML', 'U'],
  works,
  rooms,
  company: {
    header: cell('B1'),
    title: cell('A10') || 'Descriptif des travaux : rénovation',
    validity: cell('F3') || '1 mois',
    signature,
    conditions: condLines
  },
  settings: {
    tvaRate: 0,
    acompteRate: 0.3,
    tvaLabel: cell('C24') || 'TVA non applicable - art. 293B du CGI'
  }
};

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(seed, null, 2), 'utf8');

console.log('works:', works.length, '| rooms:', rooms.length, '| units:', seed.units.length, '| conditions:', condLines.length);
