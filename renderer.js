// REGEX FOR LINE NUMBERS
const LINE_NUMBER_REGEX = /^(\s*)(\d+)(\s*)/;

// --- DOM ELEMENTS ---
// THEME
const themeBtn = document.getElementById('theme-toggle-btn');
const html = document.documentElement;

// EDITOR
const textarea = document.getElementById('editor-textarea');
const aiStatus = document.getElementById('ai-status');
const previewArea = document.getElementById('preview-area');
const outputArea = document.getElementById('output-area');

// FOOTER BUTTONS
const btnOpen = document.getElementById('btn-open');
const btnReset = document.getElementById('btn-reset');
const btnRemove = document.getElementById('btn-remove');
const btnVerify = document.getElementById('btn-verify');
const btnCopy = document.getElementById('btn-copy');
const btnSave = document.getElementById('btn-save');

// DIFF NAVIGATION
const diffNavControls = document.getElementById('diff-nav-controls');
const btnPrevDiff = document.getElementById('btn-prev-diff');
const btnNextDiff = document.getElementById('btn-next-diff');
const diffCounter = document.getElementById('diff-counter');

// MODALS & SETTINGS
const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const apiKeyInput = document.getElementById('api-key-input');
const toggleApiVisibility = document.getElementById('toggle-api-visibility');
const modelSelect = document.getElementById('model-select');
const modelDescription = document.getElementById('model-description');
const saveSettings = document.getElementById('save-settings');
const closeSettingsBtn = document.getElementById('close-settings');

// FEEDBACK & HISTORY
const feedbackBar = document.getElementById('feedback-bar');
const historyBtn = document.getElementById('history-btn');
const historyModal = document.getElementById('history-modal');
const historyList = document.getElementById('history-list');
const closeHistory = document.getElementById('close-history');

const modelInfos = {
    'gemma-4-31b-it': 'Best for complex structural repairs and deep reasoning (uses high-level thinking).',
    'gemma-4-26b-a4b-it': 'Optimized for speed and lightweight cleaning of simple snippets.'
};

const sessionHistory = [];
let feedbackTimeout = null;
let isVerifying = false;
let currentRequestId = 0;

let totalDiffHunks = 0;
let currentDiffHunk = 0;

// 1. Prevent "fade-in" animation on first load
html.classList.add('no-transition');

/**
 * Helper to apply theme, update UI, and persist choice
 * @param {'light' | 'dark'} theme 
 */
async function applyTheme(theme) {
    if (theme === 'dark') {
        html.classList.add('theme-dark');
        html.classList.remove('theme-light');
        themeBtn.innerText = '☀';
    } else {
        html.classList.add('theme-light');
        html.classList.remove('theme-dark');
        themeBtn.innerText = '🌙';
    }

    localStorage.setItem('theme', theme);

    // USE THE BRIDGE instead of ipcRenderer.send
    window.electronAPI.saveTheme(theme);
}

/**
 * Synchronizes the enabled/disabled state of footer buttons based on the current content of the panels.
 */
const updateFooterButtonStates = () => {
    const hasInput = textarea.value.trim().length > 0;
    const hasOutput = outputArea.textContent.trim().length > 0;

    btnReset.disabled = !hasInput;
    btnRemove.disabled = !hasInput;

    btnVerify.disabled = !hasOutput;
    btnCopy.disabled = !hasOutput;
    btnSave.disabled = !hasOutput;
};


// --- HELPERS ---
const escapeHtml = (unsafe) => {
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
};

// --- INITIALIZATION ---


textarea.focus();
updateFooterButtonStates();

// The <head> script in index.html already applied the class to the HTML element.
// We just need to set the correct button icon to match that class.
const currentTheme = html.classList.contains('theme-dark') ? 'dark' : 'light';
applyTheme(currentTheme);

// Remove 'no-transition' after a short delay so the first paint is instant,
// but subsequent toggles are smooth.
setTimeout(() => {
    html.classList.remove('no-transition');
}, 100);

