const { ipcRenderer } = require('electron');
const { shell } = require('electron');

let isTracking = true;
let currentDate = new Date();
let editingNoteId = null;
let hasShownMinimizeMessage = false;
let currentPage = 1;
let allScreenshots = [];

const SCREENSHOTS_PER_PAGE = 5;

// Helper function to format category names
function formatCategoryName(category) {
    return category
        .toLowerCase()
        .replace(/_/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
}

// API Key Management
async function checkExistingApiKey() {
    const hasKey = await ipcRenderer.invoke('check-api-key');
    updateApiKeyUI(hasKey);
    if (hasKey) {
        const storedKey = await ipcRenderer.invoke('get-api-key');
        document.getElementById('apiKey').value = storedKey;
        await initializeInterval();
        updateStats();
    } else {
        isTracking = false;
        const button = document.getElementById('toggleTracking');
        button.innerHTML = `<i class="fas fa-play"></i><span>Start Recording</span>`;
        button.className = 'tracking-button inactive';
    }
}

function updateApiKeyUI(hasKey) {
    document.getElementById('settingsNotification').style.display = hasKey ? 'none' : 'block';
    document.getElementById('mainScreenWarning').style.display = hasKey ? 'none' : 'block';
    document.getElementById('apiKeyWarning').style.display = hasKey ? 'none' : 'block';

    // Disable tracking controls if no API key
    document.getElementById('toggleTracking').disabled = !hasKey;
    document.getElementById('testScreenshotBtn').disabled = !hasKey;
}

async function initializeAPI() {
    const apiKey = document.getElementById('apiKey').value.trim();
    if (!apiKey) {
        showValidationMessage('Please enter an API key', 'error');
        return;
    }

    const spinner = document.getElementById('validationSpinner');
    const saveButton = document.getElementById('saveApiKeyBtn');

    spinner.style.display = 'block';
    saveButton.disabled = true;

    try {
        const result = await ipcRenderer.invoke('initialize-api', apiKey);

        if (result.success) {
            showValidationMessage('API key validated successfully!', 'success');
            updateApiKeyUI(true);
            updateStats();
            setTimeout(() => toggleSettings(), 1500);
        } else {
            showValidationMessage(result.error || 'Invalid API key', 'error');
        }
    } catch (error) {
        showValidationMessage('Failed to validate API key', 'error');
    } finally {
        spinner.style.display = 'none';
        saveButton.disabled = false;
    }
}

function showValidationMessage(message, type) {
    const messageElement = document.getElementById('validationMessage');
    messageElement.textContent = message;
    messageElement.className = `validation-message ${type}`;

    // Ensure the message is visible
    messageElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function deleteAPIKey() {
    const success = await ipcRenderer.invoke('delete-api-key');
    if (success) {
        document.getElementById('apiKey').value = '';
        updateApiKeyUI(false);
        toggleSettings();

        // Reset tracking button state
        const button = document.getElementById('toggleTracking');
        button.innerHTML = `<i class="fas fa-play"></i><span>Start Recording</span>`;
        button.className = 'tracking-button inactive';
        button.disabled = true;

        // Disable test screenshot button
        document.getElementById('testScreenshotBtn').disabled = true;
    }
}

// Tracking Functions
async function toggleTracking() {
    isTracking = !isTracking;
    const tracking = await ipcRenderer.invoke('toggle-tracking', isTracking);
    const button = document.getElementById('toggleTracking');

    if (tracking) {
        button.innerHTML = `<i class="fas fa-pause"></i><span>Pause Recording</span>`;
        button.className = 'tracking-button active';
    } else {
        button.innerHTML = `<i class="fas fa-play"></i><span>Start Recording</span>`;
        button.className = 'tracking-button inactive';
    }
}

async function testScreenshot() {
    const button = document.getElementById('testScreenshotBtn');
    const countdownElement = document.getElementById('countdown');

    console.log('Starting screenshot test...');
    button.disabled = true;

    try {
        const result = await ipcRenderer.invoke('test-screenshot');
        console.log('Screenshot test completed:', result);
    } catch (error) {
        console.error('Error during screenshot test:', error);
    }

    button.disabled = false;
    countdownElement.textContent = '';
}

async function updateInterval() {
    const interval = document.getElementById('intervalSelect').value;
    await ipcRenderer.invoke('update-interval', parseInt(interval));
}

async function initializeInterval() {
    const savedInterval = await ipcRenderer.invoke('get-interval');
    if (savedInterval) {
        document.getElementById('intervalSelect').value = savedInterval.toString();
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
        updateCategoryStats(stats, timeInHours);

        // Update monthly averages
        await updateMonthlyAverages();

        // Store all screenshots and display initial page
        allScreenshots = data.screenshots || [];
        currentPage = 1;
        displayScreenshots();

        // Update day analysis if available
        const contentDiv = document.getElementById('dayAnalysisContent');
        if (data.dayAnalysis && data.dayAnalysis.content) {
            contentDiv.textContent = data.dayAnalysis.content;
        } else {
            contentDiv.textContent = 'No analysis generated yet for this day.';
        }
    } catch (error) {
        console.error('Error updating stats:', error);
    }
}

function updateCategoryStats(stats, timeInHours = {}) {
    const statsContainer = document.getElementById('categoryStats');
    statsContainer.innerHTML = '';

    const sortedCategories = Object.entries(stats)
        .sort(([, a], [, b]) => b - a);

    sortedCategories.forEach(([category, percentage]) => {
        const hours = timeInHours[category] || 0;
        const formattedHours = hours.toFixed(1);

        const categoryDiv = document.createElement('div');
        categoryDiv.className = 'category';
        categoryDiv.innerHTML = `
            <div class="category-header">
                <span class="category-title">${formatCategoryName(category)}</span>
                <div class="category-metrics">
                    <span class="category-hours">${formattedHours}h</span>
                    <span class="category-percentage">${percentage.toFixed(1)}%</span>
                </div>
            </div>
            <div class="progress">
                <div class="progress-bar ${category}" style="width: ${percentage}%"></div>
            </div>
        `;
        statsContainer.appendChild(categoryDiv);
    });
}

// Monthly Analytics
async function updateMonthlyAverages() {
    try {
        const data = await ipcRenderer.invoke('get-monthly-averages');
        console.log('Received monthly averages:', data);

        // Update the month indicator
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                            'July', 'August', 'September', 'October', 'November', 'December'];
        const monthName = monthNames[currentDate.getMonth()];
        const year = currentDate.getFullYear();
        document.getElementById('currentMonth').textContent = `${monthName} ${year} • ${data.daysWithData} days`;

        // Update the analytics cards - show each category with total and average per day
        const analyticsContainer = document.getElementById('monthlyAnalytics');
        analyticsContainer.innerHTML = '';

        // Sort categories by total hours (descending)
        const categoryEntries = Object.entries(data.monthlyTimeInHours)
            .filter(([category, hours]) => hours > 0) // Only show categories with data
            .sort(([, a], [, b]) => b - a);

        categoryEntries.forEach(([category, totalHours]) => {
            const avgPerDay = data.daysWithData > 0 ? totalHours / data.daysWithData : 0;
            
            const categoryCard = document.createElement('div');
            categoryCard.className = 'analytics-card';
            categoryCard.innerHTML = `
                <div class="card-header">
                    <span class="card-title">${formatCategoryName(category)}</span>
                    <span class="card-percentage">${data.monthlyAverages[category].toFixed(1)}%</span>
                </div>
                <div class="card-progress">
                    <div class="progress-bar ${category}" style="width: ${data.monthlyAverages[category]}%"></div>
                </div>
                <div class="card-metrics">
                    <div class="metric">
                        <span class="metric-value">${totalHours.toFixed(1)}h</span>
                        <span class="metric-label">total</span>
                    </div>
                    <div class="metric">
                        <span class="metric-value">${avgPerDay.toFixed(1)}h</span>
                        <span class="metric-label">per day</span>
                    </div>
                </div>
            `;
            analyticsContainer.appendChild(categoryCard);
        });

        // If no data, show a message
        if (categoryEntries.length === 0) {
            analyticsContainer.innerHTML = '<div class="no-data">No activity data for this month</div>';
        }
        
        // Update the next month button state
        updateNextMonthButtonState();
    } catch (error) {
        console.error('Error updating monthly averages:', error);
    }
}

async function changeMonth(offset) {
    // Create a new date object to avoid modifying the current date
    const newDate = new Date(currentDate);
    newDate.setMonth(newDate.getMonth() + offset);
    
    // Update the current date with the new month
    currentDate = newDate;
    
    try {
        // Update the monthly averages with the new month
        const data = await ipcRenderer.invoke('update-current-month', 
            currentDate.getFullYear(), 
            currentDate.getMonth()
        );
        
        // Update the month indicator
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                            'July', 'August', 'September', 'October', 'November', 'December'];
        const monthName = monthNames[currentDate.getMonth()];
        const year = currentDate.getFullYear();
        document.getElementById('currentMonth').textContent = `${monthName} ${year} • ${data.daysWithData} days`;
        
        // Update the analytics cards
        const analyticsContainer = document.getElementById('monthlyAnalytics');
        analyticsContainer.innerHTML = '';
        
        // Sort categories by total hours (descending)
        const categoryEntries = Object.entries(data.monthlyTimeInHours)
            .filter(([category, hours]) => hours > 0) // Only show categories with data
            .sort(([, a], [, b]) => b - a);
        
        categoryEntries.forEach(([category, totalHours]) => {
            const avgPerDay = data.daysWithData > 0 ? totalHours / data.daysWithData : 0;
            
            const categoryCard = document.createElement('div');
            categoryCard.className = 'analytics-card';
            categoryCard.innerHTML = `
                <div class="card-header">
                    <span class="card-title">${formatCategoryName(category)}</span>
                    <span class="card-percentage">${data.monthlyAverages[category].toFixed(1)}%</span>
                </div>
                <div class="card-progress">
                    <div class="progress-bar ${category}" style="width: ${data.monthlyAverages[category]}%"></div>
                </div>
                <div class="card-metrics">
                    <div class="metric">
                        <span class="metric-value">${totalHours.toFixed(1)}h</span>
                        <span class="metric-label">total</span>
                    </div>
                    <div class="metric">
                        <span class="metric-value">${avgPerDay.toFixed(1)}h</span>
                        <span class="metric-label">per day</span>
                    </div>
                </div>
            `;
            analyticsContainer.appendChild(categoryCard);
        });
        
        // If no data, show a message
        if (categoryEntries.length === 0) {
            analyticsContainer.innerHTML = '<div class="no-data">No activity data for this month</div>';
        }
        
        // Update the next month button state
        updateNextMonthButtonState();
        
        // Also update the daily view to match the month
        document.getElementById('currentDate').textContent = formatDate(currentDate);
        document.getElementById('nextDateBtn').disabled = isToday(currentDate);
        
        // Fetch updated data for the day view
        const dayData = await ipcRenderer.invoke('update-current-date', currentDate.toISOString());
        updateCategoryStats(dayData.stats, dayData.timeInHours);
        
        // Update screenshots
        if (Array.isArray(dayData.screenshots)) {
            allScreenshots = dayData.screenshots;
            currentPage = 1;
            displayScreenshots();
        } else {
            allScreenshots = [];
            displayScreenshots();
        }
    } catch (error) {
        console.error('Error changing month:', error);
    }
}

