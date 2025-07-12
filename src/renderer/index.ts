// Import required modules
const { ipcRenderer, shell } = require('electron');

// Add marked declaration
declare const marked: {
    parse: (markdown: string) => string;
};

// Chart.js is already declared in dom.ts

// Extend Window interface for global variables
interface WindowWithCustomProps extends Window {
    currentDate: Date;
    currentPage: number;
    allScreenshots: Screenshot[];
    SCREENSHOTS_PER_PAGE: number;
    editingNoteId: number | null;
    dailyProgressChart: any;
    yearlyProgressChart: any;
    ipcRenderer: any;
    DOM: any;
    deleteScreenshot: (id: number) => void;
    showEditNoteModal: (note: Note) => void;
    deleteNote: (id: number) => void;
    loadPreviousNotesInModal: (excludeId?: number | null) => void;
    toggleTracking: () => void;
    testScreenshot: () => void;
    updateInterval: () => void;
    initializeAPI: () => void;
    deleteAPIKey: () => void;
    toggleAutoLaunch: (event: Event) => void;
    saveGeminiModel: () => void;
    fetchAvailableModels: () => void;
    openLogsFile: () => void;
    showRecentLogs: () => void;
    exportData: () => void;
    changeDate: (offset: number) => void;
    changeMonth: (offset: number) => void;
    dismissError: () => void;
    saveNote: () => void;
    loadMoreScreenshots: () => void;
    quitApp: () => void;
    openExternalLink: (url: string) => void;
    toggleSettings: () => void;
    toggleExportModal: () => void;
    showMinimizeModal: () => void;
    closeMinimizeModal: (shouldClose?: boolean) => void;
    showAddNoteModal: () => void;
    closeNoteModal: () => void;
}

// Cast window to our extended interface
const win = window as unknown as WindowWithCustomProps;

// Type declarations
interface Screenshot {
    id: number;
    timestamp: string;
    thumbnail: string;
    activity?: string;
    category?: string;
    description?: string;
}

interface Note {
    id: number;
    content: string;
    timestamp: string;
}

interface CategoryStats {
    [key: string]: number;
}

interface MonthlyData {
    monthlyTimeInHours: { [key: string]: number };
    monthlyAverages: { [key: string]: number };
    daysWithData: number;
}

interface DailyStats {
    timeInHours: { [key: string]: number };
    category: string;
}

interface DailyStatsResult {
    success: boolean;
    dailyStats: { [key: string]: DailyStats };
    error?: string;
}

// Global variables
let isTracking = true;
let currentDate = new Date();
let editingNoteId: number | null = null;
let hasShownMinimizeMessage = false;
let currentPage = 1;
let allScreenshots: Screenshot[] = [];
let dailyProgressChart: any = null;
let yearlyProgressChart: any = null;

const SCREENSHOTS_PER_PAGE = 5;

// Make global variables accessible to DOM module
win.currentDate = currentDate;
win.currentPage = currentPage;
win.allScreenshots = allScreenshots;
win.SCREENSHOTS_PER_PAGE = SCREENSHOTS_PER_PAGE;
win.editingNoteId = editingNoteId;
win.dailyProgressChart = dailyProgressChart;
win.yearlyProgressChart = yearlyProgressChart;
win.ipcRenderer = ipcRenderer;

