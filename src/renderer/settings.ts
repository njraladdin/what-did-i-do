// Settings and Configuration Management
// Get references to global variables with different names to avoid conflicts
const { ipcRenderer: ipc } = require('electron');
const settingsWin = (window as any);
const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite-preview';

// API Key Management
async function checkExistingApiKey(): Promise<void> {
    const hasKey = await ipc.invoke('check-api-key');
    settingsWin.DOM.updateApiKeyUI(hasKey);
    if (hasKey) {
        const storedKey = await ipc.invoke('get-api-key');
        const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement | null;
        if (apiKeyInput) {
            apiKeyInput.value = storedKey;
        }
        await initializeInterval();
        // Trigger stats update via custom event
        settingsWin.dispatchEvent(new CustomEvent('updateStats'));
    } else {
        // Update tracking state via custom event
        settingsWin.dispatchEvent(new CustomEvent('setTracking', { detail: false }));
        const button = document.getElementById('toggleTracking') as HTMLButtonElement | null;
        if (button) {
            button.innerHTML = `<i class="fas fa-play"></i><span>Start Recording</span>`;
            button.className = 'tracking-button inactive';
            button.disabled = true;
        }
    }
}

async function initializeAPI(): Promise<void> {
    const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement | null;
    const apiKey = apiKeyInput?.value.trim() || '';
    
    if (!apiKey) {
        win.DOM.showValidationMessage('Please enter an API key', 'error');
        return;
    }

    const spinner = document.getElementById('validationSpinner');
    const saveButton = document.getElementById('saveApiKeyBtn') as HTMLButtonElement | null;

    if (spinner) {
        spinner.style.display = 'block';
    }
    if (saveButton) {
        saveButton.disabled = true;
    }

    try {
        const result = await ipcRenderer.invoke('initialize-api', apiKey);

        if (result.success) {
            win.DOM.showValidationMessage('API key validated successfully!', 'success');
            win.DOM.updateApiKeyUI(true);
            win.dispatchEvent(new CustomEvent('updateStats'));
            setTimeout(() => win.DOM.toggleSettings(), 1500);
        } else {
            win.DOM.showValidationMessage(result.error || 'Invalid API key', 'error');
        }
    } catch (error) {
        win.DOM.showValidationMessage('Failed to validate API key', 'error');
    } finally {
        if (spinner) {
            spinner.style.display = 'none';
        }
        if (saveButton) {
            saveButton.disabled = false;
        }
    }
}

async function deleteAPIKey() {
    const success = await ipcRenderer.invoke('delete-api-key');
    if (success) {
        const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement | null;
        if (apiKeyInput) {
            apiKeyInput.value = '';
        }
        win.DOM.updateApiKeyUI(false);
        win.DOM.toggleSettings();

        // Reset tracking button state
        const button = document.getElementById('toggleTracking') as HTMLButtonElement | null;
        if (button) {
            button.innerHTML = `<i class="fas fa-play"></i><span>Start Recording</span>`;
            button.className = 'tracking-button inactive';
            button.disabled = true;
        }

        // Disable test screenshot button
        const testScreenshotBtn = document.getElementById('testScreenshotBtn') as HTMLButtonElement | null;
        if (testScreenshotBtn) {
            testScreenshotBtn.disabled = true;
        }
    }
}

// Tracking Settings
async function updateInterval(): Promise<void> {
    const intervalSelect = document.getElementById('intervalSelect') as HTMLSelectElement | null;
    const interval = intervalSelect?.value;
    if (interval) {
        await ipcRenderer.invoke('update-interval', parseInt(interval));
    }
}

async function initializeInterval(): Promise<void> {
    const savedInterval = await ipcRenderer.invoke('get-interval');
    if (savedInterval) {
        const intervalSelect = document.getElementById('intervalSelect') as HTMLSelectElement | null;
        if (intervalSelect) {
            intervalSelect.value = savedInterval.toString();
        }
    }
}

// Auto-launch Settings
async function initializeAutoLaunch() {
    const isEnabled = await ipcRenderer.invoke('get-auto-launch');
    const autoLaunchToggle = document.getElementById('autoLaunchToggle') as HTMLInputElement | null;
    if (autoLaunchToggle) {
        autoLaunchToggle.checked = isEnabled;
    }
}

async function toggleAutoLaunch(event: Event) {
    const enable = (event.target as HTMLInputElement).checked;
    const success = await ipcRenderer.invoke('toggle-auto-launch', enable);
    if (!success) {
        const autoLaunchToggle = document.getElementById('autoLaunchToggle') as HTMLInputElement | null;
        if (autoLaunchToggle) {
            autoLaunchToggle.checked = !enable;
        }
        // Optionally show an error message
    }
}

// Model Management
async function initializeGeminiModel() {
    const currentModel = await ipcRenderer.invoke('get-gemini-model');
    const modelInput = document.getElementById('geminiModel') as HTMLInputElement | null;
    if (modelInput) {
        modelInput.value = currentModel || DEFAULT_GEMINI_MODEL;
    }
}