// --- TOGGLE EVENT ---
themeBtn.addEventListener('click', () => {
    const isDark = html.classList.contains('theme-dark');
    applyTheme(isDark ? 'light' : 'dark');
});

// --- SYSTEM SYNC ---
// Listen for system theme changes
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    // Only update automatically if the user hasn't set a manual preference in storage
    if (!localStorage.getItem('theme')) {
        applyTheme(e.matches ? 'dark' : 'light');
    }
});


// --- SETTINGS MODAL LOGIC ---

/**
 * UI Feedback Helper
 * Displays a temporary message in the feedback bar, logs it to history, and clears it after 2 seconds.
 */
const showFeedback = (message, type = 'info') => {
    if (feedbackTimeout) {
        clearTimeout(feedbackTimeout);
    }

    feedbackBar.textContent = message;
    feedbackBar.className = `feedback-bar feedback-${type}`;
    
    // Use 'fb-hidden' instead of 'hidden' to preserve animations
    feedbackBar.classList.remove('fb-hidden');
    
    sessionHistory.unshift({
        message,
        type,
        time: new Date().toLocaleTimeString()
    });

    feedbackTimeout = setTimeout(() => {
        feedbackBar.classList.add('fb-hidden');
    }, 2000);
};

/**
 * Security Helper
 * Forces the API key input back to password mode.
 */
function obfuscateApiKey() {
    if (apiKeyInput) {
        apiKeyInput.type = 'password';
        toggleApiVisibility.innerText = '👁';
    }
}

// Update description when dropdown changes
modelSelect.addEventListener('change', () => {
    modelDescription.textContent = modelInfos[modelSelect.value] || '';
});

// Open Modal
settingsBtn.addEventListener('click', async () => {
    // Force sync with config.json before showing the modal
    await loadSavedSettings(); 
    
    settingsModal.classList.add('active');
    // Focus the API key input automatically for better UX
    document.getElementById('api-key-input')?.focus();
});

// Close Modal
closeSettingsBtn.addEventListener('click', () => {
    obfuscateApiKey();
    settingsModal.classList.remove('active');
});

// Close Modal if user clicks outside the modal content area
window.addEventListener('click', (event) => {
    if (event.target === settingsModal) {
        obfuscateApiKey();
        settingsModal.classList.remove('active');
    }
});

// Toggle API Key visibility (Password <-> Text)
toggleApiVisibility.addEventListener('click', () => {
    const isPassword = apiKeyInput.type === 'password';

    // Toggle the input type
    apiKeyInput.type = isPassword ? 'text' : 'password';

    // Update the icon: show '🙈' when visible, '👁' when hidden
    toggleApiVisibility.innerText = isPassword ? '🙈' : '👁';
});

saveSettings.addEventListener('click', async () => {
    const key = apiKeyInput.value.trim();
    const model = modelSelect.value;

    // 1. Validation: Only save if the API key is not empty
    if (!key) {
        showFeedback("API Key is required to save settings", "error");
        apiKeyInput.focus();
        return;
    }

    try {
        // 2. Save settings via Electron API
        // We use await to ensure they are saved before closing the modal
        await window.electronAPI.setApiKey(key);
        await window.electronAPI.setModel(model);

        // 3. UI Cleanup
        obfuscateApiKey(); // Reset input to password mode
        settingsModal.classList.remove('active'); // Close modal using your new CSS class

        // 4. User Feedback
        showFeedback("Settings saved", "success");
    } catch (error) {
        console.error("Save settings failed:", error);
        showFeedback("Failed to save settings", "error");
    }
});


/**
 * Initialization: Load saved settings from the Main Process into the UI
 */
async function loadSavedSettings() {
    try {
        // 1. Fetch the key and model via the bridge
        const savedKey = await window.electronAPI.getApiKey();
        const savedModel = await window.electronAPI.getSelectedModel();

        // 2. Populate the inputs
        // Using || '' ensures the field is cleared if the saved key is null/undefined
        apiKeyInput.value = savedKey || '';

        if (savedModel) {
            modelSelect.value = savedModel;
            modelDescription.textContent = modelInfos[savedModel] || '';
        }

        console.log('Settings loaded successfully from config.json');
    } catch (error) {
        console.error('Failed to load settings on startup:', error);
    }
}

