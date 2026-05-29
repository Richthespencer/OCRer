const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    getConfig: () => ipcRenderer.invoke('get-config'),
    updateConfig: (config) => ipcRenderer.invoke('update-config', config),
    testOCR: () => ipcRenderer.invoke('test-ocr'),
    onOCRResult: (callback) => ipcRenderer.on('ocr-result', (event, text) => callback(text)),
    onOCRProcessing: (callback) => ipcRenderer.on('ocr-processing', (event, processing) => callback(processing))
});