// API Key Management
async function checkExistingApiKey(): Promise<void> {
    const hasKey = await ipcRenderer.invoke('check-api-key');
    win.DOM.updateApiKeyUI(hasKey);
    if (hasKey) {
        const storedKey = await ipcRenderer.invoke('get-api-key');
        const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement | null;
        if (apiKeyInput) {
            apiKeyInput.value = storedKey;
        }
        await initializeInterval();
        updateStats();
    } else {
        isTracking = false;
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
            updateStats();
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

// Tracking Functions
async function toggleTracking() {
    isTracking = !isTracking;
    const tracking = await ipcRenderer.invoke('toggle-tracking', isTracking);
    const button = document.getElementById('toggleTracking') as HTMLButtonElement | null;

    if (tracking) {
        if (button) {
            button.innerHTML = `<i class="fas fa-pause"></i><span>Pause Recording</span>`;
            button.className = 'tracking-button active';
        }
    } else {
        if (button) {
            button.innerHTML = `<i class="fas fa-play"></i><span>Start Recording</span>`;
            button.className = 'tracking-button inactive';
        }
    }
}

async function testScreenshot(): Promise<void> {
    const button = document.getElementById('testScreenshotBtn') as HTMLButtonElement | null;
    const countdownElement = document.getElementById('countdown');

    console.log('Starting screenshot test...');
    if (button) {
        button.disabled = true;
    }

    try {
        const result = await ipcRenderer.invoke('test-screenshot');
        console.log('Screenshot test completed:', result);
    } catch (error) {
        console.error('Error during screenshot test:', error);
    }

    if (button) {
        button.disabled = false;
    }
    if (countdownElement) {
        countdownElement.textContent = '';
    }
}

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

// Stats and Data Management
async function updateStats() {
    try {
        const data = await ipcRenderer.invoke('get-stats');
        console.log('Received stats update:', data);

        // Ensure we're using the correct data structure
        const stats = data.stats.stats || data.stats;
        const timeInHours = data.stats.timeInHours || {};

        // Update category stats with both pieces of data
        win.DOM.updateCategoryStats(stats, timeInHours);

        // Update monthly averages
        await updateMonthlyAverages();

        // Store all screenshots and display initial page
        allScreenshots = data.screenshots || [];
        win.allScreenshots = allScreenshots;
        currentPage = 1;
        win.currentPage = currentPage;
        win.DOM.displayScreenshots();

        // Update day analysis if available
        const contentDiv = document.getElementById('dayAnalysisContent');
        if (data.dayAnalysis && data.dayAnalysis.content) {
            if (contentDiv) {
                contentDiv.textContent = data.dayAnalysis.content;
            }
        } else {
            if (contentDiv) {
                contentDiv.textContent = 'No analysis generated yet for this day.';
            }
        }
    } catch (error) {
        console.error('Error updating stats:', error);
    }
}

// Monthly Analytics
async function updateMonthlyAverages(): Promise<void> {
    try {
        const data = await ipcRenderer.invoke('get-monthly-averages') as MonthlyData;
        console.log('Received monthly averages:', data);

        // Update UI using DOM module
        win.DOM.updateMonthlyAnalyticsDisplay(data);
        
        // Update the next month button state
        win.DOM.updateNextMonthButtonState();
        
        // Update the daily progress chart
        await updateDailyProgressChart();
    } catch (error) {
        console.error('Error updating monthly averages:', error);
    }
}

async function changeMonth(offset: number) {
    // Create a new date object to avoid modifying the current date
    const newDate = new Date(currentDate);
    newDate.setMonth(newDate.getMonth() + offset);
    
    // Update the current date with the new month
    currentDate = newDate;
    win.currentDate = currentDate;
    
    try {
        // Update the monthly averages with the new month
        const data = await ipcRenderer.invoke('update-current-month', 
            currentDate.getFullYear(), 
            currentDate.getMonth()
        );
        
        // Update UI using DOM module
        win.DOM.updateMonthlyAnalyticsDisplay(data);
        
        // Update the next month button state
        win.DOM.updateNextMonthButtonState();
        
        // Update the daily progress chart
        await updateDailyProgressChart();
        
        // Also update the daily view to match the month
        const currentDateElement = document.getElementById('currentDate');
        if (currentDateElement) {
            currentDateElement.textContent = win.DOM.formatDate(currentDate);
        }
        const nextDateBtn = document.getElementById('nextDateBtn');
        if (nextDateBtn) {
            (nextDateBtn as HTMLButtonElement).disabled = win.DOM.isToday(currentDate);
        }
        
        // Fetch updated data for the day view
        const dayData = await ipcRenderer.invoke('update-current-date', currentDate.toISOString());
        win.DOM.updateCategoryStats(dayData.stats, dayData.timeInHours);
        
        // Update screenshots
        if (Array.isArray(dayData.screenshots)) {
            allScreenshots = dayData.screenshots;
            win.allScreenshots = allScreenshots;
            currentPage = 1;
            win.currentPage = currentPage;
            win.DOM.displayScreenshots();
        } else {
            allScreenshots = [];
            win.allScreenshots = allScreenshots;
            win.DOM.displayScreenshots();
        }
    } catch (error) {
        console.error('Error changing month:', error);
    }
}

// Chart Functions
async function updateDailyProgressChart(): Promise<void> {
    try {
        const result = await ipcRenderer.invoke('get-daily-category-stats') as DailyStatsResult;
        if (!result.success) {
            console.error('Error getting daily stats for chart:', result.error);
            return;
        }

        win.DOM.updateDailyProgressChart(result);
    } catch (error) {
        console.error('Error updating daily progress chart:', error);
    }
}

async function updateYearlyProgressChart() {
    try {
        const year = new Date().getFullYear();
        const result = await ipcRenderer.invoke('get-yearly-monthly-category-stats', year);
        if (!result.success) {
            console.error('Error getting yearly monthly stats for chart:', result.error);
            return;
        }

        win.DOM.updateYearlyProgressChart(result);
    } catch (error) {
        console.error('Error updating yearly progress chart:', error);
    }
}

async function deleteScreenshot(id: number) {
    if (confirm('Are you sure you want to delete this screenshot?')) {
        try {
            const success = await ipcRenderer.invoke('delete-screenshot', id);
            if (success) {
                // Remove from local array
                allScreenshots = allScreenshots.filter(s => s.id !== id);
                win.allScreenshots = allScreenshots;
                // Refresh display
                win.DOM.displayScreenshots();
                // Update stats
                const data = await ipcRenderer.invoke('get-stats');
                if (data) {
                    win.DOM.updateCategoryStats(data.stats.stats, data.stats.timeInHours);
                    // Update monthly averages after deletion
                    await updateMonthlyAverages();
                }
            }
        } catch (error) {
            console.error('Error deleting screenshot:', error);
        }
    }
}

// Make deleteScreenshot available globally
win.deleteScreenshot = deleteScreenshot;

// Date Management Functions
async function changeDate(offset: number) {
    currentDate.setDate(currentDate.getDate() + offset);
    win.currentDate = currentDate;

    const nextDateBtn = document.getElementById('nextDateBtn') as HTMLButtonElement;
    if (nextDateBtn) {
        (nextDateBtn as HTMLButtonElement).disabled = win.DOM.isToday(currentDate);
    }
    const currentDateElement = document.getElementById('currentDate');
    if (currentDateElement) {
        currentDateElement.textContent = win.DOM.formatDate(currentDate);
    }

    try {
        const data = await ipcRenderer.invoke('update-current-date', currentDate.toISOString());
        console.log('Received data for date change:', data);

        // Pass both stats and timeInHours to the update function
        win.DOM.updateCategoryStats(data.stats, data.timeInHours);

        // Update monthly averages when date changes
        await updateMonthlyAverages();
        
        // Update next month button state in case the month changed
        win.DOM.updateNextMonthButtonState();

        // Update screenshots
        if (Array.isArray(data.screenshots)) {
            allScreenshots = data.screenshots;
            win.allScreenshots = allScreenshots;
            currentPage = 1;
            win.currentPage = currentPage;
            win.DOM.displayScreenshots();
        } else {
            console.error('Invalid screenshots data:', data.screenshots);
            allScreenshots = [];
            win.allScreenshots = allScreenshots;
            win.DOM.displayScreenshots();
        }

        // Update notes for the new date
        if (data.notes) {
            win.DOM.displayNotes(data.notes);
        } else {
            await refreshNotes();
        }

        // Update day analysis
        const contentDiv = document.getElementById('dayAnalysisContent');
        if (contentDiv) {
            if (data.dayAnalysis && data.dayAnalysis.content) {
                contentDiv.innerHTML = marked.parse(data.dayAnalysis.content);
            } else {
                contentDiv.textContent = 'No analysis generated yet for this day.';
            }
        }
    } catch (error) {
        console.error('Error changing date:', error);
        allScreenshots = [];
        win.allScreenshots = allScreenshots;
        win.DOM.displayScreenshots();
    }
}

function quitApp() {
    ipcRenderer.invoke('quit-app');
}

// External Links
function openExternalLink(url: string) {
    shell.openExternal(url);
} 

// Settings Management
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

// Error Handling
function showAnalysisError(error: { message: string; timestamp: string }) {
    const errorCard = document.getElementById('analysisErrorCard');
    const errorMessage = document.getElementById('errorMessage');
    const errorTime = document.getElementById('errorTime');
    
    if (errorMessage) {
        errorMessage.textContent = error.message;
    }
    
    // Format the timestamp more elegantly
    const errorDate = new Date(error.timestamp);
    const formattedDate = errorDate.toLocaleDateString(undefined, {
        month: 'numeric',
        day: 'numeric',
        year: 'numeric'
    });
    const formattedTime = errorDate.toLocaleTimeString(undefined, {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });
    if (errorTime) {
        errorTime.textContent = `Last occurred: ${formattedDate}, ${formattedTime}`;
    }
    
    if (errorCard) {
        errorCard.style.display = 'block';
    }
}

function hideAnalysisError() {
    const errorCard = document.getElementById('analysisErrorCard');
    if (errorCard) {
        errorCard.style.display = 'none';
    }
}

async function dismissError() {
    hideAnalysisError();
    await ipcRenderer.invoke('clear-analysis-error');
}

async function checkExistingError() {
    const error = await ipcRenderer.invoke('get-analysis-error');
    if (error) {
        showAnalysisError(error);
    }
} 

// Notes Management Functions
async function showAddNoteModal() {
    win.DOM.showAddNoteModal();
}

async function showEditNoteModal(note: Note) {
    win.DOM.showEditNoteModal(note);
}

async function loadPreviousNotesInModal(excludeId: number | null = null) {
    win.DOM.loadPreviousNotesInModal(excludeId);
}

async function saveNote() {
    const content = (document.getElementById('noteContent') as HTMLTextAreaElement)?.value.trim();

    if (!content) {
        // Just close the modal if no content, don't show alert
        win.DOM.closeNoteModal();
        return;
    }

    const saveBtn = document.getElementById('saveNoteBtn');
    const originalText = saveBtn?.innerHTML || '';
    if (saveBtn) {
        saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    }

    try {
        let result;

        if (editingNoteId) {
            result = await ipcRenderer.invoke('update-note', editingNoteId, content);
        } else {
            result = await ipcRenderer.invoke('save-note', currentDate.toISOString(), content);
        }

        if (result.success) {
            win.DOM.closeNoteModal();
            await refreshNotes();
        } else {
            alert('Failed to save note: ' + result.error);
        }
    } catch (error: any) {
        console.error('Error saving note:', error);
        alert('Failed to save note: ' + error.message);
    } finally {
        if (saveBtn) {
            saveBtn.innerHTML = originalText;
        }
    }
}

async function deleteNote(id: number) {
    if (confirm('Are you sure you want to delete this note?')) {
        try {
            const result = await ipcRenderer.invoke('delete-note', id);
            if (result.success) {
                await refreshNotes();
            } else {
                alert('Failed to delete note.');
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error('Error deleting note:', error);
            alert('Failed to delete note: ' + errorMessage);
        }
    }
}

async function refreshNotes() {
    try {
        const result = await ipcRenderer.invoke('get-notes-for-date', currentDate.toISOString());
        if (result.success) {
            win.DOM.displayNotes(result.notes);
        }
    } catch (error) {
        console.error('Error refreshing notes:', error);
    }
}

// Make functions available globally
win.showEditNoteModal = showEditNoteModal;
win.deleteNote = deleteNote;
win.loadPreviousNotesInModal = loadPreviousNotesInModal;

// Day Analysis Functions
async function loadDayAnalysis() {
    console.log('Loading day analysis for date:', currentDate);
    try {
        const analysis = await ipcRenderer.invoke('get-day-analysis', currentDate);
        const contentDiv = document.getElementById('dayAnalysisContent');
        
        if (contentDiv) {
            if (analysis && analysis.content) {
                console.log('Displaying existing analysis');
                contentDiv.innerHTML = marked.parse(analysis.content);
            } else {
                console.log('No existing analysis found');
                contentDiv.textContent = 'No analysis generated yet for this day.';
            }
        }
    } catch (error: any) {
        console.error('Error loading day analysis:', error);
        const contentDiv = document.getElementById('dayAnalysisContent');
        if (contentDiv) {
            contentDiv.textContent = 'Error loading analysis.';
        }
    }
} 

// Event Listeners and Initialization
document.addEventListener('DOMContentLoaded', async () => {
    try {
        // Initialize date display
        const currentDateElement = document.getElementById('currentDate');
        if (currentDateElement) {
            currentDateElement.textContent = win.DOM.formatDate(currentDate);
        }
        const nextDateBtn = document.getElementById('nextDateBtn') as HTMLButtonElement;
        if (nextDateBtn) {
            (nextDateBtn as HTMLButtonElement).disabled = win.DOM.isToday(currentDate);
        }
        
        // Initialize next month button state
        win.DOM.updateNextMonthButtonState();

        // Check for existing analysis error
        await checkExistingError();

        // Initialize data
        const data = await ipcRenderer.invoke('get-stats');
        console.log('Initial data load:', data); // Debug log

        if (data) {
            // Ensure we're using the correct data structure
            const stats = data.stats.stats || data.stats;
            const timeInHours = data.stats.timeInHours || {};

            // Update category stats with both pieces of data
            win.DOM.updateCategoryStats(stats, timeInHours);
            
            // Initialize monthly averages
            await updateMonthlyAverages();

            // Initialize screenshots
            allScreenshots = data.screenshots || [];
            win.allScreenshots = allScreenshots;
            currentPage = 1;
            win.currentPage = currentPage;
            win.DOM.displayScreenshots();
            
            // Initialize the daily progress chart
            await updateDailyProgressChart();
            await updateYearlyProgressChart();
        }
    } catch (error) {
        console.error('Error initializing data:', error);
    }

    // Add window control button handlers
    const minimizeBtn = document.getElementById('minimize-btn');
    if (minimizeBtn) {
        minimizeBtn.addEventListener('click', () => {
            ipcRenderer.send('window-minimize');
        });
    }

    const closeBtn = document.getElementById('close-btn');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            const dontShowAgain = localStorage.getItem('dontShowMinimizeMessage');
            if (!dontShowAgain) {
                win.DOM.showMinimizeModal();
            } else {
                ipcRenderer.send('window-close');
            }
        });
    }

    // Initialize auto-launch toggle
    await initializeAutoLaunch();
    
    // Add event listener for auto-launch toggle
    const autoLaunchToggle = document.getElementById('autoLaunchToggle') as HTMLInputElement | null;
    if (autoLaunchToggle) {
        autoLaunchToggle.addEventListener('change', toggleAutoLaunch);
    }

    // Initialize Gemini model input
    await initializeGeminiModel();

    // Initialize date navigation on page load
    const currentDateElement = document.getElementById('currentDate');
    if (currentDateElement) {
        currentDateElement.textContent = win.DOM.formatDate(currentDate);
    }
    const nextDateBtn = document.getElementById('nextDateBtn');
    if (nextDateBtn) {
        (nextDateBtn as HTMLButtonElement).disabled = win.DOM.isToday(currentDate);
    }
    
    // Initialize month navigation
    win.DOM.updateNextMonthButtonState();

    // Add event listeners for export modal
    const rangeRadios = document.querySelectorAll('input[name="dateRange"]');
    rangeRadios.forEach(radio => {
        radio.addEventListener('change', function(this: HTMLInputElement) {
            const customInputs = document.getElementById('customRangeInputs');
            if (this.value === 'custom') {
                if (customInputs) {
                    customInputs.style.display = 'block';
                }
                // Set default dates
                const today = new Date();
                const oneWeekAgo = new Date();
                oneWeekAgo.setDate(today.getDate() - 7);
                
                const startDateInput = document.getElementById('startDate') as HTMLInputElement | null;
                const endDateInput = document.getElementById('endDate') as HTMLInputElement | null;
                if (startDateInput) {
                    startDateInput.value = oneWeekAgo.toISOString().split('T')[0];
                }
                if (endDateInput) {
                    endDateInput.value = today.toISOString().split('T')[0];
                }
            } else {
                const customInputs = document.getElementById('customRangeInputs');
                if (customInputs) {
                    customInputs.style.display = 'none';
                }
            }
        });
    });

    // Close export modal when clicking outside
    const exportModal = document.getElementById('exportModal');
    if (exportModal) {
        exportModal.addEventListener('click', (e) => {
            if (e.target === exportModal) {
                win.DOM.toggleExportModal();
            }
        });
    }

    // Day analysis button handler
    const generateAnalysis = document.getElementById('generateAnalysis') as HTMLButtonElement;
    if (generateAnalysis) {
        generateAnalysis.addEventListener('click', async () => {
            console.log('Generate analysis button clicked');
            const button = generateAnalysis as HTMLButtonElement;
            const contentDiv = document.getElementById('dayAnalysisContent');
            
            try {
                if (button) {
                    button.disabled = true;
                    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating...';
                }
                if (contentDiv) {
                    contentDiv.textContent = 'Generating analysis...';
                }
                
                console.log('Requesting analysis for date:', currentDate);
                const analysis = await ipcRenderer.invoke('generate-day-analysis', currentDate);
                console.log('Analysis received:', analysis ? 'success' : 'empty');
                
                if (!analysis) {
                    throw new Error('No analysis was generated');
                }
                
                if (contentDiv) {
                    contentDiv.innerHTML = marked.parse(analysis);
                }
            } catch (error: any) {
                console.error('Error generating analysis:', error);
                if (contentDiv) {
                    contentDiv.innerHTML = `
                        <div class="error-message">
                            <i class="fas fa-exclamation-circle"></i>
                            Error generating analysis: ${error.message || 'Unknown error'}
                            <br><br>
                            Please check:
                            <ul>
                                <li>Your API key is valid</li>
                                <li>There is data available for analysis</li>
                                <li>You have an active internet connection</li>
                            </ul>
                        </div>
                    `;
                }
            } finally {
                if (button) {
                    button.disabled = false;
                    button.innerHTML = '<i class="fas fa-brain"></i> Generate Analysis';
                }
            }
        });
    }

    // Collapse/expand yearly chart logic
    const yearlyChartBtn = document.getElementById('toggleYearlyChartBtn');
    const yearlyChartChevron = document.getElementById('yearlyChartChevron');
    const yearlyChartContainer = document.getElementById('yearlyProgressChartContainer');
    // Restore state from localStorage
    const collapsed = localStorage.getItem('yearlyChartCollapsed') === 'true';
    if (yearlyChartBtn && yearlyChartChevron && yearlyChartContainer) {
        if (collapsed) {
            yearlyChartBtn.classList.add('collapsed');
            yearlyChartContainer.classList.add('collapsed');
        }
        yearlyChartBtn.addEventListener('click', () => {
            yearlyChartBtn.classList.toggle('collapsed');
            yearlyChartContainer.classList.toggle('collapsed');
            const isCollapsed = yearlyChartContainer.classList.contains('collapsed');
            localStorage.setItem('yearlyChartCollapsed', isCollapsed ? 'true' : 'false');
        });
    }

    // Collapse/expand daily chart logic
    const dailyChartBtn = document.getElementById('toggleDailyChartBtn');
    const dailyChartChevron = document.getElementById('dailyChartChevron');
    const dailyChartContainer = document.getElementById('dailyProgressChartContainer');
    // Restore state from localStorage
    const dailyCollapsed = localStorage.getItem('dailyChartCollapsed') === 'true';
    if (dailyChartBtn && dailyChartChevron && dailyChartContainer) {
        if (dailyCollapsed) {
            dailyChartBtn.classList.add('collapsed');
            dailyChartContainer.classList.add('collapsed');
        }
        dailyChartBtn.addEventListener('click', () => {
            dailyChartBtn.classList.toggle('collapsed');
            dailyChartContainer.classList.toggle('collapsed');
            const isCollapsed = dailyChartContainer.classList.contains('collapsed');
            localStorage.setItem('dailyChartCollapsed', isCollapsed ? 'true' : 'false');
        });
    }
});