// Run the loader immediately when the script loads
loadSavedSettings();

// Open Google AI Studio in the default system browser
document.getElementById('lnk-external-studio').addEventListener('click', (e) => {
    e.preventDefault(); // Prevent default anchor behavior
    window.electronAPI.openExternal('https://aistudio.google.com/app/apikey');
});

// --- FILE LOGIC ---

/**
 * Renders the "AI Analysis" panel by highlighting detected line numbers.
 */
const renderAnalysisLayer = (rawText) => {
    const lines = rawText.split(/\r?\n/);
    const fragment = document.createDocumentFragment();

    lines.forEach(line => {
        const normalizedLine = line.replace(/\u00a0/g, ' ');
        const match = normalizedLine.match(LINE_NUMBER_REGEX);
        const lineDiv = document.createElement('div');

        if (match) {
            const indentation = match[1];
            const number = match[2];
            const trailingSpace = match[3];
            const codePart = normalizedLine.slice(match[0].length);

            const indentNode = document.createTextNode(indentation);
            const numSpan = document.createElement('span');
            numSpan.className = 'highlight';
            numSpan.textContent = `${number}${trailingSpace}`;
            const codeNode = document.createTextNode(codePart);

            lineDiv.appendChild(indentNode);
            lineDiv.appendChild(numSpan);
            lineDiv.appendChild(codeNode);
        } else {
            lineDiv.textContent = normalizedLine || '\n';
        }
        fragment.appendChild(lineDiv);
    });
    previewArea.innerHTML = '';
    previewArea.appendChild(fragment);
};

/**
 * Strips line numbers and updates the "Result" panel and button states.
 */
const processCode = () => {
    const rawText = textarea.value;
    if (!rawText || !rawText.trim()) {
        outputArea.textContent = '';
        return;
    }

    const originalLines = rawText.split(/\r?\n/);
    const cleanedLines = originalLines.map(line => {
        const normalizedLine = line.replace(/\u00a0/g, ' ');
        const match = normalizedLine.match(LINE_NUMBER_REGEX);
        if (match) {
            const indentation = match[1];
            const trailingSpace = match[3];
            const codePart = normalizedLine.slice(match[0].length);
            return indentation + trailingSpace + codePart;
        }
        return normalizedLine;
    });

    outputArea.textContent = cleanedLines.join('\n');

    const hasContent = cleanedLines.some(l => l.trim().length > 0);
    aiStatus.textContent = hasContent ? "Ready for AI Verification" : "Waiting for input...";
    aiStatus.classList.remove('ai-thinking');
    
    // Hide diff nav on manual changes
    diffNavControls.classList.add('hidden');
    totalDiffHunks = 0;
    currentDiffHunk = 0;

};

/**
 * The Master Update function: Synchronizes the entire UI state.
 */
const updateAll = () => {
    const rawText = textarea.value;

    renderAnalysisLayer(rawText);
    processCode();

    updateFooterButtonStates();
};

/**
 * Updates the editor value and immediately triggers the UI refresh.
 * Use this instead of assigning textarea.value directly.
 */
const setEditorValue = (text) => {
    textarea.value = text;
    updateAll();
};

/**
 * Debounce Helper: Prevents a function from being called too many times 
 * in a short period (essential for performance during typing).
 */
const debounce = (func, delay) => {
    let timeout;
    return function (...args) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), delay);
    };
};

// This handles all user-driven changes (typing, pasting, editing)
textarea.addEventListener('input', debounce(updateAll, 300));

btnOpen.addEventListener('click', async () => {
    try {
        // 1. Request file content via the bridge
        const content = await window.electronAPI.openFile();

        // 2. If a file was selected (content is not null)
        if (content) {
            setEditorValue(content);
            showFeedback("File loaded successfully", "success");
        }
    } catch (error) {
        console.error("Error opening file:", error);
        showFeedback("Failed to load file", "error");
    }
});

