// Settings and Configuration Management
// Get references to global variables with different names to avoid conflicts
const { ipcRenderer: ipc } = require('electron');
const settingsWin = (window as any);

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
    
    // Set the current model first
    const modelSelect = document.getElementById('geminiModel') as HTMLSelectElement | null;
    if (modelSelect) {
        modelSelect.value = currentModel;
    }
    
    // If the current model isn't in the default options, add it
    if (modelSelect) {
        if (!Array.from(modelSelect.options).some(opt => opt.value === currentModel)) {
            const option = document.createElement('option');
            option.value = currentModel;
            option.text = currentModel;
            option.selected = true;
            modelSelect.add(option);
        }
    }
    
    // Fetch available models after setting the current one
    fetchAvailableModels();
}

async function saveGeminiModel() {
    const modelSelect = document.getElementById('geminiModel') as HTMLSelectElement | null;
    const saveButton = document.getElementById('saveModelBtn') as HTMLButtonElement;
    const statusEl = document.getElementById('modelLoadingStatus');
    const model = modelSelect?.value;

    if (!model || model === 'loading') {
        alert('Please select a valid model');
        return;
    }

    if (saveButton) {
        saveButton.disabled = true;
    }
    if (saveButton) {
        saveButton.textContent = 'Testing model...';
    }
    if (statusEl) {
        statusEl.textContent = 'Testing model with a simple request...';
        statusEl.className = 'model-status';
    }

    try {
        // First test the model
        const testResult = await ipcRenderer.invoke('test-gemini-model', model);
        
        if (!testResult.success) {
            if (statusEl) {
                statusEl.textContent = 'Model test failed: ' + testResult.error;
                statusEl.className = 'model-status error';
            }
            if (saveButton) {
                saveButton.textContent = 'Save';
                saveButton.disabled = false;
            }
            return;
        }

        // If test passed, save the model
        if (saveButton) {
            saveButton.textContent = 'Saving...';
        }
        const result = await ipcRenderer.invoke('set-gemini-model', model);
        
        if (result.success) {
            if (saveButton) {
                saveButton.textContent = 'Saved!';
            }
            if (statusEl) {
                statusEl.textContent = 'Model tested and saved successfully!';
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

async function fetchAvailableModels() {
    const modelSelect = document.getElementById('geminiModel') as HTMLSelectElement | null;
    const refreshBtn = document.getElementById('refreshModelsBtn') as HTMLButtonElement;
    const statusEl = document.getElementById('modelLoadingStatus');
    
    // Save current selection
    const currentSelection = modelSelect?.value;
    
    // Show loading state
    if (refreshBtn) {
        refreshBtn.classList.add('loading');
    }
    if (refreshBtn) {
        refreshBtn.disabled = true;
    }
    if (statusEl) {
        statusEl.textContent = 'Loading available models...';
        statusEl.className = 'model-status';
    }
    
    try {
        const result = await ipcRenderer.invoke('fetch-available-models');
        
        if (result.success && result.models.length > 0) {
            // Keep track of existing options to preserve custom ones
            const existingOptions = Array.from(modelSelect?.options || []).map(opt => ({
                value: opt.value,
                text: opt.text,
                selected: opt.selected
            }));
            
            // Clear all options
            if (modelSelect) {
                modelSelect.innerHTML = '';
            }
            
            // Add default option
            const defaultOption = document.createElement('option');
            defaultOption.value = 'gemini-2.0-flash';
            defaultOption.text = 'gemini-2.0-flash (Default)';
            if (modelSelect) {
                modelSelect.add(defaultOption);
            }
            
            // Add fetched models
            result.models.forEach((model: { id: string; name: string; description?: string }) => {
                const option = document.createElement('option');
                option.value = model.id;
                option.text = model.name;
                if (model.description) {
                    option.title = model.description;
                }
                if (modelSelect) {
                    modelSelect.add(option);
                }
            });
            
            // Restore selection - if the saved model isn't in the list, add it
            if (currentSelection && modelSelect && !Array.from(modelSelect.options).some(opt => opt.value === currentSelection)) {
                const customOption = document.createElement('option');
                customOption.value = currentSelection;
                customOption.text = currentSelection + ' (Custom)';
                if (modelSelect) {
                    modelSelect.add(customOption);
                }
            }
            
            // Set the selection
            if (modelSelect && currentSelection) {
                modelSelect.value = currentSelection;
            }
            
            if (statusEl) {
                statusEl.textContent = `Loaded ${result.models.length} available models`;
                statusEl.className = 'model-status success';
            }
        } else {
            if (statusEl) {
                statusEl.textContent = result.error || 'No models found';
                statusEl.className = 'model-status error';
            }
        }
    } catch (error: any) {
        if (statusEl) {
            statusEl.textContent = 'Error loading models: ' + error.message;
            statusEl.className = 'model-status error';
        }
    } finally {
        if (refreshBtn) {
            refreshBtn.classList.remove('loading');
        }
        if (refreshBtn) {
            refreshBtn.disabled = false;
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

        // Call export function
        const result = await ipcRenderer.invoke('export-data', {
            startDate: startDate.toISOString(),
            endDate: endDate.toISOString(),
            rangeType: selectedRange?.value
        });

        if (result.success) {
            // Close modal and show success message
            win.DOM.toggleExportModal();
            // You could add a toast notification here
            console.log('Export successful:', result.filePath);
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
    fetchAvailableModels,
    openLogsFile,
    showRecentLogs,
    exportData
};