// Initialize API key check
checkExistingApiKey();

// Modal event listeners
const settingsModal = document.getElementById('settingsModal');
if (settingsModal) {
    settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) {
            win.DOM.toggleSettings();
        }
    });
}

const minimizeModal = document.getElementById('minimizeModal');
if (minimizeModal) {
    minimizeModal.addEventListener('click', win.DOM.handleModalClick);
}

// Escape key handler for closing modals
document.addEventListener('keydown', (e) => {
    const settingsModal = document.getElementById('settingsModal');
    if (settingsModal && settingsModal.style.display === 'flex') {
        if (e.key === 'Escape') {
            win.DOM.toggleSettings();
        }
    }
});

// Add keyboard support for note modal
document.addEventListener('keydown', (e) => {
    const noteModal = document.getElementById('noteModal');
    if (noteModal && noteModal.style.display === 'flex') {
        if (e.key === 'Escape') {
            win.DOM.closeNoteModal();
        } else if (e.key === 'Enter' && e.ctrlKey) {
            // Ctrl+Enter to save
            saveNote();
        } else if (e.key === 'Enter' && !e.shiftKey && document.activeElement?.id === 'noteContent') {
            // Enter to save (Shift+Enter for new line)
            e.preventDefault();
            saveNote();
        }
    }
});