function isCurrentMonth(date) {
    const today = new Date();
    return date.getMonth() === today.getMonth() && 
           date.getFullYear() === today.getFullYear();
}

function updateNextMonthButtonState() {
    document.getElementById('nextMonthBtn').disabled = isCurrentMonth(currentDate);
} 

// Screenshot Display Functions
function displayScreenshots() {
    const historyContainer = document.getElementById('screenshotHistory');
    const showMoreBtn = document.getElementById('showMoreBtn');

    // Clear existing screenshots
    historyContainer.innerHTML = '';

    if (allScreenshots.length === 0) {
        historyContainer.innerHTML = '<div class="no-screenshots">No screenshots available for this date.</div>';
        showMoreBtn.style.display = 'none';
        return;
    }

    // Calculate range for current page
    const endIndex = currentPage * SCREENSHOTS_PER_PAGE;
    const screenshotsToShow = allScreenshots.slice(0, endIndex);

    screenshotsToShow.forEach(screenshot => {
        try {
            const date = new Date(screenshot.timestamp);

            const screenshotDiv = document.createElement('div');
            screenshotDiv.className = 'screenshot-item';
            
            // Only add tooltip and icon if description exists
            const hasDescription = screenshot.description && screenshot.description.trim();
            const tooltipHTML = hasDescription
                ? `<div class="screenshot-description-tooltip">
                    <div class="description-title">Detailed Description</div>
                    <div class="description-content">${screenshot.description}</div>
                </div>`
                : '';
            
            const iconHTML = hasDescription
                ? `<div class="screenshot-info-icon"><i class="fas fa-info-circle"></i></div>`
                : '';
            
            screenshotDiv.innerHTML = `
                <div class="screenshot-thumbnail-container">
                    <img src="${screenshot.thumbnail}" class="screenshot-thumbnail" />
                    ${iconHTML}
                    ${tooltipHTML}
                </div>
                <div class="screenshot-info">
                    <div class="screenshot-activity">Activity: ${screenshot.activity || 'Unknown'}</div>
                    <div class="screenshot-category category-label ${screenshot.category}">Category: ${formatCategoryName(screenshot.category || 'UNKNOWN')}</div>
                    <div class="screenshot-time">Time: ${date.toLocaleString()}</div>
                </div>
                <button class="delete-screenshot" onclick="deleteScreenshot(${screenshot.id})">
                    <i class="fas fa-trash"></i>
                </button>
            `;
            historyContainer.appendChild(screenshotDiv);
        } catch (error) {
            console.error('Error displaying screenshot:', error, screenshot);
        }
    });

    // Show/hide "Show More" button
    if (endIndex < allScreenshots.length) {
        showMoreBtn.style.display = 'inline-block';
        showMoreBtn.disabled = false;
    } else {
        showMoreBtn.style.display = 'none';
    }
}

