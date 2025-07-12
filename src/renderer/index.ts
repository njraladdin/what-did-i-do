// Import required modules
const { ipcRenderer, shell } = require('electron');

// Add marked declaration
declare const marked: {
    parse: (markdown: string) => string;
};

// Type declarations for Chart.js
declare const Chart: any;

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

interface ChartContext {
    dataset: {
        label: string;
    };
    parsed: {
        y: number;
    };
}

interface CategoryColorMap {
    WORK: string;
    LEARN: string;
    SOCIAL: string;
    ENTERTAINMENT: string;
    OTHER: string;
    [key: string]: string; // Allow string indexing for unknown categories
}

let isTracking = true;
let currentDate = new Date();
let editingNoteId: number | null = null;
let hasShownMinimizeMessage = false;
let currentPage = 1;
let allScreenshots: Screenshot[] = [];
let dailyProgressChart: any = null; // Will be properly typed when Chart.js is imported
let yearlyProgressChart: any = null; // Will be properly typed when Chart.js is imported

const SCREENSHOTS_PER_PAGE = 5;

// Helper function to format category names
function formatCategoryName(category: string): string {
    return category
        .toLowerCase()
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c: string) => c.toUpperCase());
}

// API Key Management
async function checkExistingApiKey(): Promise<void> {
    const hasKey = await ipcRenderer.invoke('check-api-key');
    updateApiKeyUI(hasKey);
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

function updateApiKeyUI(hasKey: boolean): void {
    const settingsNotification = document.getElementById('settingsNotification');
    const mainScreenWarning = document.getElementById('mainScreenWarning');
    const apiKeyWarning = document.getElementById('apiKeyWarning');

    if (settingsNotification) {
        settingsNotification.style.display = hasKey ? 'none' : 'block';
    }
    if (mainScreenWarning) {
        mainScreenWarning.style.display = hasKey ? 'none' : 'block';
    }
    if (apiKeyWarning) {
        apiKeyWarning.style.display = hasKey ? 'none' : 'block';
    }

    // Disable tracking controls if no API key
    const toggleTracking = document.getElementById('toggleTracking') as HTMLButtonElement | null;
    const testScreenshotBtn = document.getElementById('testScreenshotBtn') as HTMLButtonElement | null;
    if (toggleTracking) {
        toggleTracking.disabled = !hasKey;
    }
    if (testScreenshotBtn) {
        testScreenshotBtn.disabled = !hasKey;
    }
}

async function initializeAPI(): Promise<void> {
    const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement | null;
    const apiKey = apiKeyInput?.value.trim() || '';
    
    if (!apiKey) {
        showValidationMessage('Please enter an API key', 'error');
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
        if (spinner) {
            spinner.style.display = 'none';
        }
        if (saveButton) {
            saveButton.disabled = false;
        }
    }
}

function showValidationMessage(message: string, type: string): void {
    const messageElement = document.getElementById('validationMessage');
    if (messageElement) {
        messageElement.textContent = message;
        messageElement.className = `validation-message ${type}`;

        // Ensure the message is visible
        messageElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

async function deleteAPIKey() {
    const success = await ipcRenderer.invoke('delete-api-key');
    if (success) {
        const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement | null;
        if (apiKeyInput) {
            apiKeyInput.value = '';
        }
        updateApiKeyUI(false);
        toggleSettings();

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

function updateCategoryStats(stats: { [key: string]: number }, timeInHours: { [key: string]: number }): void {
    const statsContainer = document.getElementById('categoryStats');
    if (!statsContainer) return;

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
async function updateMonthlyAverages(): Promise<void> {
    try {
        const data = await ipcRenderer.invoke('get-monthly-averages') as MonthlyData;
        console.log('Received monthly averages:', data);

        // Update the month indicator
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                          'July', 'August', 'September', 'October', 'November', 'December'];
        const monthName = monthNames[currentDate.getMonth()];
        const year = currentDate.getFullYear();
        const currentMonthElement = document.getElementById('currentMonth');
        if (currentMonthElement) {
            currentMonthElement.textContent = `${monthName} ${year} • ${data.daysWithData} days`;
        }

        // Update the analytics cards
        const analyticsContainer = document.getElementById('monthlyAnalytics');
        if (!analyticsContainer) return;

        analyticsContainer.innerHTML = '';

        // Sort categories by total hours (descending)
        const categoryEntries = Object.entries(data.monthlyTimeInHours)
            .filter(([, hours]) => typeof hours === 'number' && hours > 0)
            .sort(([, a], [, b]) => (b as number) - (a as number));

        categoryEntries.forEach(([category, totalHours]) => {
            const avgPerDay = data.daysWithData > 0 ? (totalHours as number) / data.daysWithData : 0;
            
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
                        <span class="metric-value">${(totalHours as number).toFixed(1)}h</span>
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
        const currentMonthElement = document.getElementById('currentMonth');
        if (currentMonthElement) {
            currentMonthElement.textContent = `${monthName} ${year} • ${data.daysWithData} days`;
        }
        
        // Update the analytics cards
        const analyticsContainer = document.getElementById('monthlyAnalytics');
        if (!analyticsContainer) return;

        analyticsContainer.innerHTML = '';
        
        // Sort categories by total hours (descending)
        const categoryEntries = Object.entries(data.monthlyTimeInHours)
            .filter(([category, hours]) => typeof hours === 'number' && hours > 0) // Only show categories with data
            .sort(([, a], [, b]) => (b as number) - (a as number));
        
        categoryEntries.forEach(([category, totalHours]) => {
            const avgPerDay = data.daysWithData > 0 ? (totalHours as number) / data.daysWithData : 0;
            
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
                        <span class="metric-value">${(totalHours as number).toFixed(1)}h</span>
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
        
        // Update the daily progress chart
        await updateDailyProgressChart();
        
        // Also update the daily view to match the month
        const currentDateElement = document.getElementById('currentDate');
        if (currentDateElement) {
            currentDateElement.textContent = formatDate(currentDate);
        }
        const nextDateBtn = document.getElementById('nextDateBtn');
        if (nextDateBtn) {
            (nextDateBtn as HTMLButtonElement).disabled = isToday(currentDate);
        }
        
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

function isCurrentMonth(date: Date): boolean {
    const today = new Date();
    return date.getMonth() === today.getMonth() && 
           date.getFullYear() === today.getFullYear();
}

function updateNextMonthButtonState() {
    const nextMonthBtn = document.getElementById('nextMonthBtn') as HTMLButtonElement;
    if (nextMonthBtn) {
        nextMonthBtn.disabled = isCurrentMonth(currentDate);
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

        const dailyStats = result.dailyStats;
        if (!dailyStats || Object.keys(dailyStats).length === 0) {
            console.log('No daily stats available for chart');
            return;
        }

        // Get all days in the month with data, sorted
        const daysWithData = Object.keys(dailyStats).sort();
        if (daysWithData.length === 0) return;

        // For each day, get the top 3 categories by hours
        const categorySet = new Set<string>();
        const topCategoriesPerDay = daysWithData.map(day => {
            const hours = dailyStats[day]?.timeInHours || {};
            // Get top 3 categories for this day by hours
            const top3 = Object.entries(hours)
                .filter(([, h]) => typeof h === 'number' && h > 0)
                .sort(([, a], [, b]) => (b as number) - (a as number))
                .slice(0, 3)
                .map(([cat]) => cat);
            top3.forEach(cat => categorySet.add(cat));
            return top3;
        });
        // All categories that were ever in a top 3
        const allTopCategories = Array.from(categorySet);

        // Color mapping for categories
        const categoryColors: CategoryColorMap = {
            WORK: 'rgba(37, 99, 235, 0.8)',           // Blue
            LEARN: 'rgba(34, 197, 94, 0.8)',          // Green
            SOCIAL: 'rgba(162, 28, 175, 0.8)',        // Purple
            ENTERTAINMENT: 'rgba(239, 68, 68, 0.8)',  // Red
            OTHER: 'rgba(100, 116, 139, 0.8)',        // Gray
        };
        const borderColors = {
            WORK: 'rgba(37, 99, 235, 1)',
            LEARN: 'rgba(34, 197, 94, 1)',
            SOCIAL: 'rgba(162, 28, 175, 1)',
            ENTERTAINMENT: 'rgba(239, 68, 68, 1)',
            OTHER: 'rgba(100, 116, 139, 1)'
        };

        // For each category, build a dataset with values for each day (0 if not in top 3 for that day)
        const datasets = allTopCategories.map(category => {
            return {
                label: formatCategoryName(category),
                data: daysWithData.map((day, i) => {
                    const top3 = topCategoriesPerDay[i];
                    if (top3.includes(category)) {
                        return dailyStats[day].timeInHours[category] || 0;
                    } else {
                        return 0;
                    }
                }),
                backgroundColor: categoryColors[category] || categoryColors.OTHER,
                borderColor: categoryColors[category] || categoryColors.OTHER,
                borderWidth: 1,
                borderRadius: 4,
                borderSkipped: false,
                maxBarThickness: 32
            };
        });

        // Find the max hours value for scaling
        let maxHours = 1;
        datasets.forEach(ds => {
            ds.data.forEach(val => {
                if (val > maxHours) maxHours = val;
            });
        });
        maxHours = Math.ceil(maxHours + 0.5); // round up for nice axis

        // X-axis labels: days (e.g., Jul 5, Jul 6, ...)
        const chartLabels = daysWithData.map(day => {
            const d = new Date(day);
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        });

        // Destroy existing chart if it exists
        if (dailyProgressChart) {
            dailyProgressChart.destroy();
        }

        // Create new chart
        const ctx = document.getElementById('dailyProgressChart');
        if (!ctx) {
            console.error('Chart canvas not found');
            return;
        }

        dailyProgressChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: chartLabels,
                datasets: datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: true,
                        position: 'top',
                        labels: {
                            usePointStyle: true,
                            padding: 20,
                            font: {
                                size: 12
                            }
                        }
                    },
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                        callbacks: {
                            label: function(context: ChartContext) {
                                return context.dataset.label + ': ' + Math.round(context.parsed.y) + 'h';
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        stacked: false,
                        grid: {
                            display: false
                        },
                        ticks: {
                            font: {
                                size: 12
                            }
                        }
                    },
                    y: {
                        stacked: false,
                        beginAtZero: true,
                        max: maxHours,
                        grid: {
                            color: 'rgba(0, 0, 0, 0.1)'
                        },
                        title: {
                            display: true,
                            text: 'Hours',
                            font: { size: 13 }
                        },
                        ticks: {
                            callback: function(value: number) {
                                return Math.round(value) + 'h';
                            },
                            font: {
                                size: 12
                            }
                        }
                    }
                },
                interaction: {
                    mode: 'nearest',
                    axis: 'x',
                    intersect: false
                }
            }
        });
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
        const data = result.data as { [key: string]: { [category: string]: number } }; 
        const monthLabels = [
            'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
            'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
        ];
        // For each month, get the top 3 categories by hours
        const months = Object.keys(data).sort();
        const categorySet = new Set<string>();
        const topCategoriesPerMonth = months.map(month => {
            const hours = data[month] || {};
            const top3 = Object.entries(hours)
                .filter(([, h]) => typeof h === 'number' && h > 0)
                .sort(([, a], [, b]) => (b as number) - (a as number))
                .slice(0, 3)
                .map(([cat]) => cat);
            top3.forEach(cat => categorySet.add(cat));
            return top3;
        });
        const allTopCategories = Array.from(categorySet);
        // Color mapping (same as daily)
        const categoryColors = {
            WORK: 'rgba(37, 99, 235, 0.8)',           // Blue
            LEARN: 'rgba(34, 197, 94, 0.8)',          // Green
            SOCIAL: 'rgba(162, 28, 175, 0.8)',        // Purple
            ENTERTAINMENT: 'rgba(239, 68, 68, 0.8)',  // Red
            OTHER: 'rgba(100, 116, 139, 0.8)'         // Gray
        };
        const borderColors = {
            WORK: 'rgba(37, 99, 235, 1)',
            LEARN: 'rgba(34, 197, 94, 1)',
            SOCIAL: 'rgba(162, 28, 175, 1)',
            ENTERTAINMENT: 'rgba(239, 68, 68, 1)',
            OTHER: 'rgba(100, 116, 139, 1)'
        };
        // For each category, build a dataset with values for each month (0 if not in top 3 for that month)
        const datasets = allTopCategories.map(category => {
            return {
                label: formatCategoryName(category),
                data: months.map((month, i) => {
                    const top3 = topCategoriesPerMonth[i];
                    if (top3.includes(category)) {
                        const monthData = data[month] || {};
                        return Math.round(monthData[category] || 0);
                    } else {
                        return null; // Use null to avoid rendering a bar and remove the gap
                    }
                }),
                backgroundColor: categoryColors[category as keyof typeof categoryColors] || 'rgba(180,180,180,0.7)',
                borderColor: borderColors[category as keyof typeof borderColors] || 'rgba(180,180,180,1)',
                borderWidth: 1,
                borderRadius: 4,
                borderSkipped: false,
                maxBarThickness: 32
            };
        });
        // Find the max hours value for scaling
        let maxHours = 1;
        datasets.forEach(ds => {
            ds.data.forEach(val => {
                if (val && val > maxHours) maxHours = val;
            });
        });
        maxHours = Math.ceil(maxHours + 0.5);
        // Destroy existing chart if it exists
        if (yearlyProgressChart) {
            yearlyProgressChart.destroy();
        }
        const ctx = document.getElementById('yearlyProgressChart');
        if (!ctx) {
            console.error('Yearly chart canvas not found');
            return;
        }
        yearlyProgressChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: monthLabels,
                datasets: datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: true,
                        position: 'top',
                        labels: {
                            usePointStyle: true,
                            padding: 20,
                            font: {
                                size: 12
                            }
                        }
                    },
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                        callbacks: {
                            label: function(context: any) {
                                return context.dataset.label + ': ' + Math.round(context.parsed.y) + 'h';
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        stacked: false,
                        grid: {
                            display: false
                        },
                        ticks: {
                            font: {
                                size: 12
                            }
                        }
                    },
                    y: {
                        stacked: false,
                        beginAtZero: true,
                        max: maxHours,
                        grid: {
                            color: 'rgba(0, 0, 0, 0.1)'
                        },
                        title: {
                            display: true,
                            text: 'Hours',
                            font: { size: 13 }
                        },
                        ticks: {
                            callback: function(value: any) {
                                return Math.round(value) + 'h';
                            },
                            font: {
                                size: 12
                            }
                        }
                    }
                },
                interaction: {
                    mode: 'nearest',
                    axis: 'x',
                    intersect: false
                }
            }
        });
    } catch (error) {
        console.error('Error updating yearly progress chart:', error);
    }
}

// Screenshot Display Functions
function displayScreenshots() {
    const historyContainer = document.getElementById('screenshotHistory');
    const showMoreBtn = document.getElementById('showMoreBtn') as HTMLButtonElement;

    // Clear existing screenshots
    if (historyContainer) {
        historyContainer.innerHTML = '';
    }

    if (allScreenshots.length === 0) {
        if (historyContainer) {
            historyContainer.innerHTML = '<div class="no-screenshots">No screenshots available for this date.</div>';
        }
        if (showMoreBtn) {
            showMoreBtn.style.display = 'none';
        }
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
            
            if (screenshotDiv) {
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
                if (historyContainer) {
                    historyContainer.appendChild(screenshotDiv);
                }
            }
        } catch (error) {
            console.error('Error displaying screenshot:', error, screenshot);
        }
    });

    // Show/hide "Show More" button
    if (showMoreBtn) {
        if (endIndex < allScreenshots.length) {
            showMoreBtn.style.display = 'inline-block';
            showMoreBtn.disabled = false;
        } else {
            showMoreBtn.style.display = 'none';
        }
    }
}

function loadMoreScreenshots() {
    currentPage++;
    displayScreenshots();
}

async function deleteScreenshot(id: number) {
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
function formatDate(date: Date): string {
    const options: Intl.DateTimeFormatOptions = { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
    };
    return date.toLocaleDateString('en-US', options);
}

function isToday(date: Date): boolean {
    const today = new Date();
    return date.getDate() === today.getDate() &&
        date.getMonth() === today.getMonth() &&
        date.getFullYear() === today.getFullYear();
}

async function changeDate(offset: number) {
    currentDate.setDate(currentDate.getDate() + offset);

    const nextDateBtn = document.getElementById('nextDateBtn') as HTMLButtonElement;
    if (nextDateBtn) {
        (nextDateBtn as HTMLButtonElement).disabled = isToday(currentDate);
    }
    const currentDateElement = document.getElementById('currentDate');
    if (currentDateElement) {
        currentDateElement.textContent = formatDate(currentDate);
    }

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

        // Update notes  for the new date
        if (data.notes) {
            displayNotes(data.notes);
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
        displayScreenshots();
    }
}

// Modal Functions
function toggleSettings() {
    const modal = document.getElementById('settingsModal');
    if (modal) {
        modal.style.display = modal.style.display === 'flex' ? 'none' : 'flex';
    }
}

function toggleExportModal() {
    const modal = document.getElementById('exportModal');
    if (modal) {
        modal.style.display = modal.style.display === 'flex' ? 'none' : 'flex';
    }
}

function showMinimizeModal() {
    const minimizeModal = document.getElementById('minimizeModal');
    if (minimizeModal) {
        minimizeModal.style.display = 'flex';
    }
}

function closeMinimizeModal(shouldClose = true) {
    const dontShowAgain = document.getElementById('dontShowAgain') as HTMLInputElement | null;
    if (dontShowAgain && dontShowAgain.checked) {
        if (dontShowAgain.checked) {
            localStorage.setItem('dontShowMinimizeMessage', 'true');
        }
    }
    const minimizeModal = document.getElementById('minimizeModal');
    if (minimizeModal) {
        minimizeModal.style.display = 'none';
    }
    
    // Only close the window if explicitly requested
    if (shouldClose) {
        ipcRenderer.send('window-close');
    }
}

function handleModalClick(event: MouseEvent) {
    const minimizeModal = document.getElementById('minimizeModal');
    if (minimizeModal && minimizeModal === event.target) {
        closeMinimizeModal(false); // Close modal without closing window
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
            toggleExportModal();
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
    editingNoteId = null;
    const noteModalTitle = document.getElementById('noteModalTitle');
    if (noteModalTitle) {
        noteModalTitle.textContent = 'Add Note';
    }
    const noteContent = document.getElementById('noteContent') as HTMLTextAreaElement;
    if (noteContent) {
        noteContent.value = '';
    }
    const saveNoteBtn = document.getElementById('saveNoteBtn');
    if (saveNoteBtn) {
        saveNoteBtn.innerHTML = '<i class="fas fa-save"></i> Save Note';
    }
    
    // Load and display previous notes
    await loadPreviousNotesInModal();
    
    const noteModal = document.getElementById('noteModal');
    if (noteModal) {
        noteModal.style.display = 'flex';
    }
    
    // Focus with a small delay to ensure modal is fully rendered
    setTimeout(() => {
        const noteContent = document.getElementById('noteContent') as HTMLTextAreaElement;
        if (noteContent) {
            noteContent.focus();
        }
    }, 100);
}

async function showEditNoteModal(note: Note) {
    editingNoteId = note.id;
    const noteModalTitle = document.getElementById('noteModalTitle');
    if (noteModalTitle) {
        noteModalTitle.textContent = 'Edit Note';
    }
    const noteContent = document.getElementById('noteContent') as HTMLTextAreaElement;
    if (noteContent) {
        noteContent.value = note.content || '';
    }
    const saveNoteBtn = document.getElementById('saveNoteBtn');
    if (saveNoteBtn) {
        saveNoteBtn.innerHTML = '<i class="fas fa-save"></i> Update Note';
    }
    
    // Load and display previous notes (excluding the one being edited)
    await loadPreviousNotesInModal(note.id);
    
    const noteModal = document.getElementById('noteModal');
    if (noteModal) {
        noteModal.style.display = 'flex';
    }
    
    // Focus with a small delay to ensure modal is fully rendered
    setTimeout(() => {
        const textarea = document.getElementById('noteContent') as HTMLTextAreaElement;
        if (textarea) {
            textarea.focus();
            // Place cursor at the end of the text
            textarea.setSelectionRange(textarea.value.length, textarea.value.length);
        }
    }, 100);
}

function closeNoteModal() {
    const noteModal = document.getElementById('noteModal');
    if (noteModal) {
        noteModal.style.display = 'none';
    }
    editingNoteId = null;
}

async function loadPreviousNotesInModal(excludeId: number | null = null) {
    try {
        const result = await ipcRenderer.invoke('get-notes-for-date', currentDate.toISOString());
        if (result.success && result.notes && result.notes.length > 0) {
            // Filter out the note being edited and reverse order (oldest first, newest last)
            const filteredNotes = result.notes
                .filter((note: { id: number }) => note.id !== excludeId)
                .reverse();
            
            if (filteredNotes.length > 0) {
                const modalNotesList = document.getElementById('modalNotesList');
                if (modalNotesList) {
                    modalNotesList.innerHTML = filteredNotes.map((note: { timestamp: string; content: string }) => {
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
                    
                    const modalPreviousNotes = document.getElementById('modalPreviousNotes');
                    if (modalPreviousNotes) {
                        modalPreviousNotes.style.display = 'block';
                        
                        // Scroll to bottom to show latest notes
                        setTimeout(() => {
                            modalPreviousNotes.scrollTop = modalPreviousNotes.scrollHeight;
                        }, 0);
                    }
                }
            } else {
                const modalPreviousNotes = document.getElementById('modalPreviousNotes');
                if (modalPreviousNotes) {
                    modalPreviousNotes.style.display = 'none';
                }
            }
        } else {
            const modalPreviousNotes = document.getElementById('modalPreviousNotes');
            if (modalPreviousNotes) {
                modalPreviousNotes.style.display = 'none';
            }
        }
    } catch (error: any) {
        console.error('Error loading previous notes in modal:', error);
        const modalPreviousNotes = document.getElementById('modalPreviousNotes');
        if (modalPreviousNotes) {
            modalPreviousNotes.style.display = 'none';
        }
    }
}

async function saveNote() {
    const content = (document.getElementById('noteContent') as HTMLTextAreaElement)?.value.trim();

    if (!content) {
        // Just close the modal if no content, don't show alert
        closeNoteModal();
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
            closeNoteModal();
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
            displayNotes(result.notes);
        }
    } catch (error) {
        console.error('Error refreshing notes:', error);
    }
}

function displayNotes(notes: Note[]) {
    const container = document.getElementById('notes');
    
    if (!container) return;

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
            currentDateElement.textContent = formatDate(currentDate);
        }
        const nextDateBtn = document.getElementById('nextDateBtn') as HTMLButtonElement;
        if (nextDateBtn) {
            (nextDateBtn as HTMLButtonElement).disabled = isToday(currentDate);
        }
        
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
                showMinimizeModal();
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
        currentDateElement.textContent = formatDate(currentDate);
    }
    const nextDateBtn = document.getElementById('nextDateBtn');
    if (nextDateBtn) {
        (nextDateBtn as HTMLButtonElement).disabled = isToday(currentDate);
    }
    
    // Initialize month navigation
    updateNextMonthButtonState();

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
                toggleExportModal();
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
            toggleSettings();
        }
    });
}

const minimizeModal = document.getElementById('minimizeModal');
if (minimizeModal) {
    minimizeModal.addEventListener('click', handleModalClick);
}

// Escape key handler for closing modals
document.addEventListener('keydown', (e) => {
    const settingsModal = document.getElementById('settingsModal');
    if (settingsModal && settingsModal.style.display === 'flex') {
        if (e.key === 'Escape') {
            toggleSettings();
        }
    }
});

// Add keyboard support for note modal
document.addEventListener('keydown', (e) => {
    const noteModal = document.getElementById('noteModal');
    if (noteModal && noteModal.style.display === 'flex') {
        if (e.key === 'Escape') {
            closeNoteModal();
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

            updateCategoryStats(stats, timeInHours);
            
            // Update monthly averages on refresh
            await updateMonthlyAverages();

            allScreenshots = data.screenshots || [];
            currentPage = 1;
            displayScreenshots();
            
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
    // isQuitting = true; // This line was removed from the original file, so it's removed here.
    // app.quit(); // This line was removed from the original file, so it's removed here.
}); 