const { contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Theme
    saveTheme: (theme) => ipcRenderer.send('save-theme', theme),

    // Settings
    setApiKey: (key) => ipcRenderer.invoke('set-api-key', key),
    setModel: (model) => ipcRenderer.invoke('set-model', model),
    getApiKey: () => ipcRenderer.invoke('get-api-key'),
    getSelectedModel: () => ipcRenderer.invoke('get-selected-model'),
    // Google AI Studio
    openExternal: (url) => ipcRenderer.send('open-external', url),

    // Files
    openFile: () => ipcRenderer.invoke('open-file'),
    saveFile: (content) => ipcRenderer.invoke('save-file', content),
    
    // AI Analysis
    verifyCode: (code) => ipcRenderer.invoke('verify-code', code),
    abortVerify: () => ipcRenderer.send('abort-verify'),

    // Clipboard (Routed through Main Process for maximum stability)
    copyToClipboard: (text) => ipcRenderer.send('copy-to-clipboard', text),
});
