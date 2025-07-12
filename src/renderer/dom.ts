// DOM manipulation and UI functions

// Type declarations for Chart.js
declare const Chart: any;

// Type declarations for window extensions
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

// Extend Window interface for global variables
interface WindowExtended extends Window {
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
    updateDataCounts: () => void; // Added updateDataCounts to the interface
    loadChatHistory: () => void; // Added loadChatHistory to the interface
    clearChatHistory: () => void; // Added clearChatHistory to the interface
}

// Get typed window reference
const typedWindow = window as unknown as WindowExtended;

// Helper function to format category names
function formatCategoryName(category: string): string {
    return category
        .toLowerCase()
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c: string) => c.toUpperCase());
}

// Screenshot Display Functions
function displayScreenshots(): void {
    const historyContainer = document.getElementById('screenshotHistory');
    const showMoreBtn = document.getElementById('showMoreBtn') as HTMLButtonElement | null;

    // Clear existing screenshots
    if (historyContainer) {
        historyContainer.innerHTML = '';
    }

    if (typedWindow.allScreenshots.length === 0) {
        if (historyContainer) {
            historyContainer.innerHTML = '<div class="no-screenshots">No screenshots available for this date.</div>';
        }
        if (showMoreBtn) {
            showMoreBtn.style.display = 'none';
        }
        return;
    }

    // Calculate range for current page
    const endIndex = typedWindow.currentPage * typedWindow.SCREENSHOTS_PER_PAGE;
    const screenshotsToShow = typedWindow.allScreenshots.slice(0, endIndex);

    screenshotsToShow.forEach((screenshot: Screenshot) => {
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
                    <button class="delete-screenshot" onclick="typedWindow.deleteScreenshot(${screenshot.id})">
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
        if (endIndex < typedWindow.allScreenshots.length) {
            showMoreBtn.style.display = 'inline-block';
            showMoreBtn.disabled = false;
        } else {
            showMoreBtn.style.display = 'none';
        }
    }
}

function loadMoreScreenshots(): void {
    typedWindow.currentPage++;
    displayScreenshots();
}

// Category Stats Display
function updateCategoryStats(stats: Record<string, number>, timeInHours: Record<string, number>): void {
    const statsContainer = document.getElementById('categoryStats');
    if (!statsContainer) return;

    statsContainer.innerHTML = '';

    const sortedCategories = Object.entries(stats)
        .filter(([category]) => category.toUpperCase() !== 'UNKNOWN')
        .sort(([, a], [, b]) => (b as number) - (a as number));

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
                    <span class="category-percentage">${(percentage as number).toFixed(1)}%</span>
                </div>
            </div>
            <div class="progress">
                <div class="progress-bar ${category}" style="width: ${percentage}%"></div>
            </div>
        `;
        statsContainer.appendChild(categoryDiv);
    });
}

// Monthly Analytics Display
function updateMonthlyAnalyticsDisplay(data: {
    monthlyTimeInHours: Record<string, number>;
    monthlyAverages: Record<string, number>;
    daysWithData: number;
}): void {
    // Update the month indicator
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                      'July', 'August', 'September', 'October', 'November', 'December'];
    const monthName = monthNames[typedWindow.currentDate.getMonth()];
    const year = typedWindow.currentDate.getFullYear();
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
        .filter(([category]) => category.toUpperCase() !== 'UNKNOWN')
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
}

// Modal Functions
function toggleSettings(): void {
    const modal = document.getElementById('settingsModal');
    if (modal) {
        modal.style.display = modal.style.display === 'flex' ? 'none' : 'flex';
    }
}

function toggleExportModal(): void {
    const modal = document.getElementById('exportModal');
    if (modal) {
        modal.style.display = modal.style.display === 'flex' ? 'none' : 'flex';
    }
}

function showMinimizeModal(): void {
    const minimizeModal = document.getElementById('minimizeModal');
    if (minimizeModal) {
        minimizeModal.style.display = 'flex';
    }
}

function closeMinimizeModal(shouldClose: boolean = true): void {
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
        typedWindow.ipcRenderer.send('window-close');
    }
}

function handleModalClick(event: Event): void {
    const minimizeModal = document.getElementById('minimizeModal');
    if (minimizeModal && minimizeModal === event.target) {
        closeMinimizeModal(false); // Close modal without closing window
    }
}

// API Key UI Management
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

function showValidationMessage(message: string, type: string): void {
    const messageElement = document.getElementById('validationMessage');
    if (messageElement) {
        messageElement.textContent = message;
        messageElement.className = `validation-message ${type}`;

        // Ensure the message is visible
        messageElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

// Date Display Functions
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

function isCurrentMonth(date: Date): boolean {
    const today = new Date();
    return date.getMonth() === today.getMonth() && 
           date.getFullYear() === today.getFullYear();
}

function updateNextMonthButtonState(): void {
    const nextMonthBtn = document.getElementById('nextMonthBtn') as HTMLButtonElement | null;
    if (nextMonthBtn) {
        nextMonthBtn.disabled = isCurrentMonth(typedWindow.currentDate);
    }
}

// Notes Display Functions
function displayNotes(notes: Array<{ id: number; content: string; timestamp: string }>): void {
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
                        <button onclick="window.showEditNoteModal(${JSON.stringify(note).replace(/"/g, '&quot;')})" class="edit-btn" title="Edit">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button onclick="window.deleteNote(${note.id})" class="delete-btn" title="Delete">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// Chart Functions
function renderDailyProgressChart(result: { 
    dailyStats: Record<string, { timeInHours: Record<string, number> }> 
}) {
    console.log('Rendering daily progress chart with data:', result);

    if (!result || !result.dailyStats) {
        console.error('Invalid data for daily progress chart:', result);
        return;
    }

    const dailyStats = result.dailyStats;
    const dates = Object.keys(dailyStats).sort();

    if (dates.length === 0) {
        console.log('No daily stats to render for the daily chart.');
        return;
    }

    // Determine the top 3 categories based on total time spent across the period
    const categoryTotals: Record<string, number> = {};
    dates.forEach(date => {
        const stats = dailyStats[date];
        if (stats && stats.timeInHours) {
            Object.entries(stats.timeInHours).forEach(([category, hours]) => {
                categoryTotals[category] = (categoryTotals[category] || 0) + hours;
            });
        }
    });

    const topCategories = Object.entries(categoryTotals)
        .filter(([category]) => category.toUpperCase() !== 'UNKNOWN')
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3)
        .map(([category]) => category);

    if (topCategories.length === 0) {
        console.log('No categories with activity to render for the daily chart.');
        return;
    }
    
    // Color mapping for categories
    const categoryColors: Record<string, string> = {
        WORK: 'rgba(37, 99, 235, 0.8)',           // Blue
        LEARN: 'rgba(34, 197, 94, 0.8)',          // Green
        SOCIAL: 'rgba(162, 28, 175, 0.8)',        // Purple
        ENTERTAINMENT: 'rgba(239, 68, 68, 0.8)',  // Red
        OTHER: 'rgba(100, 116, 139, 0.8)',        // Gray
    };

    const datasets = topCategories.map(category => {
        const data = dates.map(date => {
            const stats = dailyStats[date];
            return stats && stats.timeInHours ? (stats.timeInHours[category] || 0) : 0;
        });

        const formattedCategory = formatCategoryName(category);

        return {
            label: formattedCategory,
            data: data,
            backgroundColor: categoryColors[category] || categoryColors.OTHER,
            borderColor: categoryColors[category] || categoryColors.OTHER,
            borderWidth: 1,
            borderRadius: 4,
            borderSkipped: false,
            maxBarThickness: 32
        };
    });

    // Destroy existing chart if it exists
    if (typedWindow.dailyProgressChart) {
        typedWindow.dailyProgressChart.destroy();
    }

    // Get chart context
    const ctx = document.getElementById('dailyProgressChart') as HTMLCanvasElement | null;
    if (!ctx) {
        console.error('Could not find daily progress chart canvas element');
        return;
    }

    const chartData = {
        labels: dates.map(date => new Date(date).toLocaleDateString(undefined, { day: 'numeric' })),
        datasets: datasets
    };

    // Create new chart
    typedWindow.dailyProgressChart = new Chart(ctx, {
        type: 'bar',
        data: chartData,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        boxWidth: 12,
                        font: {
                            size: 13
                        }
                    }
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    callbacks: {
                        label: function(context: any) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed.y !== null) {
                                label += `${context.parsed.y.toFixed(1)}h`;
                            }
                            return label;
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
                            size: 13
                        }
                    }
                },
                y: {
                    stacked: false,
                    beginAtZero: true,
                    grid: {
                        color: 'rgba(200, 200, 200, 0.2)'
                    },
                    ticks: {
                        font: {
                            size: 13
                        },
                        callback: function(value: any) {
                            return `${value}h`;
                        }
                    }
                }
            },
            interaction: {
                mode: 'index',
                intersect: false
            }
        }
    });
}

function renderYearlyProgressChart(result: { 
    data: Record<string, any>, 
    topCategories: string[] 
}) {
    console.log('Rendering yearly progress chart with data:', result);

    if (!result || !result.data || !result.topCategories) {
        console.error('Invalid data for yearly progress chart:', result);
        return;
    }

    const stats = result.data;
    const topCategories = result.topCategories;
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    if (topCategories.length === 0) {
        console.log('No top categories to render for the yearly chart.');
        return;
    }
    
    // Color mapping for categories
    const categoryColors: Record<string, string> = {
        WORK: 'rgba(37, 99, 235, 0.8)',           // Blue
        LEARN: 'rgba(34, 197, 94, 0.8)',          // Green
        SOCIAL: 'rgba(162, 28, 175, 0.8)',        // Purple
        ENTERTAINMENT: 'rgba(239, 68, 68, 0.8)',  // Red
        OTHER: 'rgba(100, 116, 139, 0.8)',        // Gray
    };
    
    // Create datasets for the top categories
    const datasets = topCategories.map(category => {
        const data = monthNames.map((month, index) => {
            const monthKey = `${typedWindow.currentDate.getFullYear()}-${(index + 1).toString().padStart(2, '0')}`;
            return stats[monthKey] ? (stats[monthKey].timeInHours[category] || 0) : 0;
        });

        const formattedCategory = formatCategoryName(category);

        return {
            label: formattedCategory,
            data: data,
            backgroundColor: categoryColors[category] || categoryColors.OTHER,
            borderColor: categoryColors[category] || categoryColors.OTHER,
            borderWidth: 1,
            borderRadius: 4,
            borderSkipped: false,
            maxBarThickness: 32
        };
    });

    if (typedWindow.yearlyProgressChart) {
        typedWindow.yearlyProgressChart.destroy();
    }

    const ctx = document.getElementById('yearlyProgressChart') as HTMLCanvasElement | null;
    if (!ctx) {
        console.error('Could not find yearly progress chart canvas element');
        return;
    }
    
    typedWindow.yearlyProgressChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: monthNames,
            datasets: datasets,
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        boxWidth: 12,
                        font: {
                            size: 13,
                        },
                    },
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    callbacks: {
                        label: function(context: any) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed.y !== null) {
                                label += `${context.parsed.y.toFixed(1)}h`;
                            }
                            return label;
                        }
                    }
                }
            },
            scales: {
                x: {
                    stacked: false,
                    grid: {
                        display: false,
                    },
                    ticks: {
                        font: {
                            size: 13,
                        },
                    },
                },
                y: {
                    stacked: false,
                    beginAtZero: true,
                    grid: {
                        color: 'rgba(200, 200, 200, 0.2)',
                    },
                    ticks: {
                        font: {
                            size: 13,
                        },
                        callback: function(value: any) {
                            return `${value}h`;
                        },
                    },
                },
            },
            interaction: {
                mode: 'index',
                intersect: false
            }
        },
    });
}


// Chat Functions
function addChatMessage(message: string, isUser: boolean = false, addToHistory: boolean = true): void {
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return;

    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${isUser ? 'user-message' : 'assistant-message'}`;
    
    const icon = isUser ? 'fas fa-user' : 'fas fa-robot';
    
    // Format the message with basic markdown-like styling for AI responses
    let formattedMessage = message;
    if (!isUser) {
        formattedMessage = message
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') // Bold
            .replace(/\*(.*?)\*/g, '<em>$1</em>') // Italic
            .replace(/\n/g, '<br>') // Line breaks
            .replace(/^\d+\.\s/gm, '<br>$&') // Add line breaks before numbered lists
            .replace(/^-\s/gm, '<br>• '); // Convert dashes to bullets
    } else {
        formattedMessage = message.replace(/\n/g, '<br>');
    }
    
    messageDiv.innerHTML = `
        <div class="message-content">
            <i class="${icon} message-icon"></i>
            <div class="message-text">${formattedMessage}</div>
        </div>
    `;
    
    chatMessages.appendChild(messageDiv);
    
    // Scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function showTypingIndicator(): void {
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return;

    const typingDiv = document.createElement('div');
    typingDiv.className = 'chat-message assistant-message';
    typingDiv.id = 'typingIndicator';
    
    typingDiv.innerHTML = `
        <div class="message-content">
            <i class="fas fa-robot message-icon"></i>
            <div class="typing-indicator">
                <span>AI is thinking</span>
                <div class="typing-dots">
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                </div>
            </div>
        </div>
    `;
    
    chatMessages.appendChild(typingDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function hideTypingIndicator(): void {
    const typingIndicator = document.getElementById('typingIndicator');
    if (typingIndicator) {
        typingIndicator.remove();
    }
}

function clearChatInput(): void {
    const chatInput = document.getElementById('chatInput') as HTMLTextAreaElement;
    if (chatInput) {
        chatInput.value = '';
        chatInput.style.height = 'auto';
    }
}

function toggleChatSidebar(): void {
    const sidebar = document.getElementById('chatSidebar');
    const layoutContainer = document.querySelector('.layout-container');
    
    if (sidebar && layoutContainer) {
        const isOpening = !sidebar.classList.contains('open');
        sidebar.classList.toggle('open');
        layoutContainer.classList.toggle('chat-open');
        
        if (isOpening) {
            // Load chat history when opening sidebar
            if (typeof typedWindow.loadChatHistory === 'function') {
                typedWindow.loadChatHistory();
            }
            
            // Call updateDataCounts from window object
            if (typeof typedWindow.updateDataCounts === 'function') {
                typedWindow.updateDataCounts();
            }
            
            // Focus chat input
            setTimeout(() => {
                const chatInput = document.getElementById('chatInput') as HTMLTextAreaElement;
                if (chatInput) chatInput.focus();
            }, 100);
        }
    }
}

// Export all functions to global scope for access from index.ts
typedWindow.DOM = {
    formatCategoryName,
    displayScreenshots,
    loadMoreScreenshots,
    updateCategoryStats,
    updateMonthlyAnalyticsDisplay,
    toggleSettings,
    toggleExportModal,
    toggleChatSidebar,
    showMinimizeModal,
    closeMinimizeModal,
    handleModalClick,
    updateApiKeyUI,
    showValidationMessage,
    formatDate,
    isToday,
    isCurrentMonth,
    updateNextMonthButtonState,
    displayNotes,
    updateDailyProgressChart: renderDailyProgressChart,
    updateYearlyProgressChart: renderYearlyProgressChart,
    addChatMessage,
    showTypingIndicator,
    hideTypingIndicator,
    clearChatInput
}; 