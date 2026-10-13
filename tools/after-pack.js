'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const asar = require('@electron/asar');

const MISSING = ['call-bind-apply-helpers', 'archiver-utils', 'es-abstract-get'];

module.exports = async function afterPack(context) {
  const asarPath = path.join(context.appOutDir, 'resources', 'app.asar');
  if (!fs.existsSync(asarPath)) return;

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'asar-patch-'));
  try {
    asar.extractAll(asarPath, tmp);
    for (const pkg of MISSING) {
      const src = path.join(context.appDir || path.join(__dirname, '..'), 'node_modules', pkg);
      const dst = path.join(tmp, 'node_modules', pkg);
      if (!fs.existsSync(src)) {
        console.warn(`afterPack: source not found, skip ${pkg}`);
        continue;
      }
      fs.cpSync(src, dst, { recursive: true, force: true });
      console.log(`afterPack: injected node_modules/${pkg}`);
    }
    fs.rmSync(asarPath, { force: true });
    await asar.createPackage(tmp, asarPath);
    console.log('afterPack: app.asar repacked');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
};
