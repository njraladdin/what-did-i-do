import { ipcMain, IpcMainInvokeEvent, dialog, app, shell } from 'electron';
import * as fs from 'fs';
import axios from 'axios';
import { categories } from './db/core';
import { GoogleGenAI } from '@google/genai';

interface Dependencies {
    database: any; // TODO: Add proper database type
    store: {
        get: (key: string) => any;
        set: (key: string, value: any) => void;
        delete: (key: string) => void;
    };
    logger: {
        info: (message: string, ...args: any[]) => void;
        error: (message: string, ...args: any[]) => void;
        getLogPath: () => string;
        getRecentLogs: () => Promise<string[]>;
    };
    mainWindow: Electron.BrowserWindow;
    autoLauncher: {
        enable: () => Promise<void>;
        disable: () => Promise<void>;
        isEnabled: () => Promise<boolean>;
    };
    initializeGeminiAPI: (apiKey: string) => Promise<any>;
    pauseTracking: () => void;
    captureAndAnalyze: () => Promise<void>;
    getCurrentDate: () => Date;
    setCurrentDate: (date: Date) => void;
    getIsTracking: () => boolean;
    setIsTracking: (value: boolean) => void;
    setIsQuitting: (value: boolean) => void;
    sleep: (ms: number) => Promise<void>;
    startTracking: () => boolean;
    stopTracking: () => void;
    updateSchedulerInterval: (interval: number) => void;
    getSchedulerStatus: () => boolean;
    getLastAnalysisError: () => string | null;
    clearAnalysisError: () => void;
    generateDayAnalysis: (date: string) => Promise<any>;
}

interface ExportOptions {
    startDate: string;
    endDate: string;
    rangeType: string;
}

interface Screenshot {
    id: string;
    timestamp: string;
    category: string;
    activity: string;
    description: string;
}

const SCREENSHOT_INTERVAL_MINUTES = 5; // Default interval

/**
 * Initialize all IPC handlers for the application
 * @param {Object} dependencies - Object containing all required dependencies
 */