function loadMoreScreenshots() {
    currentPage++;
    displayScreenshots();
}

async function deleteScreenshot(id) {
    if (confirm('Are you sure you want to delete this screenshot?')) {
        try {
            const success = await ipcRenderer.invoke('delete-screenshot', id);
            if (success) {
                // Remove from local array
                allScreenshots = allScreenshots.filter(s => s.id !== id);
                // Refresh display
                displayScreenshots();
                // Update stats
                const data = await ipcRenderer.invoke('get-stats');
                if (data) {
                    updateCategoryStats(data.stats.stats, data.stats.timeInHours);
                    // Update monthly averages after deletion
                    await updateMonthlyAverages();
                }
            }
        } catch (error) {
            console.error('Error deleting screenshot:', error);
        }
    }
}

// Date Management Functions
function formatDate(date) {
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    return date.toLocaleDateString('en-US', options);
}

function isToday(date) {
    const today = new Date();
    return date.getDate() === today.getDate() &&
        date.getMonth() === today.getMonth() &&
        date.getFullYear() === today.getFullYear();
}

async function changeDate(offset) {
    currentDate.setDate(currentDate.getDate() + offset);

    document.getElementById('nextDateBtn').disabled = isToday(currentDate);
    document.getElementById('currentDate').textContent = formatDate(currentDate);

    try {
        const data = await ipcRenderer.invoke('update-current-date', currentDate.toISOString());
        console.log('Received data for date change:', data);

        // Pass both stats and timeInHours to the update function
        updateCategoryStats(data.stats, data.timeInHours);

        // Update monthly averages when date changes
        await updateMonthlyAverages();
        
        // Update next month button state in case the month changed
        updateNextMonthButtonState();

        // Update screenshots
        if (Array.isArray(data.screenshots)) {
            allScreenshots = data.screenshots;
            currentPage = 1;
            displayScreenshots();
        } else {
            console.error('Invalid screenshots data:', data.screenshots);
            allScreenshots = [];
            displayScreenshots();
        }

        // Update diary logs for the new date
        if (data.notes) {
            displayNotes(data.notes);
        } else {
            await refreshNotes();
        }

        // Update day analysis
        const contentDiv = document.getElementById('dayAnalysisContent');
        if (data.dayAnalysis && data.dayAnalysis.content) {
            contentDiv.innerHTML = marked.parse(data.dayAnalysis.content);
        } else {
            contentDiv.textContent = 'No analysis generated yet for this day.';
        }
    } catch (error) {
        console.error('Error changing date:', error);
        allScreenshots = [];
        displayScreenshots();
    }
}