// --- RESET BUTTON LOGIC ---

btnReset.addEventListener('click', () => {
    // 1. Clear all data fields
    textarea.value = '';
    previewArea.innerHTML = '';
    outputArea.textContent = '';
    
    // 2. Reset AI status and UI state
    aiStatus.textContent = "Waiting for input...";
    aiStatus.classList.remove('ai-thinking');
    diffNavControls.classList.add('hidden');
    totalDiffHunks = 0;
    currentDiffHunk = 0;
    
    // 3. Sync the entire UI (this handles disabling all buttons correctly)
    updateAll();
    
    // 4. Final polish: Return focus and notify user
    textarea.focus();
    showFeedback("Workspace reset", "info");
});

// --- REMOVE LINE NUMBERS BUTTON LOGIC ---

btnRemove.addEventListener('click', () => {
    const before = outputArea.textContent;
    updateAll();
    const after = outputArea.textContent;

    if (before !== after) {
        showFeedback("Line numbers removed!", "success");
    } else {
        showFeedback("Text is already clean!", "info");
    }
});
    
// --- COPY TO CLIPBOARD BUTTON LOGIC ---

btnCopy.addEventListener('click', () => {
    const textToCopy = outputArea.textContent;

    if (!textToCopy.trim()) {
        showFeedback("Nothing to copy!", "error");
        return;
    }

    try {
        // Use the Electron Bridge to access native clipboard
        window.electronAPI.copyToClipboard(textToCopy);

        // Visual feedback on the button
        const originalText = btnCopy.textContent;
        btnCopy.textContent = 'Copied!';
        btnCopy.classList.add('success');

        // Trigger feedback bar (and automatically log to session history)
        showFeedback("Code copied to clipboard!", "success");

        // Revert button text after delay
        setTimeout(() => {
            btnCopy.textContent = originalText;
            btnCopy.classList.remove('success');
        }, 2000);
    } catch (error) {
        console.error('Copy failed:', error);
        showFeedback("Failed to copy text", "error");
    }
});

// --- SAVE FILE LOGIC ---

btnSave.addEventListener('click', async () => {
    const contentToSave = outputArea.textContent;
    
    if (!contentToSave.trim()) {
        showFeedback("Nothing to save!", "error");
        return;
    }

    try {
        // Call the bridge to open the system save dialog
        const result = await window.electronAPI.saveFile(contentToSave);
        // Success: Display feedback and log to history
        if (result.success) {
            // Success: Display feedback and log to history
            showFeedback("File saved successfully!", "success");
        } else if (result.cancelled) {
            // User closed the dialog without saving
            showFeedback("Save cancelled", "info");
        } else {
            // Handle potential system errors (e.g., permission denied)
            showFeedback(result.error || "Failed to save file", "error");
        }
    } catch (error) {
        console.error("Save Error:", error);
        showFeedback("An internal error occurred while saving", "error");
    }
});

// --- HISTORY MODAL LOGIC ---

/**
 * Renders the session history array into the modal's list
 */
const renderHistory = () => {
    // Clear current list
    historyList.innerHTML = '';

    if (sessionHistory.length === 0) {
        historyList.innerHTML = '<p style="text-align:center; color:var(--text-muted);">No activity in this session.</p>';
        return;
    }
    // Create elements for each history item
    sessionHistory.forEach(item => {
        const div = document.createElement('div');
        div.className = `history-item history-item-${item.type}`;
        div.innerHTML = `
            <span class="history-time">${item.time}</span>
            <span class="history-message">${item.message}</span>
        `;
        historyList.appendChild(div);
    });
};

// Open Modal and render content
historyBtn.addEventListener('click', () => {
    renderHistory();
    historyModal.classList.add('active');
});

// Close Modal via button
closeHistory.addEventListener('click', () => {
    historyModal.classList.remove('active');
});

// Close Modal via clicking outside the content area
window.addEventListener('click', (event) => {
    if (event.target === historyModal) {
        historyModal.classList.remove('active');
    }
});

/**
 * Maps technical AI errors (JSON or plain text) into user-friendly messages.
 */
