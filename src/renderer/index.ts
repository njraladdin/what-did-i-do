// Import required modules
const { ipcRenderer, shell } = require('electron');

// Import settings functions
const Settings = require('./settings');

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
    toggleChatSidebar: () => void;
    showMinimizeModal: () => void;
    closeMinimizeModal: (shouldClose?: boolean) => void;
    showAddNoteModal: () => void;
    closeNoteModal: () => void;
    sendChatMessage: () => void;
    handleChatKeydown: (event: KeyboardEvent) => void;
    toggleDataOption: (option: string) => void;
    updateDataCounts: () => void;
    loadChatHistory: () => void;
    clearChatHistory: () => void;
    toggleDataPeriodView: () => void;
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
let previewCache: { [key: string]: any } = {};

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
win.updateDataCounts = updateDataCounts;

// API Key Management functions are now in settings.ts

// Utility function to set tracking state
function setTracking(value: boolean) {
    isTracking = value;
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

// Interval functions are now in settings.ts

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

// Chat Model Functions
async function initializeChatModelDropdown() {
    const modelSelect = document.getElementById('chatGeminiModel') as HTMLSelectElement;
    if (!modelSelect) return;
    
    await populateChatModelsDropdown();
    
    modelSelect.addEventListener('change', saveChatGeminiModel);
}

async function saveChatGeminiModel() {
    const modelSelect = document.getElementById('chatGeminiModel') as HTMLSelectElement;
    if (modelSelect) {
        const selectedModel = modelSelect.value;
        await ipcRenderer.invoke('set-chat-gemini-model', selectedModel);
    }
}

async function populateChatModelsDropdown() {
    const modelSelect = document.getElementById('chatGeminiModel') as HTMLSelectElement;
    if (!modelSelect) return;
    
    const savedModel = await ipcRenderer.invoke('get-chat-gemini-model');
    
    const loadingOption = modelSelect.querySelector('option[value="loading"]');
    if (loadingOption) (loadingOption as HTMLOptionElement).disabled = false;

    try {
        const result = await ipcRenderer.invoke('fetch-available-models');
        
        if (result.success && result.models.length > 0) {
            modelSelect.innerHTML = '<option value="gemini-2.0-flash">gemini-2.0-flash (Default)</option>';

            const uniqueModels = new Set<string>(['gemini-2.0-flash']);
            
            result.models.forEach((model: { name: string }) => {
                const modelName = model.name;
                if (!uniqueModels.has(modelName)) {
                    const option = document.createElement('option');
                    option.value = modelName;
                    option.text = modelName;
                    modelSelect.add(option);
                    uniqueModels.add(modelName);
                }
            });
            
            if (savedModel) {
                const optionExists = Array.from(modelSelect.options).some(opt => opt.value === savedModel);
                if (optionExists) {
                    modelSelect.value = savedModel;
                } else {
                    const customOption = document.createElement('option');
                    customOption.value = savedModel;
                    customOption.text = `${savedModel} (Custom)`;
                    modelSelect.add(customOption);
                    modelSelect.value = savedModel;
                }
            }
        } else {
            console.error('Could not fetch models: ' + (result.error || 'Unknown reason'));
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error('Error fetching models: ' + errorMessage);
    } finally {
        const finalLoadingOption = modelSelect.querySelector('option[value="loading"]');
        if (finalLoadingOption) finalLoadingOption.remove();
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
                clearPreviewCache(); // Invalidate cache
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
    clearPreviewCache(); // Invalidate cache
}

function quitApp() {
    ipcRenderer.invoke('quit-app');
}

// External Links
function openExternalLink(url: string) {
    shell.openExternal(url);
} 

// Settings Management functions are now in settings.ts

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
    const modal = document.getElementById('noteModal');
    const titleElement = document.getElementById('noteModalTitle');
    const contentElement = document.getElementById('noteContent') as HTMLTextAreaElement;
    
    if (modal && titleElement && contentElement) {
        modal.style.display = 'flex';
        titleElement.textContent = 'Add Note';
        contentElement.value = '';
        contentElement.focus();
    }
    
    // Load previous notes in modal
    await loadPreviousNotesInModal();
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
            clearPreviewCache(); // Invalidate cache
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
                clearPreviewCache(); // Invalidate cache
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
            
            // Initialize chat model dropdown
            await initializeChatModelDropdown();
        }

        // Initialize period toggle
        const periodToggle = document.getElementById('periodToggle') as HTMLInputElement;
        if (periodToggle) {
            periodToggle.addEventListener('change', toggleDataPeriodView);
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
    await Settings.initializeAutoLaunch();
    
    // Add event listener for auto-launch toggle
    const autoLaunchToggle = document.getElementById('autoLaunchToggle') as HTMLInputElement | null;
    if (autoLaunchToggle) {
        autoLaunchToggle.addEventListener('change', Settings.toggleAutoLaunch);
    }

    // Initialize Gemini model input
    await Settings.initializeGeminiModel();

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

    // Add event listeners for data preview
    // Removed dataPills.forEach(pill => { ... });
});

// Initialize API key check
Settings.checkExistingApiKey();

// Add event listeners for custom events from settings module
window.addEventListener('updateStats', () => {
    updateStats();
});

window.addEventListener('setTracking', (event: any) => {
    setTracking(event.detail);
});

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
    const chatSidebar = document.getElementById('chatSidebar');
    
    if (settingsModal && settingsModal.style.display === 'flex') {
        if (e.key === 'Escape') {
            win.DOM.toggleSettings();
        }
    } else if (chatSidebar && chatSidebar.classList.contains('open')) {
        if (e.key === 'Escape') {
            win.DOM.toggleChatSidebar();
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

// Listen for global shortcut to toggle chat sidebar
ipcRenderer.on('toggle-chat-sidebar', () => {
    win.DOM.toggleChatSidebar();
});

// Add function to clear chat history
async function clearChatHistory() {
    try {
        await ipcRenderer.invoke('clear-chat-history');
        const chatMessages = document.getElementById('chatMessages');
        if (chatMessages) {
            chatMessages.innerHTML = '';
        }
    } catch (error) {
        console.error('Error clearing chat history:', error);
    }
}

// Export clearChatHistory to window
win.clearChatHistory = clearChatHistory;

// Export loadChatHistory to window
win.loadChatHistory = loadChatHistory;

ipcRenderer.on('quit-app', () => {
    // Handle quit app event
});

// Function to clear the preview cache
function clearPreviewCache() {
    previewCache = {};
    updateDataCounts();
}

// Function to update data counts on the buttons
async function updateDataCounts() {
    try {
        const result = await ipcRenderer.invoke('get-data-counts');
        if (result.success) {
            const { counts } = result;
            
            // Update the monthly count elements
            const descriptionsCountEl = document.getElementById('descriptionsCount');
            const logsCountEl = document.getElementById('logsCount');
            const statsCountEl = document.getElementById('statsCount');
            const notesCountEl = document.getElementById('notesCount');
            const analysesCountEl = document.getElementById('analysesCount');
            const tagsCountEl = document.getElementById('tagsCount');
            
            if (descriptionsCountEl) descriptionsCountEl.textContent = counts.descriptions.toString();
            if (logsCountEl) logsCountEl.textContent = counts.logs.toString();
            if (statsCountEl) statsCountEl.textContent = counts.stats.toString();
            if (notesCountEl) notesCountEl.textContent = counts.notes.toString();
            if (analysesCountEl) analysesCountEl.textContent = counts.analyses.toString();
            if (tagsCountEl) tagsCountEl.textContent = counts.tags.toString();
            
            // Update the yearly count elements
            const yearDescriptionsCountEl = document.getElementById('yearDescriptionsCount');
            const yearLogsCountEl = document.getElementById('yearLogsCount');
            const yearStatsCountEl = document.getElementById('yearStatsCount');
            const yearNotesCountEl = document.getElementById('yearNotesCount');
            const yearAnalysesCountEl = document.getElementById('yearAnalysesCount');
            const yearTagsCountEl = document.getElementById('yearTagsCount');
            
            if (yearDescriptionsCountEl) yearDescriptionsCountEl.textContent = counts.yearDescriptions.toString();
            if (yearLogsCountEl) yearLogsCountEl.textContent = counts.yearLogs.toString();
            if (yearStatsCountEl) yearStatsCountEl.textContent = counts.yearStats.toString();
            if (yearNotesCountEl) yearNotesCountEl.textContent = counts.yearNotes.toString();
            if (yearAnalysesCountEl) yearAnalysesCountEl.textContent = counts.yearAnalyses.toString();
            if (yearTagsCountEl) yearTagsCountEl.textContent = counts.yearTags.toString();
        }
    } catch (error) {
        console.error('Error updating data counts:', error);
    }
}

// Chat Functions
async function sendChatMessage(): Promise<void> {
    const chatInput = document.getElementById('chatInput') as HTMLTextAreaElement;
    const sendBtn = document.getElementById('sendChatBtn') as HTMLButtonElement;
    
    if (!chatInput || !sendBtn) return;
    
    const message = chatInput.value.trim();
    if (!message) return;
    
    // Disable send button and show loading state
    sendBtn.disabled = true;
    sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    
    try {
        // Add user message to chat
        win.DOM.addChatMessage(message, true);
        
        // Clear input
        win.DOM.clearChatInput();
        
        // Show typing indicator
        win.DOM.showTypingIndicator();
        
        // Determine selected data period
        const periodToggle = document.getElementById('periodToggle') as HTMLInputElement;
        const isYearView = periodToggle ? periodToggle.checked : false;

        // Get monthly data options state if month view is active
        const includeDescriptions = !isYearView && (document.getElementById('includeScreenshotsToggle')?.classList.contains('active') ?? false);
        const includeTags = !isYearView && (document.getElementById('includeTagsToggle')?.classList.contains('active') ?? false);
        const includeLogs = !isYearView && (document.getElementById('includeLogsToggle')?.classList.contains('active') ?? false);
        const includeStats = !isYearView && (document.getElementById('includeStatsToggle')?.classList.contains('active') ?? false);
        const includeNotes = !isYearView && (document.getElementById('includeNotesToggle')?.classList.contains('active') ?? false);
        const includeAnalyses = !isYearView && (document.getElementById('includeAnalysesToggle')?.classList.contains('active') ?? false);
        
        // Get yearly data options state if year view is active
        const includeYearScreenshots = isYearView && (document.getElementById('includeYearScreenshotsToggle')?.classList.contains('active') ?? false);
        const includeYearTags = isYearView && (document.getElementById('includeYearTagsToggle')?.classList.contains('active') ?? false);
        const includeYearLogs = isYearView && (document.getElementById('includeYearLogsToggle')?.classList.contains('active') ?? false);
        const includeYearStats = isYearView && (document.getElementById('includeYearStatsToggle')?.classList.contains('active') ?? false);
        const includeYearNotes = isYearView && (document.getElementById('includeYearNotesToggle')?.classList.contains('active') ?? false);
        const includeYearAnalyses = isYearView && (document.getElementById('includeYearAnalysesToggle')?.classList.contains('active') ?? false);

        // Send message to main process
        const response = await ipcRenderer.invoke('send-chat-message', message, {
            includeDescriptions,
            includeTags,
            includeLogs,
            includeStats,
            includeNotes,
            includeAnalyses,
            includeYearScreenshots,
            includeYearTags,
            includeYearLogs,
            includeYearStats,
            includeYearNotes,
            includeYearAnalyses
        });
        
        // Hide typing indicator
        win.DOM.hideTypingIndicator();
        
        if (response.success) {
            // Add AI response to chat (setting false for addToHistory since it's already stored in backend)
            win.DOM.addChatMessage(response.response, false);
        } else {
            // Add error message
            win.DOM.addChatMessage(`Sorry, I encountered an error: ${response.error}`, false);
        }
        
    } catch (error) {
        // Hide typing indicator on error
        win.DOM.hideTypingIndicator();
        
        // Add error message
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        win.DOM.addChatMessage(`Sorry, I encountered an error: ${errorMessage}`, false);
        
        console.error('Error sending chat message:', error);
    } finally {
        // Re-enable send button
        const sendBtn = document.getElementById('sendChatBtn') as HTMLButtonElement;
        if (sendBtn) {
            sendBtn.disabled = false;
            sendBtn.innerHTML = '<i class="fas fa-paper-plane"></i>';
        }
    }
}

// Toggle data option pills
function toggleDataOption(option: string): void {
    let button: HTMLElement | null = null;
    
    switch (option) {
        case 'screenshots':
            button = document.getElementById('includeScreenshotsToggle');
            break;
        case 'tags':
            button = document.getElementById('includeTagsToggle');
            break;
        case 'logs':
            button = document.getElementById('includeLogsToggle');
            break;
        case 'stats':
            button = document.getElementById('includeStatsToggle');
            break;
        case 'notes':
            button = document.getElementById('includeNotesToggle');
            break;
        case 'analyses':
            button = document.getElementById('includeAnalysesToggle');
            break;
        // Year toggles
        case 'yearScreenshots':
            button = document.getElementById('includeYearScreenshotsToggle');
            break;
        case 'yearTags':
            button = document.getElementById('includeYearTagsToggle');
            break;
        case 'yearLogs':
            button = document.getElementById('includeYearLogsToggle');
            break;
        case 'yearStats':
            button = document.getElementById('includeYearStatsToggle');
            break;
        case 'yearNotes':
            button = document.getElementById('includeYearNotesToggle');
            break;
        case 'yearAnalyses':
            button = document.getElementById('includeYearAnalysesToggle');
            break;
    }
        
    if (button) {
        button.classList.toggle('active');
    }
}

function handleChatKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendChatMessage();
    }
} 

// Global function exports for HTML onclick handlers
win.toggleTracking = toggleTracking;
win.testScreenshot = testScreenshot;
win.updateInterval = Settings.updateInterval;
win.initializeAPI = Settings.initializeAPI;
win.deleteAPIKey = Settings.deleteAPIKey;
win.toggleAutoLaunch = Settings.toggleAutoLaunch;
win.saveGeminiModel = Settings.saveGeminiModel;
win.fetchAvailableModels = Settings.fetchAvailableModels;
win.openLogsFile = Settings.openLogsFile;
win.showRecentLogs = Settings.showRecentLogs;
win.exportData = Settings.exportData;
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
win.toggleDataOption = toggleDataOption;

// Export DOM functions to global scope for HTML onclick handlers
win.toggleSettings = win.DOM.toggleSettings;
win.toggleExportModal = win.DOM.toggleExportModal;
win.toggleChatSidebar = win.DOM.toggleChatSidebar;
win.showMinimizeModal = win.DOM.showMinimizeModal;
win.closeMinimizeModal = win.DOM.closeMinimizeModal;
win.showAddNoteModal = showAddNoteModal;
win.sendChatMessage = sendChatMessage;
win.handleChatKeydown = handleChatKeydown; 

// Add this function to load chat history when the chat sidebar is opened
async function loadChatHistory() {
    try {
        const chatMessages = document.getElementById('chatMessages');
        if (!chatMessages) return;
        
        // Clear current messages
        chatMessages.innerHTML = '';
        
        // Fetch chat history from main process
        const history = await ipcRenderer.invoke('get-chat-history');
        
        // Display all messages in the history
        history.forEach((message: {content: string, role: string}) => {
            win.DOM.addChatMessage(message.content, message.role === 'user', false);
        });
        
        // Scroll to bottom
        chatMessages.scrollTop = chatMessages.scrollHeight;
    } catch (error) {
        console.error('Error loading chat history:', error);
    }
} 

// Function to toggle between month and year data views
function toggleDataPeriodView() {
    const periodToggle = document.getElementById('periodToggle') as HTMLInputElement;
    const monthOptions = document.getElementById('monthDataOptions');
    const yearOptions = document.getElementById('yearDataOptions');
    const monthLabel = document.getElementById('month-label');
    const yearLabel = document.getElementById('year-label');

    if (periodToggle && monthOptions && yearOptions && monthLabel && yearLabel) {
        if (periodToggle.checked) { // Year is selected
            monthOptions.style.display = 'none';
            yearOptions.style.display = 'block';
            monthLabel.style.color = 'var(--color-text-muted)';
            monthLabel.style.fontWeight = 'normal';
            yearLabel.style.color = 'var(--color-primary)';
            yearLabel.style.fontWeight = '500';
        } else { // Month is selected
            monthOptions.style.display = 'block';
            yearOptions.style.display = 'none';
            monthLabel.style.color = 'var(--color-primary)';
            monthLabel.style.fontWeight = '500';
            yearLabel.style.color = 'var(--color-text-muted)';
            yearLabel.style.fontWeight = 'normal';
        }
    }
} 