function initializeIpcHandlers(dependencies: Dependencies) {
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
        clearAnalysisError,
        generateDayAnalysis // Get the function from dependencies
    } = dependencies;

    // API-related handlers
    ipcMain.handle('initialize-api', async (event: IpcMainInvokeEvent, apiKey: string) => {
        try {
            const result = await initializeGeminiAPI(apiKey);
            return result;
        } catch (error) {
            console.error('Error initializing API:', error);
            return { 
                success: false, 
                error: (error as Error).message || 'Failed to initialize API'
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
            const data = await database.stats.getActivityStats(getCurrentDate(), store.get('interval'));
            return {
                stats: {
                    stats: data.stats,
                    timeInHours: data.timeInHours
                },
                screenshots: data.screenshots,
                notes: data.notes,
                dayAnalysis: data.dayAnalysis
            };
        } catch (error) {
            console.error('Error getting stats:', error);
            return {
                stats: {
                    stats: {},
                    timeInHours: {}
                },
                screenshots: [],
                notes: [],
                dayAnalysis: null
            };
        }
    });

    ipcMain.handle('request-refresh', async () => {
        try {
            const data = await database.stats.getActivityStats(getCurrentDate(), store.get('interval'));
            return {
                stats: {
                    stats: data.stats,
                    timeInHours: data.timeInHours
                },
                screenshots: data.screenshots,
                notes: data.notes,
                dayAnalysis: data.dayAnalysis
            };
        } catch (error) {
            console.error('Error in manual refresh:', error);
            return {
                stats: {
                    stats: {},
                    timeInHours: {}
                },
                screenshots: [],
                notes: [],
                dayAnalysis: null
            };
        }
    });

    ipcMain.handle('update-current-date', async (event: IpcMainInvokeEvent, newDateString: string) => {
        setCurrentDate(new Date(newDateString));
        const data = await database.stats.getActivityStats(getCurrentDate(), store.get('interval'));
        return {
            stats: data.stats,
            timeInHours: data.timeInHours,
            screenshots: data.screenshots,
            notes: data.notes,
            dayAnalysis: data.dayAnalysis
        };
    });

    // Tracking handlers
    ipcMain.handle('toggle-tracking', async (event: IpcMainInvokeEvent, shouldTrack: boolean) => {
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
    ipcMain.handle('update-interval', async (event: IpcMainInvokeEvent, interval: number) => {
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

    ipcMain.handle('toggle-auto-launch', async (event: IpcMainInvokeEvent, enable: boolean) => {
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
    ipcMain.handle('delete-screenshot', async (event: IpcMainInvokeEvent, id: string) => {
        try {
            const success = await database.screenshots.deleteScreenshot(parseInt(id));
            return success;
        } catch (error) {
            console.error('Error deleting screenshot:', error);
            return false;
        }
    });

    // Get activity data for a specific date
    ipcMain.handle('get-activity-data', async (event: IpcMainInvokeEvent, date: string) => {
        try {
            const data = await database.stats.getActivityStats(new Date(date), SCREENSHOT_INTERVAL_MINUTES);
            return {
                success: true,
                stats: data.stats,
                timeInHours: data.timeInHours,
                screenshots: data.screenshots,
                notes: data.notes,
                dayAnalysis: data.dayAnalysis
            };
        } catch (error) {
            console.error('Error getting activity data:', error);
            return {
                success: false,
                stats: {},
                timeInHours: {},
                screenshots: [],
                notes: [],
                dayAnalysis: null
            };
        }
    });

    // Load more screenshots for a date
    ipcMain.handle('load-more-screenshots', async (event: IpcMainInvokeEvent, date: string, offset: number) => {
        try {
            const data = await database.screenshots.getMoreScreenshots(new Date(date), offset);
            return {
                success: true,
                screenshots: data,
                notes: []
            };
        } catch (error) {
            console.error('Error loading more screenshots:', error);
            return {
                success: false,
                screenshots: [],
                notes: []
            };
        }
    });

    // Note handlers
    ipcMain.handle('save-note', async (event: IpcMainInvokeEvent, date: string, content: string) => {
        try {
            const noteId = await database.notes.saveNote(new Date(date), content);
            return { success: true, id: noteId };
        } catch (error) {
            console.error('Error saving note:', error);
            return { success: false, error: getErrorMessage(error) };
        }
    });

    ipcMain.handle('get-notes-for-date', async (event: IpcMainInvokeEvent, date: string) => {
        try {
            const notes = await database.notes.getNotesForDate(new Date(date));
            return { success: true, notes: notes };
        } catch (error) {
            console.error('Error getting notes:', error);
            return { success: false, notes: [], error: getErrorMessage(error) };
        }
    });

    ipcMain.handle('update-note', async (event: IpcMainInvokeEvent, id: string, content: string) => {
        try {
            const success = await database.notes.updateNote(parseInt(id), content);
            return { success };
        } catch (error) {
            console.error('Error updating note:', error);
            return { success: false, error: getErrorMessage(error) };
        }
    });

    ipcMain.handle('delete-note', async (event: IpcMainInvokeEvent, id: string) => {
        try {
            const success = await database.notes.deleteNote(parseInt(id));
            return { success };
        } catch (error) {
            console.error('Error deleting note:', error);
            return { success: false, error: getErrorMessage(error) };
        }
    });

    ipcMain.handle('get-notes-range', async (event: IpcMainInvokeEvent, startDate: string, endDate: string) => {
        try {
            const notes = await database.notes.getNotesInRange(new Date(startDate), new Date(endDate));
            return { success: true, notes: notes };
        } catch (error: unknown) {
            console.error('Error getting notes in range:', error);
            return { success: false, notes: [], error: getErrorMessage(error) };
        }
    });

    // Monthly data handlers
    ipcMain.handle('get-monthly-averages', async () => {
        try {
            const data = await database.stats.getMonthlyAverages(getCurrentDate(), store.get('interval'));
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

    ipcMain.handle('update-current-month', async (event: IpcMainInvokeEvent, year: number, month: number) => {
        try {
            const currentDate = getCurrentDate();
            const newDate = new Date(currentDate);
            newDate.setFullYear(year);
            newDate.setMonth(month);
            
            setCurrentDate(newDate);
            
            const data = await database.stats.getMonthlyAverages(getCurrentDate(), store.get('interval'));
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

    // Get daily category stats for chart
    ipcMain.handle('get-daily-category-stats', async () => {
        try {
            const data = await database.stats.getDailyCategoryStats(getCurrentDate(), store.get('interval'));
            return {
                success: true,
                dailyStats: data
            };
        } catch (error) {
            console.error('Error getting daily category stats:', error);
            return {
                success: false,
                error: getErrorMessage(error),
                dailyStats: {}
            };
        }
    });

    // Yearly monthly stats handler
    ipcMain.handle('get-yearly-monthly-category-stats', async (event: IpcMainInvokeEvent, year: number) => {
        try {
            const interval = store.get('interval') || 5;
            const data = await database.stats.getYearlyMonthlyCategoryStats(year, interval);
            return { success: true, data };
        } catch (error) {
            console.error('Error getting yearly monthly category stats:', error);
            return { success: false, error: getErrorMessage(error) };
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
    ipcMain.handle('export-data', async (event: IpcMainInvokeEvent, options: ExportOptions) => {
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
                new Date(startDate), 
                new Date(endDate), 
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
                    categories: categories,
                    version: "1.0"
                },
                screenshots: exportData.screenshots.map((screenshot: Screenshot) => ({
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
            return { success: false, error: (error as Error).message };
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

    ipcMain.handle('set-gemini-model', (event: IpcMainInvokeEvent, model: string) => {
        try {
            const trimmedModel = model.trim();
            if (!trimmedModel) {
                return { success: false, error: 'Model name cannot be empty' };
            }
            store.set('geminiModel', trimmedModel);
            return { success: true };
        } catch (error) {
            console.error('Error setting Gemini model:', error);
            return { success: false, error: getErrorMessage(error) };
        }
    });

    ipcMain.handle('test-gemini-model', async (event: IpcMainInvokeEvent, model: string) => {
        try {
            const apiKey = store.get('apiKey');
            if (!apiKey) {
                return { success: false, error: 'No API key configured' };
            }

            // Test the model with a simple request
            const ai = new GoogleGenAI({apiKey: apiKey});
            
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
                error: getErrorMessage(error) || 'Failed to test model'
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
                    .filter((model: { name: string }) => model.name.includes('gemini'))
                    .map((model: { name: string; displayName?: string; description?: string }) => ({
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
                error: getErrorMessage(error) || 'Failed to fetch models'
            };
        }
    });

    // Update day analysis handlers
    ipcMain.handle('generate-day-analysis', async (event: IpcMainInvokeEvent, date: string) => {
        logger.info('Received generate-day-analysis request for date:', date);
        try {
            const analysis = await generateDayAnalysis(date);
            logger.info('Day analysis generated successfully');
            return analysis;
        } catch (error) {
            logger.error('Error generating day analysis:', error);
            throw error;
        }
    });

    ipcMain.handle('get-day-analysis', async (event: IpcMainInvokeEvent, date: string) => {
        logger.info('Received get-day-analysis request for date:', date);
        try {
            const analysis = await database.dayAnalyses.getDayAnalysis(new Date(date));
            logger.info('Retrieved day analysis:', analysis ? 'found' : 'not found');
            return analysis;
        } catch (error) {
            logger.error('Error getting day analysis:', error);
            throw error;
        }
    });

    // Chat handlers
    ipcMain.handle('send-chat-message', async (event: IpcMainInvokeEvent, message: string) => {
        try {
            const apiKey = store.get('apiKey');
            if (!apiKey) {
                throw new Error('API key not configured');
            }

            // Initialize Gemini if not already done
            const genAI = new GoogleGenAI({apiKey});
            
            // Get past month's screenshot metadata for context
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            
            const screenshots = await database.screenshots.getScreenshotsForExport(
                thirtyDaysAgo,
                new Date(),
                false // Don't include image data
            );

            // Create system prompt with screenshot metadata
            const systemPrompt = `You are an AI analyst assistant for a productivity tracking application called "What Did I Do". 

You have access to the user's activity data from the past 30 days, including screenshots that have been automatically categorized and analyzed. Use this data to provide insights about their productivity patterns, habits, and behaviors.

Here's the user's activity data from the past 30 days:
${JSON.stringify(screenshots.map((s: any) => ({
    timestamp: s.timestamp,
    category: s.category,
    activity: s.activity,
    description: s.description
})), null, 2)}

The categories are:
- WORK: Professional tasks, coding, documents, etc.
- LEARN: Educational content, tutorials, courses, etc.
- SOCIAL: Communication, meetings, emails, messaging
- ENTERTAINMENT: Games, videos, casual browsing, social media
- OTHER: Everything else (shopping, personal tasks, etc.)

When responding:
1. Be helpful and insightful about their productivity patterns
2. Provide actionable advice when appropriate
3. Reference specific data points from their activity history when relevant
4. Keep responses conversational and friendly
5. If asked about specific time periods or activities, use the timestamp data to provide accurate information

User's message: ${message}`;

            const result = await genAI.models.generateContent({
                model: store.get('geminiModel') || 'gemini-2.0-flash',
                contents: systemPrompt,
                config: {
                    temperature: 0.7,
                    maxOutputTokens: 2048,
                }
            });

            if (!result || !result.text) {
                throw new Error('No response from AI');
            }

            return {
                success: true,
                response: result.text
            };

        } catch (error) {
            console.error('Error in chat:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error occurred'
            };
        }
    });
}

// Add error type interface
interface ErrorWithMessage {
    message: string;
}

function isErrorWithMessage(error: unknown): error is ErrorWithMessage {
    return (
        typeof error === 'object' &&
        error !== null &&
        'message' in error &&
        typeof (error as Record<string, unknown>).message === 'string'
    );
}

function getErrorMessage(error: unknown): string {
    if (isErrorWithMessage(error)) {
        return error.message;
    }
    return String(error);
}

export { initializeIpcHandlers }; 