const mapApiError = (errorMsg) => {
    if (!errorMsg) return "An unknown error occurred.";

    // Handle Abortions
    const msgLower = errorMsg.toLowerCase();
    if (msgLower.includes('aborted') || msgLower.includes('cancelled')) {
        return "Analysis stopped by user.";
    }

    // Handle JSON error responses
    if (typeof errorMsg === 'string' && errorMsg.trim().startsWith('{')) {
        try {
            const parsed = JSON.parse(errorMsg);

            // Check for the numeric error code first (e.g., 500, 429)
            const code = parsed.error?.code || parsed.code;
            if (code) {
                if (code === 500) return "Google Server Error. Please try again in a few minutes.";
                if (code === 429) return "Rate limit exceeded. Please wait a moment.";
                if (code === 403) return "Invalid API Key. Please check your settings.";
            }

            // If no code, try to map the message text recursively
            const message = parsed.error?.message || parsed.message;
            if (message) {
                return mapApiError(message);
            }
        } catch (e) {
            // Fallback to treating it as a regular string if JSON parsing fails
        }
    }

    // 2. Handle plain text error messages
    const msg = errorMsg.toLowerCase();

    if (msg.includes('429') || msg.includes('rate limit')) return "Rate limit exceeded. Please wait a moment.";
    if (msg.includes('403') || msg.includes('api key')) return "Invalid API Key. Please check your settings.";
    if (msg.includes('500') || msg.includes('internal error')) return "Google Server Error. Please try again in a few minutes.";
    if (
        msg.includes('internal error') ||
        msg.includes('service unavailable') ||
        msg.includes('overloaded') ||
        msg.includes('unavailable') ||
        msg.includes('deadline exceeded') ||
        msg.includes('timeout')
    ) {
        return "Cloud service error. This is usually temporary, please try again in a moment.";
    }

    return "An unexpected AI error occurred. Please try again.";
};

/**
 * Toggles the disabled state of all primary UI controls to prevent interaction during AI analysis.
 * @param {boolean} disabled - True to disable, false to enable.
 */
const setAnalysisUIState = (disabled) => {
    const elementsToToggle = [
        settingsBtn, 
        textarea, 
        btnOpen, 
        btnReset, 
        btnRemove, 
        btnCopy, 
        btnSave
    ];

    elementsToToggle.forEach(el => {
        if (el) el.disabled = disabled;
    });
};

function resetVerifyButton() {
    isVerifying = false;
    setAnalysisUIState(false);

    btnVerify.textContent = "Verify & Repair with Gemma";
    btnVerify.classList.remove('danger-btn');

    updateFooterButtonStates();
    aiStatus.classList.remove('ai-thinking');
}

// --- DIFF NAVIGATION LOGIC ---

function updateDiffNavButtons() {
    btnPrevDiff.disabled = currentDiffHunk <= 1;
    btnNextDiff.disabled = currentDiffHunk >= totalDiffHunks;
}

function scrollToHunk(hunkIndex) {
    const previewHunk = previewArea.querySelector(`.diff-hunk[data-hunk="${hunkIndex}"]`);
    const outputHunk = outputArea.querySelector(`.diff-hunk[data-hunk="${hunkIndex}"]`);
    
    // Scroll element into view. Since panels are in the same scroll container,
    // scrolling one scrolls them all in sync.
    const target = previewHunk || outputHunk;
    if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    
    // Briefly highlight the active hunk to help user locate it
    const hunks = document.querySelectorAll(`.diff-hunk[data-hunk="${hunkIndex}"]`);
    hunks.forEach(h => {
        const originalOutline = h.style.outline;
        h.style.outline = '2px solid var(--accent-color)';
        setTimeout(() => {
            h.style.outline = originalOutline;
        }, 1000);
    });
}

btnPrevDiff.addEventListener('click', () => {
    if (currentDiffHunk > 1) {
        currentDiffHunk--;
        diffCounter.textContent = `${currentDiffHunk}/${totalDiffHunks}`;
        updateDiffNavButtons();
        scrollToHunk(currentDiffHunk);
    }
});