// IPC Event Listeners
ipcRenderer.on('activity-updated', (event: Electron.IpcRendererEvent, data: any) => {
    console.log('Received activity update:', data);
    updateStats(); // Just call updateStats which will handle both stats and screenshots
});

ipcRenderer.on('countdown-update', (event: Electron.IpcRendererEvent, count: number) => {
    const countdownElement = document.getElementById('countdown');
    if (countdownElement) {
        countdownElement.textContent = `Taking screenshot in ${count}...`;
    }
});

ipcRenderer.on('tracking-paused', () => {
    isTracking = false;
    const button = document.getElementById('toggleTracking');
    if (button) {
        button.innerHTML = `<i class="fas fa-play"></i><span>Start Recording</span>`;
        button.className = 'tracking-button inactive';
    }
});

ipcRenderer.on('refresh-ui', async () => {
    try {
        const data = await ipcRenderer.invoke('request-refresh');
        if (data) {
            const stats = data.stats.stats || data.stats;
            const timeInHours = data.stats.timeInHours || {};

            win.DOM.updateCategoryStats(stats, timeInHours);
            
            // Update monthly averages on refresh
            await updateMonthlyAverages();

            allScreenshots = data.screenshots || [];
            win.allScreenshots = allScreenshots;
            currentPage = 1;
            win.currentPage = currentPage;
            win.DOM.displayScreenshots();
            
            // Update day analysis
            const contentDiv = document.getElementById('dayAnalysisContent');
            if (contentDiv) {
                if (data.dayAnalysis && data.dayAnalysis.content) {
                    contentDiv.innerHTML = marked.parse(data.dayAnalysis.content);
                } else {
                    contentDiv.textContent = 'No analysis generated yet for this day.';
                }
            }
            
            // Update the daily progress chart
            await updateDailyProgressChart();
            await updateYearlyProgressChart();
        }
    } catch (error) {
        console.error('Error refreshing UI:', error);
    }
});

