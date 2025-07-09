const { ipcMain, dialog } = require('electron');
const fs = require('fs');
const axios = require('axios');

/**
 * Initialize all IPC handlers for the application
 * @param {Object} dependencies - Object containing all required dependencies
 */
function initializeIpcHandlers(dependencies) {
    const {
        database,
        store,
        logger,
        mainWindow,
        autoLauncher,
        initializeGeminiAPI,
        pauseTracking,
        captureAndAnalyze,
        getCurrentDate,
        setCurrentDate,
        getIsTracking,
        setIsTracking,
        setIsQuitting,
        sleep,
        startTracking,
        stopTracking,
        updateSchedulerInterval,
        getSchedulerStatus,
        getLastAnalysisError,
        clearAnalysisError
    } = dependencies;

    // API-related handlers
    ipcMain.handle('initialize-api', async (event, apiKey) => {
        try {
            const result = await initializeGeminiAPI(apiKey);
            return result;
        } catch (error) {
            console.error('Error initializing API:', error);
            return { 
                success: false, 
                error: error.message || 'Failed to initialize API'
            };
        }
    });

    ipcMain.handle('get-api-key', () => {
        return store.get('apiKey');
    });

    ipcMain.handle('check-api-key', () => {
        const apiKey = store.get('apiKey');
        if (apiKey) {
            initializeGeminiAPI(apiKey);
            return true;
        }
        pauseTracking();
        return false;
    });

    ipcMain.handle('delete-api-key', () => {
        try {
            store.delete('apiKey');
            pauseTracking();
            return true;
        } catch (error) {
            console.error('Error deleting API key:', error);
            return false;
        }
    });

    // Stats and data handlers
    ipcMain.handle('get-stats', async () => {
        try {
            const data = await database.getActivityStats(getCurrentDate(), store.get('interval'));
            return {
                stats: {
                    stats: data.stats,
                    timeInHours: data.timeInHours
                },
                screenshots: data.screenshots
            };
        } catch (error) {
            console.error('Error getting stats:', error);
            return {
                stats: {
                    stats: {},
                    timeInHours: {}
                },
                screenshots: []
            };
        }
    });

    ipcMain.handle('request-refresh', async () => {
        try {
            const data = await database.getActivityStats(getCurrentDate(), store.get('interval'));
            return {
                stats: {
                    stats: data.stats,
                    timeInHours: data.timeInHours
                },
                screenshots: data.screenshots
            };
        } catch (error) {
            console.error('Error in manual refresh:', error);
            return {
                stats: {
                    stats: {},
                    timeInHours: {}
                },
                screenshots: []
            };
        }
    });

    ipcMain.handle('update-current-date', async (event, newDateString) => {
        setCurrentDate(new Date(newDateString));
        const data = await database.getActivityStats(getCurrentDate(), store.get('interval'));
        return {
            stats: data.stats,
            timeInHours: data.timeInHours,
            screenshots: data.screenshots
        };
    });

    // Tracking handlers
    ipcMain.handle('toggle-tracking', async (event, shouldTrack) => {
        const apiKey = store.get('apiKey');
        if (!apiKey) {
            pauseTracking();
            return false;
        }
        
        if (shouldTrack) {
            return startTracking();
        } else {
            stopTracking();
            return false;
        }
    });

    ipcMain.handle('test-screenshot', async () => {
        try {
            console.log('Starting test screenshot process...');
            // Send countdown updates to renderer
            for (let i = 3; i > 0; i--) {
                console.log(`Countdown: ${i}`);
                mainWindow.webContents.send('countdown-update', i);
                await sleep(1000);
            }
            
            console.log('Initiating capture and analyze...');
            await captureAndAnalyze();
            return true;
        } catch (error) {
            console.error('Error in test-screenshot handler:', error);
            return false;
        }
    });

    // Settings handlers
    ipcMain.handle('update-interval', async (event, interval) => {
        store.set('interval', interval);
        updateSchedulerInterval(interval);
        return true;
    });

    ipcMain.handle('get-interval', () => {
        return store.get('interval');
    });

    ipcMain.handle('get-scheduler-status', () => {
        return getSchedulerStatus();
    });

    // Auto-launch handlers
    ipcMain.handle('get-auto-launch', async () => {
        try {
            const isEnabled = await autoLauncher.isEnabled();
            return isEnabled;
        } catch (error) {
            console.error('Error checking auto-launch status:', error);
            return true;
        }
    });

    ipcMain.handle('toggle-auto-launch', async (event, enable) => {
        try {
            if (enable) {
                await autoLauncher.enable();
            } else {
                await autoLauncher.disable();
            }
            return true;
        } catch (error) {
            console.error('Error toggling auto-launch:', error);
            return false;
        }
    });

    // Window control handlers
    ipcMain.on('window-minimize', () => {
        if (mainWindow) mainWindow.minimize();
    });

    ipcMain.on('window-close', () => {
        if (mainWindow) mainWindow.hide();
    });

    ipcMain.handle('quit-app', () => {
        setIsQuitting(true);
        require('electron').app.quit();
    });

    // Screenshot management handlers
    ipcMain.handle('delete-screenshot', async (event, id) => {
        try {
            const success = await database.deleteScreenshot(id);
            return success;
        } catch (error) {
            console.error('Error deleting screenshot:', error);
            return false;
        }
    });

    ipcMain.handle('load-more-screenshots', async (event, offset = 0, limit = 50) => {
        try {
            const screenshots = await database.getMoreScreenshots(getCurrentDate(), offset, limit);
            return { success: true, screenshots };
        } catch (error) {
            console.error('Error loading more screenshots:', error);
            return { success: false, screenshots: [] };
        }
    });

    // Monthly data handlers
    ipcMain.handle('get-monthly-averages', async () => {
        try {
            const data = await database.getMonthlyAverages(getCurrentDate(), store.get('interval'));
            return {
                monthlyAverages: data.monthlyAverages,
                monthlyTimeInHours: data.monthlyTimeInHours,
                daysWithData: data.daysWithData
            };
        } catch (error) {
            console.error('Error getting monthly averages:', error);
            return {
                monthlyAverages: {},
                monthlyTimeInHours: {},
                daysWithData: 0
            };
        }
    });

    ipcMain.handle('update-current-month', async (event, year, month) => {
        try {
            const currentDate = getCurrentDate();
            const newDate = new Date(currentDate);
            newDate.setFullYear(year);
            newDate.setMonth(month);
            
            setCurrentDate(newDate);
            
            const data = await database.getMonthlyAverages(getCurrentDate(), store.get('interval'));
            return {
                monthlyAverages: data.monthlyAverages,
                monthlyTimeInHours: data.monthlyTimeInHours,
                daysWithData: data.daysWithData
            };
        } catch (error) {
            console.error('Error updating month:', error);
            return {
                monthlyAverages: {},
                monthlyTimeInHours: {},
                daysWithData: 0
            };
        }
    });

    // Logging handlers
    ipcMain.handle('open-logs', () => {
        const logPath = logger.getLogPath();
        if (fs.existsSync(logPath)) {
            require('electron').shell.openPath(logPath);
            return true;
        }
        return false;
    });

    ipcMain.handle('get-recent-logs', async () => {
        try {
            return await logger.getRecentLogs();
        } catch (error) {
            console.error('Error reading logs:', error);
            return [];
        }
    });

    // Export data handler
    ipcMain.handle('export-data', async (event, options) => {
        try {
            console.log('Starting data export with options:', options);
            
            const { startDate, endDate, rangeType } = options;
            
            const result = await dialog.showSaveDialog(mainWindow, {
                title: 'Export What Did I Do Data',
                defaultPath: `what-did-i-do-export-${rangeType}-${new Date().toISOString().split('T')[0]}.json`,
                filters: [
                    { name: 'JSON Files', extensions: ['json'] },
                    { name: 'All Files', extensions: ['*'] }
                ]
            });

            if (result.canceled) {
                return { success: false, error: 'Export canceled by user' };
            }

            const exportPath = result.filePath;
            
            const exportData = await database.exportData(
                startDate, 
                endDate, 
                false,
                true
            );

            console.log(`Exporting ${exportData.screenshots.length} screenshots`);

            const exportJson = {
                metadata: {
                    exportDate: new Date().toISOString(),
                    dateRange: {
                        startDate,
                        endDate
                    },
                    rangeType,
                    screenshotCount: exportData.screenshots.length,
                    categories: database.categories,
                    version: "1.0"
                },
                screenshots: exportData.screenshots.map(screenshot => ({
                    id: screenshot.id,
                    timestamp: screenshot.timestamp,
                    category: screenshot.category,
                    activity: screenshot.activity,
                    description: screenshot.description
                })),
                statistics: exportData.statistics || {}
            };

            fs.writeFileSync(exportPath, JSON.stringify(exportJson, null, 2), 'utf8');
            
            console.log(`Export completed: ${exportPath}`);
            
            return { 
                success: true, 
                filePath: exportPath,
                screenshotCount: exportData.screenshots.length
            };

        } catch (error) {
            console.error('Export error:', error);
            return { success: false, error: error.message };
        }
    });

    // Error tracking handlers
    ipcMain.handle('get-analysis-error', () => {
        return getLastAnalysisError();
    });

    ipcMain.handle('clear-analysis-error', () => {
        clearAnalysisError();
        return true;
    });

    // Gemini model handlers
    ipcMain.handle('get-gemini-model', () => {
        return store.get('geminiModel') || 'gemini-2.0-flash';
    });

    ipcMain.handle('set-gemini-model', (event, model) => {
        try {
            const trimmedModel = model.trim();
            if (!trimmedModel) {
                return { success: false, error: 'Model name cannot be empty' };
            }
            store.set('geminiModel', trimmedModel);
            return { success: true };
        } catch (error) {
            console.error('Error setting Gemini model:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('test-gemini-model', async (event, model) => {
        try {
            const apiKey = store.get('apiKey');
            if (!apiKey) {
                return { success: false, error: 'No API key configured' };
            }

            // Test the model with a simple request
            const ai = new (require('@google/genai').GoogleGenAI)({apiKey: apiKey});
            
            const result = await ai.models.generateContent({
                model: model.trim(),
                contents: 'Hello, this is a test message to validate the model.'
            });

            if (result && result.text) {
                return { success: true, response: result.text };
            } else {
                return { success: false, error: 'Invalid response from model' };
            }
        } catch (error) {
            console.error('Error testing Gemini model:', error);
            return { 
                success: false, 
                error: error.message || 'Failed to test model'
            };
        }
    });

    ipcMain.handle('fetch-available-models', async () => {
        try {
            const apiKey = store.get('apiKey');
            if (!apiKey) {
                return { success: false, error: 'No API key configured' };
            }

            const response = await axios.get('https://generativelanguage.googleapis.com/v1beta/models', {
                params: {
                    key: apiKey
                }
            });

            if (response.data && response.data.models) {
                const models = response.data.models
                    .filter(model => model.name.includes('gemini'))
                    .map(model => ({
                        name: model.name.replace('models/', ''),
                        displayName: model.displayName || model.name.replace('models/', ''),
                        description: model.description || ''
                    }));

                return { success: true, models };
            } else {
                return { success: false, error: 'No models found' };
            }
        } catch (error) {
            console.error('Error fetching models:', error);
            return { 
                success: false, 
                error: error.message || 'Failed to fetch models'
            };
        }
    });

    // Diary log handlers
    ipcMain.handle('save-diary-log', async (event, date, title, content, mood, tags) => {
        try {
            const tagsString = Array.isArray(tags) ? tags.join(',') : tags || '';
            const logId = await database.saveDiaryLog(date, title, content, mood, tagsString);
            return { success: true, id: logId };
        } catch (error) {
            console.error('Error saving diary log:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('get-diary-logs-for-date', async (event, date) => {
        try {
            const logs = await database.getDiaryLogsForDate(date);
            return { success: true, logs };
        } catch (error) {
            console.error('Error getting diary logs for date:', error);
            return { success: false, logs: [] };
        }
    });

    ipcMain.handle('update-diary-log', async (event, id, title, content, mood, tags) => {
        try {
            const tagsString = Array.isArray(tags) ? tags.join(',') : tags || '';
            const success = await database.updateDiaryLog(id, title, content, mood, tagsString);
            return { success };
        } catch (error) {
            console.error('Error updating diary log:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('delete-diary-log', async (event, id) => {
        try {
            const success = await database.deleteDiaryLog(id);
            return { success };
        } catch (error) {
            console.error('Error deleting diary log:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('get-diary-logs-in-range', async (event, startDate, endDate) => {
        try {
            const logs = await database.getDiaryLogsInRange(startDate, endDate);
            return { success: true, logs };
        } catch (error) {
            console.error('Error getting diary logs in range:', error);
            return { success: false, logs: [] };
        }
    });
}

module.exports = {
    initializeIpcHandlers
}; 