// Modal Functions
function toggleSettings() {
    const modal = document.getElementById('settingsModal');
    modal.style.display = modal.style.display === 'flex' ? 'none' : 'flex';
}

function toggleExportModal() {
    const modal = document.getElementById('exportModal');
    modal.style.display = modal.style.display === 'flex' ? 'none' : 'flex';
}

function showMinimizeModal() {
    document.getElementById('minimizeModal').style.display = 'flex';
}

function closeMinimizeModal(shouldClose = true) {
    const dontShowAgain = document.getElementById('dontShowAgain').checked;
    if (dontShowAgain) {
        localStorage.setItem('dontShowMinimizeMessage', 'true');
    }
    document.getElementById('minimizeModal').style.display = 'none';
    
    // Only close the window if explicitly requested
    if (shouldClose) {
        ipcRenderer.send('window-close');
    }
}

function handleModalClick(event) {
    if (event.target.id === 'minimizeModal') {
        closeMinimizeModal(false); // Close modal without closing window
    }
}

function quitApp() {
    ipcRenderer.invoke('quit-app');
}

// External Links
function openExternalLink(url) {
    shell.openExternal(url);
} 

// Settings Management
async function initializeAutoLaunch() {
    const isEnabled = await ipcRenderer.invoke('get-auto-launch');
    document.getElementById('autoLaunchToggle').checked = isEnabled;
}

async function toggleAutoLaunch(event) {
    const enable = event.target.checked;
    const success = await ipcRenderer.invoke('toggle-auto-launch', enable);
    if (!success) {
        event.target.checked = !enable;
        // Optionally show an error message
    }
}

// Model Management
async function initializeGeminiModel() {
    const currentModel = await ipcRenderer.invoke('get-gemini-model');
    
    // Set the current model first
    const modelSelect = document.getElementById('geminiModel');
    modelSelect.value = currentModel;
    
    // If the current model isn't in the default options, add it
    if (!Array.from(modelSelect.options).some(opt => opt.value === currentModel)) {
        const option = document.createElement('option');
        option.value = currentModel;
        option.text = currentModel;
        option.selected = true;
        modelSelect.add(option);
    }
    
    // Fetch available models after setting the current one
    fetchAvailableModels();
}