ipcRenderer.on('initial-data', async (event: Electron.IpcRendererEvent, data: any) => {
    if (data) {
        const stats = data.stats.stats || data.stats;
        const timeInHours = data.stats.timeInHours || {};

        win.DOM.updateCategoryStats(stats, timeInHours);
        
        // Update monthly averages on initial load
        await updateMonthlyAverages();

        allScreenshots = data.screenshots || [];
        win.allScreenshots = allScreenshots;
        currentPage = 1;
        win.currentPage = currentPage;
        win.DOM.displayScreenshots();
        
        // Display notes
        if (data.notes) {
            win.DOM.displayNotes(data.notes);
        } else {
            await refreshNotes();
        }

        // Update day analysis
        const contentDiv = document.getElementById('dayAnalysisContent');
        if (contentDiv) {
            if (data.dayAnalysis && data.dayAnalysis.content) {
                contentDiv.innerHTML = marked.parse(data.dayAnalysis.content);
            } else {
                contentDiv.textContent = 'No analysis generated yet for this day.';
            }
        }
        
        // Update the daily progress chart
        await updateDailyProgressChart();
        await updateYearlyProgressChart();
    }
});

// Error handling listeners
ipcRenderer.on('analysis-error', (event: Electron.IpcRendererEvent, error: any) => {
    win.DOM.showAnalysisError(error);
});

