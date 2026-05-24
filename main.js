const { app, BrowserWindow, nativeTheme, ipcMain, shell, dialog, Menu, MenuItem, clipboard } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const { GoogleGenAI } = require('@google/genai');
const Diff = require('diff');

let activeAbortController = null;

async function createWindow() {
  const { default: Store } = await import('electron-store');
  const store = new Store();

  const savedTheme = store.get('theme');
  const systemDark = nativeTheme.shouldUseDarkColors;
  const theme = savedTheme || (systemDark ? 'dark' : 'light');
  const bgColor = theme === 'dark' ? '#000814' : '#ffffff';

  const win = new BrowserWindow({
    width: 1500,
    height: 900,
    backgroundColor: bgColor,
    show: false,
    // autoHideMenuBar: true, Leave it while developing 
    icon: path.join(__dirname, 'assets/icons/512x512.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // --- IPC HANDLERS ---

  // Save Theme
  ipcMain.on('save-theme', async (event, themeValue) => {
    store.set('theme', themeValue);
  });

  // Save API Key
  ipcMain.handle('set-api-key', async (event, key) => {
    store.set('apiKey', key);
    return { success: true };
  });

  // Save AI Model
  ipcMain.handle('set-model', async (event, model) => {
    store.set('model', model);
    return { success: true };
  });

  // Get API Key (for loading settings on start)
  ipcMain.handle('get-api-key', async () => {
    return store.get('apiKey');
  });

  // Get AI Model (for loading settings on start)
  ipcMain.handle('get-selected-model', async () => {
    return store.get('model');
  });

  // Listen for requests to open external links
  ipcMain.on('open-external', (event, url) => {
    shell.openExternal(url);
  });

  ipcMain.on('abort-verify', () => {
    if (activeAbortController) {
      activeAbortController.abort();
      activeAbortController = null;
    }
  });

  ipcMain.handle('open-file', async () => {
    try {
      const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openFile'],
      });
      if (!canceled && filePaths.length > 0) {
        const content = await fs.readFile(filePaths[0], 'utf8');
        return content;
      }
    } catch (error) {
      console.error('Failed to open file:', error);
    }
    return null;
  });

  // Save file to system
  ipcMain.handle('save-file', async (event, content) => {
    try {
      const { canceled, filePath } = await dialog.showSaveDialog({
        title: 'Save Clean Code',
        filters: [
          { name: 'Text Files', extensions: ['txt'] },
          { name: 'JavaScript Files', extensions: ['js'] },
          { name: 'All Files', extensions: ['*'] }
        ],
        defaultPath: 'cleaned_code.txt'
      });

      if (canceled || !filePath) {
        return { success: false, cancelled: true };
      }

      await fs.writeFile(filePath, content, 'utf8');

      return { success: true, filePath };
    } catch (error) {
      console.error('Save File Error:', error);
      return { success: false, error: error.message };
    }
  });

  // Copy text to system clipboard
  ipcMain.on('copy-to-clipboard', (event, text) => {
    clipboard.writeText(text);
  });

  ipcMain.handle('verify-code', async (event, code) => {
    try {
      if (activeAbortController) {
        activeAbortController.abort();
      }
      activeAbortController = new AbortController();

      const apiKey = store.get('apiKey');
      const modelName = store.get('model') || 'gemma-4-31b-it';

      if (!apiKey) {
        return { success: false, error: 'No API Key found. Please check your settings.' };
      }

      const ai = new GoogleGenAI({ apiKey: apiKey });
      // --- CONDITIONAL THINKING LOGIC ---
      // Enable 'high' thinking only for the 31B model.
      // For the 26B model, we set it to 'none' (or omit it) for maximum speed.
      const thinkingLevel = (modelName === 'gemma-4-31b-it') ? 'high' : 'none';

      const response = await ai.models.generateContent({
        model: modelName,
        contents: `Analyze this code and check for line numbers or terminal artifacts. 
            If found, return the cleaned version. If no repairs are needed, return the exact string 'NO_CHANGES_NEEDED'.
            DO NOT wrap your response in markdown blocks (e.g. \`\`\`javascript).
            DO NOT return JSON. Return ONLY the raw code.\n\nCode:\n${code}`,
        config: {
          thinkingConfig: {
            thinkingLevel: thinkingLevel,
          },
          systemInstruction: `You are a surgical code repair tool. 
          Your sole task is to remove line numbers and repair terminal-induced syntax corruption.
          
          DEFINITION OF CORRUPTION:
          1. Line numbers at the start of lines.
          2. Unintended line wraps: When a single statement, HTML tag, or string is split across two lines
            due to terminal window width (e.g., a tag like <span> being split).
          3. Fragmented keywords: Words split by newlines.
          
          CRITICAL RULES:
          1. DO NOT refactor the code.
          2. DO NOT change the logic.
          3. DO NOT explain your changes.
          4. DO NOT provide conversational filler.
          5. DO NOT use markdown code blocks like \`\`\`javascript or \`\`\`.
          6. Maintain every single character of the original logic exactly as it is, unless it is a terminal artifact.`,
          abortSignal: activeAbortController.signal
        }
      });

      const text = response.text;

      let rawText = response.text.trim();

      // Safety cleanup: some LLMs still add markdown blocks even when told not to.
      if (rawText.startsWith('```')) {
        const firstNewline = rawText.indexOf('\n');
        if (firstNewline !== -1) {
          rawText = rawText.substring(firstNewline + 1);
        }
        if (rawText.endsWith('```')) {
          rawText = rawText.substring(0, rawText.length - 3).trim();
        }
      }

      if (rawText === 'NO_CHANGES_NEEDED' || rawText === code.trim()) {
        return { success: true, repairedCode: code };
      }

      const parsed = {
        success: true,
        repairedCode: rawText
      };

      if (parsed.repairedCode && parsed.repairedCode !== code) {
        parsed.diff = Diff.diffWordsWithSpace(code, parsed.repairedCode);
      }

      return parsed;
    } catch (error) {
      console.error('AI Verification Error:', error);
      return { success: false, error: error.message };
    }
  });


  win.loadFile('index.html');

  win.webContents.on('context-menu', (event, params) => {
    const menu = new Menu();
    if (params.isEditable) {
      menu.append(new MenuItem({ label: 'Undo', role: 'undo' }));
      menu.append(new MenuItem({ label: 'Redo', role: 'redo' }));
      menu.append(new MenuItem({ type: 'separator' }));
      menu.append(new MenuItem({ label: 'Cut', role: 'cut' }));
      menu.append(new MenuItem({ label: 'Copy', role: 'copy' }));
      menu.append(new MenuItem({ label: 'Paste', role: 'paste' }));
      menu.append(new MenuItem({ type: 'separator' }));
      menu.append(new MenuItem({ label: 'Select All', role: 'selectAll' }));
    } else if (params.selectionText.trim().length > 0) {
      menu.append(new MenuItem({ label: 'Copy', role: 'copy' }));
    }
    menu.popup();
  });

  Menu.setApplicationMenu(null);

  win.once('ready-to-show', () => {
    win.show();
  });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