async function saveGeminiModel() {
    const modelSelect = document.getElementById('geminiModel');
    const saveButton = document.getElementById('saveModelBtn');
    const statusEl = document.getElementById('modelLoadingStatus');
    const model = modelSelect.value;

    if (!model || model === 'loading') {
        alert('Please select a valid model');
        return;
    }

    saveButton.disabled = true;
    saveButton.textContent = 'Testing model...';
    statusEl.textContent = 'Testing model with a simple request...';
    statusEl.className = 'model-status';

    try {
        // First test the model
        const testResult = await ipcRenderer.invoke('test-gemini-model', model);
        
        if (!testResult.success) {
            statusEl.textContent = 'Model test failed: ' + testResult.error;
            statusEl.className = 'model-status error';
            saveButton.textContent = 'Save';
            saveButton.disabled = false;
            return;
        }

        // If test passed, save the model
        saveButton.textContent = 'Saving...';
        const result = await ipcRenderer.invoke('set-gemini-model', model);
        
        if (result.success) {
            saveButton.textContent = 'Saved!';
            statusEl.textContent = 'Model tested and saved successfully!';
            statusEl.className = 'model-status success';
            setTimeout(() => {
                saveButton.textContent = 'Save';
                saveButton.disabled = false;
                statusEl.textContent = '';
                statusEl.className = 'model-status';
            }, 2000);
        } else {
            statusEl.textContent = 'Error saving model: ' + result.error;
            statusEl.className = 'model-status error';
            saveButton.textContent = 'Save';
            saveButton.disabled = false;
        }
    } catch (error) {
        statusEl.textContent = 'Error: ' + error.message;
        statusEl.className = 'model-status error';
        saveButton.textContent = 'Save';
        saveButton.disabled = false;
    }
}

async function fetchAvailableModels() {
    const modelSelect = document.getElementById('geminiModel');
    const refreshBtn = document.getElementById('refreshModelsBtn');
    const statusEl = document.getElementById('modelLoadingStatus');
    
    // Save current selection
    const currentSelection = modelSelect.value;
    
    // Show loading state
    refreshBtn.classList.add('loading');
    refreshBtn.disabled = true;
    statusEl.textContent = 'Loading available models...';
    statusEl.className = 'model-status';
    
    try {
        const result = await ipcRenderer.invoke('fetch-available-models');
        
        if (result.success && result.models.length > 0) {
            // Keep track of existing options to preserve custom ones
            const existingOptions = Array.from(modelSelect.options).map(opt => ({
                value: opt.value,
                text: opt.text,
                selected: opt.selected
            }));
            
            // Clear all options
            modelSelect.innerHTML = '';
            
            // Add default option
            const defaultOption = document.createElement('option');
            defaultOption.value = 'gemini-2.0-flash';
            defaultOption.text = 'gemini-2.0-flash (Default)';
            modelSelect.add(defaultOption);
            
            // Add fetched models
            result.models.forEach(model => {
                const option = document.createElement('option');
                option.value = model.id;
                option.text = model.name;
                if (model.description) {
                    option.title = model.description;
                }
                modelSelect.add(option);
            });
            
            // Restore selection - if the saved model isn't in the list, add it
            if (currentSelection && !Array.from(modelSelect.options).some(opt => opt.value === currentSelection)) {
                const customOption = document.createElement('option');
                customOption.value = currentSelection;
                customOption.text = currentSelection + ' (Custom)';
                modelSelect.add(customOption);
            }
            
            // Set the selection
            modelSelect.value = currentSelection;
            
            statusEl.textContent = `Loaded ${result.models.length} available models`;
            statusEl.className = 'model-status success';
        } else {
            statusEl.textContent = result.error || 'No models found';
            statusEl.className = 'model-status error';
        }
    } catch (error) {
        statusEl.textContent = 'Error loading models: ' + error.message;
        statusEl.className = 'model-status error';
    } finally {
        refreshBtn.classList.remove('loading');
        refreshBtn.disabled = false;
    }
}

// Logs Management
async function openLogsFile() {
    await ipcRenderer.invoke('open-logs');
}

async function showRecentLogs() {
    const logsContainer = document.getElementById('recentLogs');
    const logsContent = logsContainer.querySelector('.logs-content');
    
    // Toggle visibility
    if (logsContainer.style.display === 'none') {
        const logs = await ipcRenderer.invoke('get-recent-logs');
        logsContent.innerHTML = logs.map(log => `<div>${log}</div>`).join('');
        logsContainer.style.display = 'block';
    } else {
        logsContainer.style.display = 'none';
    }
}

// Export Functions
async function exportData() {
    const exportBtn = document.getElementById('exportBtn');
    const originalText = exportBtn.innerHTML;
    
    // Show loading state
    exportBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Exporting...';
    exportBtn.disabled = true;

    try {
        // Get selected range
        const selectedRange = document.querySelector('input[name="dateRange"]:checked').value;
        let startDate, endDate;

        const today = new Date();
        const yesterday = new Date();
        yesterday.setDate(today.getDate() - 1);

        switch (selectedRange) {
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
                const startDateInput = document.getElementById('startDate').value;
                const endDateInput = document.getElementById('endDate').value;
                if (!startDateInput || !endDateInput) {
                    alert('Please select both start and end dates for custom range.');
                    return;
                }
                startDate = new Date(startDateInput);
                startDate.setHours(0, 0, 0, 0);
                endDate = new Date(endDateInput);
                endDate.setHours(23, 59, 59, 999);
                break;
        }

        // Call export function
        const result = await ipcRenderer.invoke('export-data', {
            startDate: startDate.toISOString(),
            endDate: endDate.toISOString(),
            rangeType: selectedRange
        });

        if (result.success) {
            // Close modal and show success message
            toggleExportModal();
            // You could add a toast notification here
            console.log('Export successful:', result.filePath);
        } else {
            alert('Export failed: ' + result.error);
        }
    } catch (error) {
        console.error('Export error:', error);
        alert('Export failed: ' + error.message);
    } finally {
        // Reset button state
        exportBtn.innerHTML = originalText;
        exportBtn.disabled = false;
    }
}

