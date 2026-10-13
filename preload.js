const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  load: () => ipcRenderer.invoke('store:load'),
  save: (data) => ipcRenderer.invoke('store:save', data),
  exportXlsx: (model, defaultName) => ipcRenderer.invoke('export:xlsx', { model, defaultName }),
  exportPdf: (html, defaultName) => ipcRenderer.invoke('export:pdf', { html, defaultName }),
  printHtml: (html) => ipcRenderer.invoke('print:html', { html }),
  importWorkbook: () => ipcRenderer.invoke('import:workbook'),
  syncGsheet: (url) => ipcRenderer.invoke('sync:gsheet', { url }),
  info: (title, message) => ipcRenderer.invoke('dialog:info', { title, message }),
  onMenu: (cb) => ipcRenderer.on('menu', (_e, action) => cb(action))
});