async function saveGeminiModel() {
    const modelInput = document.getElementById('geminiModel') as HTMLInputElement | null;
    const saveButton = document.getElementById('saveModelBtn') as HTMLButtonElement;
    const statusEl = document.getElementById('modelLoadingStatus');
    const model = modelInput?.value.trim() || '';

    if (!model) {
        alert('Please enter a valid model name');
        return;
    }

    if (saveButton) {
        saveButton.disabled = true;
    }
    if (saveButton) {
        saveButton.textContent = 'Saving...';
    }
    if (statusEl) {
        statusEl.textContent = 'Saving model...';
        statusEl.className = 'model-status';
    }

    try {
        const result = await ipcRenderer.invoke('set-gemini-model', model);
        
        if (result.success) {
            if (saveButton) {
                saveButton.textContent = 'Saved!';
            }
            if (statusEl) {
                statusEl.textContent = 'Model saved successfully.';
                statusEl.className = 'model-status success';
            }
            setTimeout(() => {
                if (saveButton) {
                    saveButton.textContent = 'Save';
                    saveButton.disabled = false;
                }
                if (statusEl) {
                    statusEl.textContent = '';
                    statusEl.className = 'model-status';
                }
            }, 2000);
        } else {
            if (statusEl) {
                statusEl.textContent = 'Error saving model: ' + result.error;
                statusEl.className = 'model-status error';
            }
            if (saveButton) {
                saveButton.textContent = 'Save';
                saveButton.disabled = false;
            }
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (statusEl) {
            statusEl.textContent = 'Error: ' + errorMessage;
            statusEl.className = 'model-status error';
        }
        if (saveButton) {
            saveButton.textContent = 'Save';
            saveButton.disabled = false;
        }
    }
}

// Logs Management
async function openLogsFile() {
    await ipcRenderer.invoke('open-logs');
}

async function showRecentLogs() {
    const logsContainer = document.getElementById('recentLogs');
    const logsContent = logsContainer?.querySelector('.logs-content');
    
    // Toggle visibility
    if (logsContainer && logsContainer.style.display === 'none') {
        const logs = await ipcRenderer.invoke('get-recent-logs');
        if (logsContent) {
            logsContent.innerHTML = logs.map((log: string) => `<div>${log}</div>`).join('');
        }
        if (logsContainer) {
            logsContainer.style.display = 'block';
        }
    } else {
        if (logsContainer) {
            logsContainer.style.display = 'none';
        }
    }
}

// Export Functions
async function exportData() {
    const exportBtn = document.getElementById('exportBtn') as HTMLButtonElement;
    const originalText = exportBtn?.innerHTML || '';
    
    // Show loading state
    if (exportBtn) {
        exportBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Exporting...';
        exportBtn.disabled = true;
    }

    try {
        // Get selected range
        const selectedRange = document.querySelector('input[name="dateRange"]:checked') as HTMLInputElement | null;
        let startDate: Date | undefined;
        let endDate: Date | undefined;

        const today = new Date();
        const yesterday = new Date();
        yesterday.setDate(today.getDate() - 1);

        if (selectedRange) {
            switch (selectedRange.value) {
                case 'today':
                    startDate = new Date(today);
                    startDate.setHours(0, 0, 0, 0);
                    endDate = new Date(today);
                    endDate.setHours(23, 59, 59, 999);
                    break;
                case 'last7days':
                    startDate = new Date();
                    startDate.setDate(today.getDate() - 6);
                    startDate.setHours(0, 0, 0, 0);
                    endDate = new Date(today);
                    endDate.setHours(23, 59, 59, 999);
                    break;
                case 'last30days':
                    startDate = new Date();
                    startDate.setDate(today.getDate() - 29);
                    startDate.setHours(0, 0, 0, 0);
                    endDate = new Date(today);
                    endDate.setHours(23, 59, 59, 999);
                    break;
                case 'alltime':
                    startDate = new Date('1970-01-01');
                    endDate = new Date();
                    break;
                case 'custom':
                    const startDateInput = document.getElementById('startDate') as HTMLInputElement | null;
                    const endDateInput = document.getElementById('endDate') as HTMLInputElement | null;
                    if (!startDateInput || !endDateInput) {
                        alert('Please select both start and end dates for custom range.');
                        return;
                    }
                    startDate = new Date(startDateInput.value);
                    startDate.setHours(0, 0, 0, 0);
                    endDate = new Date(endDateInput.value);
                    endDate.setHours(23, 59, 59, 999);
                    break;
            }
        }

        if (!startDate || !endDate) {
            alert('Invalid date range');
            return;
        }

        const normalizedStartDate = startDate instanceof Date ? startDate : new Date(startDate);
        const normalizedEndDate = endDate instanceof Date ? endDate : new Date(endDate);

        if (Number.isNaN(normalizedStartDate.getTime()) || Number.isNaN(normalizedEndDate.getTime())) {
            alert('Invalid date range');
            return;
        }

        // Call export function
        const result = await ipcRenderer.invoke('export-data', {
            startDate: normalizedStartDate.toISOString(),
            endDate: normalizedEndDate.toISOString(),
            rangeType: selectedRange?.value
        });

        if (result.success) {
            // Close modal and show success message
            win.DOM.toggleExportModal();
            console.log('JSON export successful:', result.filePath);
            if (result.markdownPath) {
                console.log('Compact Markdown export successful:', result.markdownPath);
            }
        } else {
            alert('Export failed: ' + result.error);
        }
    } catch (error: any) {
        console.error('Export error:', error);
        alert('Export failed: ' + error.message);
    } finally {
        // Reset button state
        if (exportBtn) {
            exportBtn.innerHTML = originalText;
            exportBtn.disabled = false;
        }
    }
}

// CommonJS exports
module.exports = {
    checkExistingApiKey,
    initializeAPI,
    deleteAPIKey,
    updateInterval,
    initializeInterval,
    initializeAutoLaunch,
    toggleAutoLaunch,
    initializeGeminiModel,
    saveGeminiModel,
    openLogsFile,
    showRecentLogs,
    exportData
};