ipcRenderer.on('analysis-error-cleared', () => {
    win.DOM.hideAnalysisError();
});

// Listen for global shortcut to open note modal
ipcRenderer.on('open-note-modal', () => {
    showAddNoteModal();
});

ipcRenderer.on('quit-app', () => {
    // Handle quit app event
}); 

// Global function exports for HTML onclick handlers
win.toggleTracking = toggleTracking;
win.testScreenshot = testScreenshot;
win.updateInterval = updateInterval;
win.initializeAPI = initializeAPI;
win.deleteAPIKey = deleteAPIKey;
win.toggleAutoLaunch = toggleAutoLaunch;
win.saveGeminiModel = saveGeminiModel;
win.fetchAvailableModels = fetchAvailableModels;
win.openLogsFile = openLogsFile;
win.showRecentLogs = showRecentLogs;
win.exportData = exportData;
win.changeDate = changeDate;
win.changeMonth = changeMonth;
win.dismissError = dismissError;
win.saveNote = saveNote;
win.loadMoreScreenshots = () => {
    currentPage++;
    win.currentPage = currentPage;
    win.DOM.displayScreenshots();
};
win.quitApp = quitApp;
win.openExternalLink = openExternalLink;

// Export DOM functions to global scope for HTML onclick handlers
win.toggleSettings = win.DOM.toggleSettings;
win.toggleExportModal = win.DOM.toggleExportModal;
win.showMinimizeModal = win.DOM.showMinimizeModal;
win.closeMinimizeModal = win.DOM.closeMinimizeModal;
win.showAddNoteModal = showAddNoteModal;
win.closeNoteModal = win.DOM.closeNoteModal; 