// Error Handling
function showAnalysisError(error) {
    const errorCard = document.getElementById('analysisErrorCard');
    const errorMessage = document.getElementById('errorMessage');
    const errorTime = document.getElementById('errorTime');
    
    errorMessage.textContent = error.message;
    
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
    errorTime.textContent = `Last occurred: ${formattedDate}, ${formattedTime}`;
    
    errorCard.style.display = 'block';
}

function hideAnalysisError() {
    const errorCard = document.getElementById('analysisErrorCard');
    errorCard.style.display = 'none';
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
    editingNoteId = null;
    document.getElementById('noteModalTitle').textContent = 'Add Note';
    document.getElementById('noteContent').value = '';
    document.getElementById('saveNoteBtn').innerHTML = '<i class="fas fa-save"></i> Save Note';
    
    // Load and display previous notes
    await loadPreviousNotesInModal();
    
    document.getElementById('noteModal').style.display = 'flex';
    
    // Focus with a small delay to ensure modal is fully rendered
    setTimeout(() => {
        document.getElementById('noteContent').focus();
    }, 100);
}

async function showEditNoteModal(note) {
    editingNoteId = note.id;
    document.getElementById('noteModalTitle').textContent = 'Edit Note';
    document.getElementById('noteContent').value = note.content || '';
    document.getElementById('saveNoteBtn').innerHTML = '<i class="fas fa-save"></i> Update Note';
    
    // Load and display previous notes (excluding the one being edited)
    await loadPreviousNotesInModal(note.id);
    
    document.getElementById('noteModal').style.display = 'flex';
    
    // Focus with a small delay to ensure modal is fully rendered
    setTimeout(() => {
        const textarea = document.getElementById('noteContent');
        textarea.focus();
        // Place cursor at the end of the text
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    }, 100);
}

function closeNoteModal() {
    document.getElementById('noteModal').style.display = 'none';
    editingNoteId = null;
}

async function loadPreviousNotesInModal(excludeId = null) {
    try {
        const result = await ipcRenderer.invoke('get-notes-for-date', currentDate.toISOString());
        if (result.success && result.notes && result.notes.length > 0) {
            // Filter out the note being edited and reverse order (oldest first, newest last)
            const filteredNotes = result.notes
                .filter(note => note.id !== excludeId)
                .reverse();
            
            if (filteredNotes.length > 0) {
                const modalNotesList = document.getElementById('modalNotesList');
                modalNotesList.innerHTML = filteredNotes.map(note => {
                    const timestamp = new Date(note.timestamp);
                    const timeString = timestamp.toLocaleTimeString(undefined, {
                        hour: 'numeric',
                        minute: '2-digit',
                        hour12: true
                    });
                    
                    return `
                        <div class="modal-note-item">
                            <div class="modal-note-header">
                                <span class="modal-note-time">${timeString}</span>
                                <div class="modal-note-content-wrapper">
                                    <div class="modal-note-content">${note.content.replace(/\n/g, '<br>')}</div>
                                </div>
                            </div>
                        </div>
                    `;
                }).join('');
                
                document.getElementById('modalPreviousNotes').style.display = 'block';
                
                // Scroll to bottom to show latest notes
                setTimeout(() => {
                    const modalPreviousNotes = document.getElementById('modalPreviousNotes');
                    modalPreviousNotes.scrollTop = modalPreviousNotes.scrollHeight;
                }, 0);
            } else {
                document.getElementById('modalPreviousNotes').style.display = 'none';
            }
        } else {
            document.getElementById('modalPreviousNotes').style.display = 'none';
        }
    } catch (error) {
        console.error('Error loading previous notes in modal:', error);
        document.getElementById('modalPreviousNotes').style.display = 'none';
    }
}

async function saveNote() {
    const content = document.getElementById('noteContent').value.trim();

    if (!content) {
        // Just close the modal if no content, don't show alert
        closeNoteModal();
        return;
    }

    const saveBtn = document.getElementById('saveNoteBtn');
    const originalText = saveBtn.innerHTML;
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

    try {
        let result;

        if (editingNoteId) {
            result = await ipcRenderer.invoke('update-note', editingNoteId, content);
        } else {
            result = await ipcRenderer.invoke('save-note', currentDate.toISOString(), content);
        }

        if (result.success) {
            closeNoteModal();
            await refreshNotes();
        } else {
            alert('Failed to save note: ' + result.error);
        }
    } catch (error) {
        console.error('Error saving note:', error);
        alert('Failed to save note: ' + error.message);
    } finally {
        saveBtn.innerHTML = originalText;
    }
}