btnNextDiff.addEventListener('click', () => {
    if (currentDiffHunk < totalDiffHunks) {
        currentDiffHunk++;
        diffCounter.textContent = `${currentDiffHunk}/${totalDiffHunks}`;
        updateDiffNavButtons();
        scrollToHunk(currentDiffHunk);
    }
});

btnVerify.addEventListener('click', async () => {
    // --- CASE A: User wants to abort an active analysis ---
    if (isVerifying) {
        window.electronAPI.abortVerify();

        // Update UI immediately to show we are stopping
        isVerifying = false;
        resetVerifyButton();
        aiStatus.textContent = "Stopping analysis...";
        showFeedback("Aborting analysis...", "info");
        return;
    }

    // --- CASE B: Start a new analysis ---
    const codeToVerify = outputArea.textContent;
    if (!codeToVerify.trim()) {
        showFeedback("No code to verify!", "error");
        return;
    }

    // Setup state
    isVerifying = true;
    const requestId = ++currentRequestId;

    setAnalysisUIState(true);

    // UI: Change to "Abort" state
    btnVerify.textContent = "Abort Analysis";
    btnVerify.classList.add('danger-btn');
    aiStatus.textContent = "Gemma 4 is analyzing...";
    aiStatus.classList.add('ai-thinking');

    try {
        const result = await window.electronAPI.verifyCode(codeToVerify);

        // Since we aren't ignoring responses yet, we process the result
        if (result.success) {
            if (result.diff) {
                let previewHtml = '';
                let outputHtml = '';
                
                let hunkIndex = 0;
                let inHunk = false;
                
                result.diff.forEach(part => {
                    const escaped = escapeHtml(part.value);
                    if (part.added || part.removed) {
                        if (!inHunk) {
                            hunkIndex++;
                            inHunk = true;
                        }
                        if (part.added) {
                            outputHtml += `<span class="diff-hunk diff-added" data-hunk="${hunkIndex}">${escaped}</span>`;
                        } else if (part.removed) {
                            previewHtml += `<span class="diff-hunk diff-removed" data-hunk="${hunkIndex}">${escaped}</span>`;
                        }
                    } else {
                        inHunk = false;
                        previewHtml += escaped;
                        outputHtml += escaped;
                    }
                });
                
                previewArea.innerHTML = previewHtml;
                outputArea.innerHTML = outputHtml;
                
                totalDiffHunks = hunkIndex;
                if (totalDiffHunks > 0) {
                    currentDiffHunk = 1;
                    diffCounter.textContent = `${currentDiffHunk}/${totalDiffHunks}`;
                    diffNavControls.classList.remove('hidden');
                    updateDiffNavButtons();
                    scrollToHunk(currentDiffHunk);
                } else {
                    diffNavControls.classList.add('hidden');
                }
                
                aiStatus.textContent = "Gemma Repaired: Diff applied.";
                showFeedback("Gemma fixed content corruption! Review diff.", "success");
            } else if (result.repairedCode && result.repairedCode !== codeToVerify) {
                outputArea.textContent = result.repairedCode;
                aiStatus.textContent = "Gemma Repaired: Content corruption fixed.";
                showFeedback("Gemma fixed content corruption!", "success");
            } else {
                aiStatus.textContent = "Gemma Verified.";
                showFeedback("Code verified as clean.", "success");
            }
        } else {
            // This is where the AbortError from main.js usually arrives
            const errorMessage = mapApiError(result.error);
            // Check if the error message indicates a user abort
            const isAbort = errorMessage.toLowerCase().includes("stopped") || errorMessage.toLowerCase().includes("aborted");

            aiStatus.textContent = isAbort ? "Analysis stopped" : "Error encountered";
            showFeedback(errorMessage, isAbort ? "info" : "error");

        }
    } catch (error) {
        aiStatus.textContent = "Analysis stopped";
        showFeedback("Analysis was aborted.", "info");
    } finally {
        // Reset UI state when the request finally resolves or rejects
        resetVerifyButton();
    }
});