async function deleteNote(id) {
    if (confirm('Are you sure you want to delete this note?')) {
        try {
            const result = await ipcRenderer.invoke('delete-note', id);
            if (result.success) {
                await refreshNotes();
            } else {
                alert('Failed to delete note.');
            }
        } catch (error) {
            console.error('Error deleting note:', error);
            alert('Failed to delete note: ' + error.message);
        }
    }
}

async function refreshNotes() {
    try {
        const result = await ipcRenderer.invoke('get-notes-for-date', currentDate.toISOString());
        if (result.success) {
            displayNotes(result.notes);
        }
    } catch (error) {
        console.error('Error refreshing notes:', error);
    }
}

function displayNotes(notes) {
    const container = document.getElementById('notes');
    
    if (!notes || notes.length === 0) {
        container.innerHTML = '<div class="no-notes">No notes for this date. Click "Add Note" to create one.</div>';
        return;
    }

    // Reverse the notes to show oldest first, newest last
    const reversedNotes = [...notes].reverse();
    
    container.innerHTML = reversedNotes.map(note => {
        const timestamp = new Date(note.timestamp);
        const timeString = timestamp.toLocaleTimeString(undefined, {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });

        return `
            <div class="note-item">
                <div class="note-header">
                    <span class="note-time">${timeString}</span>
                    <div class="note-content-wrapper">
                        <div class="note-content">${note.content.replace(/\n/g, '<br>')}</div>
                    </div>
                    <div class="note-actions">
                        <button onclick="showEditNoteModal(${JSON.stringify(note).replace(/"/g, '&quot;')})" class="edit-btn" title="Edit">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button onclick="deleteNote(${note.id})" class="delete-btn" title="Delete">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// Day Analysis Functions
async function loadDayAnalysis() {
    console.log('Loading day analysis for date:', currentDate);
    try {
        const analysis = await ipcRenderer.invoke('get-day-analysis', currentDate);
        const contentDiv = document.getElementById('dayAnalysisContent');
        
        if (analysis && analysis.content) {
            console.log('Displaying existing analysis');
            contentDiv.innerHTML = marked.parse(analysis.content);
        } else {
            console.log('No existing analysis found');
            contentDiv.textContent = 'No analysis generated yet for this day.';
        }
    } catch (error) {
        console.error('Error loading day analysis:', error);
        document.getElementById('dayAnalysisContent').textContent = 'Error loading analysis.';
    }
} 

// Event Listeners and Initialization
document.addEventListener('DOMContentLoaded', async () => {
    try {
        // Initialize date display
        document.getElementById('currentDate').textContent = formatDate(currentDate);
        document.getElementById('nextDateBtn').disabled = isToday(currentDate);
        
        // Initialize next month button state
        updateNextMonthButtonState();

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
            updateCategoryStats(stats, timeInHours);
            
            // Initialize monthly averages
            await updateMonthlyAverages();

            // Initialize screenshots
            allScreenshots = data.screenshots || [];
            currentPage = 1;
            displayScreenshots();
        }
    } catch (error) {
        console.error('Error initializing data:', error);
    }

    // Add window control button handlers
    document.getElementById('minimize-btn').addEventListener('click', () => {
        ipcRenderer.send('window-minimize');
    });

    document.getElementById('close-btn').addEventListener('click', () => {
        const dontShowAgain = localStorage.getItem('dontShowMinimizeMessage');
        if (!dontShowAgain) {
            showMinimizeModal();
        } else {
            ipcRenderer.send('window-close');
        }
    });

    // Initialize auto-launch toggle
    await initializeAutoLaunch();
    
    // Add event listener for auto-launch toggle
    document.getElementById('autoLaunchToggle').addEventListener('change', toggleAutoLaunch);

    // Initialize Gemini model input
    await initializeGeminiModel();

    // Initialize date navigation on page load
    document.getElementById('currentDate').textContent = formatDate(currentDate);
    document.getElementById('nextDateBtn').disabled = isToday(currentDate);
    
    // Initialize month navigation
    updateNextMonthButtonState();

    // Add event listeners for export modal
    const rangeRadios = document.querySelectorAll('input[name="dateRange"]');
    rangeRadios.forEach(radio => {
        radio.addEventListener('change', function() {
            const customInputs = document.getElementById('customRangeInputs');
            if (this.value === 'custom') {
                customInputs.style.display = 'block';
                // Set default dates
                const today = new Date();
                const oneWeekAgo = new Date();
                oneWeekAgo.setDate(today.getDate() - 7);
                
                document.getElementById('startDate').value = oneWeekAgo.toISOString().split('T')[0];
                document.getElementById('endDate').value = today.toISOString().split('T')[0];
            } else {
                customInputs.style.display = 'none';
            }
        });
    });

    // Close export modal when clicking outside
    document.getElementById('exportModal').addEventListener('click', (e) => {
        if (e.target === document.getElementById('exportModal')) {
            toggleExportModal();
        }
    });

    // Day analysis button handler
    document.getElementById('generateAnalysis').addEventListener('click', async () => {
        console.log('Generate analysis button clicked');
        const button = document.getElementById('generateAnalysis');
        const contentDiv = document.getElementById('dayAnalysisContent');
        
        try {
            button.disabled = true;
            button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating...';
            contentDiv.textContent = 'Generating analysis...';
            
            console.log('Requesting analysis for date:', currentDate);
            const analysis = await ipcRenderer.invoke('generate-day-analysis', currentDate);
            console.log('Analysis received:', analysis ? 'success' : 'empty');
            
            if (!analysis) {
                throw new Error('No analysis was generated');
            }
            
            contentDiv.innerHTML = marked.parse(analysis);
        } catch (error) {
            console.error('Error generating analysis:', error);
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
        } finally {
            button.disabled = false;
            button.innerHTML = '<i class="fas fa-brain"></i> Generate Analysis';
        }
    });
});

// Initialize API key check
checkExistingApiKey();

// Modal event listeners
document.getElementById('settingsModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('settingsModal')) {
        toggleSettings();
    }
});

document.getElementById('minimizeModal').addEventListener('click', handleModalClick);

// Escape key handler for closing modals
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const settingsModal = document.getElementById('settingsModal');
        if (settingsModal.style.display === 'flex') {
            toggleSettings();
        }
    }
});

// Add keyboard support for note modal
document.addEventListener('keydown', (e) => {
    const noteModal = document.getElementById('noteModal');
    if (noteModal.style.display === 'flex') {
        if (e.key === 'Escape') {
            closeNoteModal();
        } else if (e.key === 'Enter' && e.ctrlKey) {
            // Ctrl+Enter to save
            saveNote();
        } else if (e.key === 'Enter' && !e.shiftKey && e.target.id === 'noteContent') {
            // Enter to save (Shift+Enter for new line)
            e.preventDefault();
            saveNote();
        }
    }
});

// IPC Event Listeners
ipcRenderer.on('activity-updated', (event, data) => {
    console.log('Received activity update:', data);
    updateStats(); // Just call updateStats which will handle both stats and screenshots
});

ipcRenderer.on('countdown-update', (event, count) => {
    const countdownElement = document.getElementById('countdown');
    countdownElement.textContent = `Taking screenshot in ${count}...`;
});

ipcRenderer.on('tracking-paused', () => {
    isTracking = false;
    const button = document.getElementById('toggleTracking');
    button.innerHTML = `<i class="fas fa-play"></i><span>Start Recording</span>`;
    button.className = 'tracking-button inactive';
});

ipcRenderer.on('refresh-ui', async () => {
    try {
        const data = await ipcRenderer.invoke('request-refresh');
        if (data) {
            const stats = data.stats.stats || data.stats;
            const timeInHours = data.stats.timeInHours || {};

            updateCategoryStats(stats, timeInHours);
            
            // Update monthly averages on refresh
            await updateMonthlyAverages();

            allScreenshots = data.screenshots || [];
            currentPage = 1;
            displayScreenshots();
            
            // Update day analysis
            const contentDiv = document.getElementById('dayAnalysisContent');
            if (data.dayAnalysis && data.dayAnalysis.content) {
                contentDiv.innerHTML = marked.parse(data.dayAnalysis.content);
            } else {
                contentDiv.textContent = 'No analysis generated yet for this day.';
            }
        }
    } catch (error) {
        console.error('Error refreshing UI:', error);
    }
});

ipcRenderer.on('initial-data', async (event, data) => {
    if (data) {
        const stats = data.stats.stats || data.stats;
        const timeInHours = data.stats.timeInHours || {};

        updateCategoryStats(stats, timeInHours);
        
        // Update monthly averages on initial load
        await updateMonthlyAverages();

        allScreenshots = data.screenshots || [];
        currentPage = 1;
        displayScreenshots();
        
        // Display notes
        if (data.notes) {
            displayNotes(data.notes);
        } else {
            await refreshNotes();
        }

        // Update day analysis
        const contentDiv = document.getElementById('dayAnalysisContent');
        if (data.dayAnalysis && data.dayAnalysis.content) {
            contentDiv.innerHTML = marked.parse(data.dayAnalysis.content);
        } else {
            contentDiv.textContent = 'No analysis generated yet for this day.';
        }
    }
});

// Error handling listeners
ipcRenderer.on('analysis-error', (event, error) => {
    showAnalysisError(error);
});

ipcRenderer.on('analysis-error-cleared', () => {
    hideAnalysisError();
});

// Listen for global shortcut to open note modal
ipcRenderer.on('open-note-modal', () => {
    showAddNoteModal();
});

ipcRenderer.on('quit-app', () => {
    isQuitting = true;
    app.quit();
}); 