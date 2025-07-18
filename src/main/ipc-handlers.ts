import { ipcMain, IpcMainInvokeEvent, dialog, app, shell } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import axios from 'axios';
import { categories } from './db/core';
import { GoogleGenAI } from '@google/genai';

// Add conversation history storage
// Store conversation history using a Map with window ID as key
const chatHistory = new Map<number, Array<{role: 'user' | 'assistant', content: string}>>();

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
            const result = await database.stats.getYearlyMonthlyCategoryStats(year, interval);
            return { success: true, ...result };
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

    ipcMain.handle('get-chat-gemini-model', () => {
        return store.get('chatGeminiModel') || 'gemini-2.0-flash';
    });

    ipcMain.handle('set-chat-gemini-model', (event: IpcMainInvokeEvent, model: string) => {
        try {
            const trimmedModel = model.trim();
            if (!trimmedModel) {
                return { success: false, error: 'Model name cannot be empty' };
            }
            store.set('chatGeminiModel', trimmedModel);
            return { success: true };
        } catch (error) {
            console.error('Error setting Chat Gemini model:', error);
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

    // Add these new handlers for chat history
    ipcMain.handle('clear-chat-history', (event: IpcMainInvokeEvent) => {
        const windowId = event.sender.id;
        chatHistory.delete(windowId);
        return true;
    });

    // Get chat history for UI display
    ipcMain.handle('get-chat-history', (event: IpcMainInvokeEvent) => {
        const windowId = event.sender.id;
        return chatHistory.get(windowId) || [];
    });

    // Modify the send-chat-message handler to include conversation history
    ipcMain.handle('send-chat-message', async (event: IpcMainInvokeEvent, message: string, dataOptions: { 
        includeDescriptions: boolean, 
        includeLogs: boolean, 
        includeStats: boolean,
        includeNotes: boolean,
        includeAnalyses: boolean,
        includeTags: boolean,
        // Year data options
        includeYearScreenshots: boolean,
        includeYearLogs: boolean,
        includeYearStats: boolean,
        includeYearNotes: boolean,
        includeYearAnalyses: boolean,
        includeYearTags: boolean
    } = { 
        includeDescriptions: true, 
        includeLogs: true, 
        includeStats: true,
        includeNotes: true,
        includeAnalyses: true,
        includeTags: true,
        // Year data options default to false
        includeYearScreenshots: false,
        includeYearLogs: false,
        includeYearStats: false,
        includeYearNotes: false,
        includeYearAnalyses: false,
        includeYearTags: false
    }) => {
        try {
            const apiKey = store.get('apiKey');
            if (!apiKey) {
                throw new Error('API key not configured');
            }

            // Get window ID to track conversation per window
            const windowId = event.sender.id;
            
            // Initialize history for this window if it doesn't exist
            if (!chatHistory.has(windowId)) {
                chatHistory.set(windowId, []);
            }
            
            // Get current history
            const history = chatHistory.get(windowId) || [];

            // Add user message to history
            history.push({ role: 'user', content: message });
            
            // Initialize Gemini if not already done
            const genAI = new GoogleGenAI({apiKey});
            
            // Get current month's date range
            const now = new Date();
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
            
            // Get current year's date range
            const startOfYear = new Date(now.getFullYear(), 0, 1);
            const endOfYear = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
            
            // Build system prompt with optional data sections
            let systemPrompt = `You are an AI analyst assistant for a productivity tracking application called "What Did I Do". 

You help users understand their productivity patterns, habits, and behaviors based on the data you have access to.

The categories used in the app are:
- WORK: Professional tasks, coding, documents, etc.
- LEARN: Educational content, tutorials, courses, etc.
- SOCIAL: Communication, meetings, emails, messaging
- ENTERTAINMENT: Games, videos, casual browsing, social media
- OTHER: Everything else (shopping, personal tasks, etc.)

`;

            // CURRENT MONTH DATA SECTIONS
            systemPrompt += "\n## CURRENT MONTH DATA ##\n";

            // New logic: Fetch all data for the month and group by day
            if (dataOptions.includeLogs || dataOptions.includeDescriptions || dataOptions.includeTags || dataOptions.includeNotes || dataOptions.includeAnalyses) {
                systemPrompt += `\nHere is the user's detailed data from the current month:\n`;
 
                // A map to hold all data grouped by date string (YYYY-MM-DD)
                const dailyData = new Map<string, { activities: any[], notes: any[], analysis: any }>();

                // Fetch all data types in parallel
                const promises = [
                    (dataOptions.includeLogs || dataOptions.includeDescriptions || dataOptions.includeTags)
                        ? database.screenshots.getScreenshotsForExport(startOfMonth, endOfMonth, false)
                        : Promise.resolve([]),
                    dataOptions.includeNotes
                        ? database.notes.getNotesInRange(startOfMonth, endOfMonth)
                        : Promise.resolve([]),
                    dataOptions.includeAnalyses
                        ? database.dayAnalyses.getAnalysesInRange(startOfMonth, endOfMonth)
                        : Promise.resolve([])
                ];

                try {
                    const [screenshots, notes, analyses] = await Promise.all(promises);

                    // Helper to ensure a date entry exists in the map
                    const ensureDateEntry = (date: string) => {
                        if (!dailyData.has(date)) {
                            dailyData.set(date, { activities: [], notes: [], analysis: null });
                        }
                    };

                    // Process and group screenshots
                    for (const s of screenshots) {
                        const timestamp = new Date(s.timestamp);
                        const date = timestamp.toISOString().split('T')[0];
                        ensureDateEntry(date);

                        const entry: any = {
                            time: timestamp.toLocaleTimeString('en-US', { hour12: false }),
                            category: s.category,
                            activity: s.activity,
                        };
                        if (dataOptions.includeDescriptions && s.description && s.description.trim()) {
                            entry.description = s.description;
                        }
                        if (dataOptions.includeTags && s.tags) {
                            try { entry.tags = JSON.parse(s.tags); } catch { }
                        }
                        dailyData.get(date)!.activities.push(entry);
                    }

                    // Process and group notes
                    for (const n of notes) {
                        const timestamp = new Date(n.timestamp);
                        const date = timestamp.toISOString().split('T')[0];
                        ensureDateEntry(date);
                        dailyData.get(date)!.notes.push({
                            time: timestamp.toLocaleTimeString('en-US', { hour12: false }),
                            content: n.content
                        });
                    }

                    // Process and group analyses
                    for (const a of analyses) {
                        const date = new Date(a.date).toISOString().split('T')[0];
                        ensureDateEntry(date);
                        dailyData.get(date)!.analysis = a.content;
                    }

                    // Now, build the prompt string from the grouped data
                    const sortedDates = Array.from(dailyData.keys()).sort();

                    if (sortedDates.length === 0) {
                        systemPrompt += "\nNote: No data found for the current month with the selected options.\n";
                    }

                    for (const date of sortedDates) {
                        const data = dailyData.get(date)!;
                        systemPrompt += `\nDate: ${date}\n`;

                        // ACTIVITIES
                        if (data.activities.length > 0) {
                            const shouldMergeActivities = dataOptions.includeLogs && !dataOptions.includeDescriptions && !dataOptions.includeTags;
                            if (shouldMergeActivities) {
                                const mergedEntries = [];
                                let currentMergedEntry = { ...data.activities[0] };
                                for (let i = 1; i < data.activities.length; i++) {
                                    const currentEntry = data.activities[i];
                                    if (currentEntry.category === currentMergedEntry.category) {
                                        currentMergedEntry.activity += `, ${currentEntry.activity}`;
                                    } else {
                                        mergedEntries.push(currentMergedEntry);
                                        currentMergedEntry = { ...currentEntry };
                                    }
                                }
                                mergedEntries.push(currentMergedEntry);
                                for (const entry of mergedEntries) {
                                    systemPrompt += `  - Activity @ ${entry.time}: [${entry.category}] ${entry.activity}\n`;
                                }
                            } else {
                                for (const entry of data.activities) {
                                    systemPrompt += `  - Activity @ ${entry.time}: [${entry.category}] ${entry.activity}\n`;
                                    if (entry.description) systemPrompt += `    Description: ${entry.description}\n`;
                                    if (entry.tags && entry.tags.length > 0) systemPrompt += `    Tags: ${entry.tags.join(', ')}\n`;
                                }
                            }
                        }

                        // NOTES
                        if (data.notes.length > 0) {
                            for (const note of data.notes) {
                                systemPrompt += `  - Note @ ${note.time}: ${note.content}\n`;
                            }
                        }

                        // DAY ANALYSIS
                        if (data.analysis) {
                            systemPrompt += `  - Day's Analysis: ${JSON.stringify(data.analysis)}\n`;
                        }
                    }
                } catch (error) {
                    console.error('Error processing monthly combined data:', error);
                    systemPrompt += "\nNote: Error processing monthly data.\n";
                }
            } else {
                systemPrompt += "\nNote: The user has chosen not to include any detailed current month data (logs, notes, analyses) in this conversation.\n";
            }

            // Add stats data if requested
            if (dataOptions.includeStats) {
                const dailyStats = await database.stats.getDailyCategoryStats(now, store.get('interval'));
                
                systemPrompt += `\nActivity Statistics for the current month:\n`;

                type DailyStatsData = {
                    percentages: Record<string, number>;
                    timeInHours: Record<string, number>;
                    totalScreenshots: number;
                };
                
                (Object.entries(dailyStats) as [string, DailyStatsData][])
                    .sort(([dateA], [dateB]) => new Date(dateA).getTime() - new Date(dateB).getTime())
                    .forEach(([date, data]) => {
                        const formattedDate = new Date(date).toLocaleDateString('en-US', {
                            weekday: 'short',
                            month: 'short',
                            day: 'numeric'
                        });

                        systemPrompt += `\n${formattedDate}:\n`;
                        
                        // Sort categories by percentage (descending)
                        const categories = Object.entries(data.percentages)
                            .filter(([category]) => category !== 'UNKNOWN' && data.percentages[category] > 0)
                            .sort(([, a], [, b]) => b - a);

                        categories.forEach(([category, percentage]) => {
                            const hours = data.timeInHours[category];
                            const roundedHours = Math.floor(hours);
                            const remainingMinutes = Math.round((hours - roundedHours) * 60);
                            
                            const timeStr = roundedHours > 0 
                                ? `${roundedHours}h ${remainingMinutes}m`
                                : `${remainingMinutes}m`;

                            systemPrompt += `  • ${category}: ${percentage.toFixed(1)}% (${timeStr})\n`;
                        });

                        systemPrompt += `  Total tracked: ${data.totalScreenshots} screenshots\n`;
                    });
            } else {
                systemPrompt += "\nNote: The user has chosen not to include current month daily statistics in this conversation.\n";
            }

            // CURRENT YEAR DATA SECTIONS
            systemPrompt += "\n\n## CURRENT YEAR DATA ##\n";
            
            // New logic: Fetch all data for the year and group by day
            if (dataOptions.includeYearLogs || dataOptions.includeYearScreenshots || dataOptions.includeYearTags || dataOptions.includeYearNotes || dataOptions.includeYearAnalyses) {
                systemPrompt += `\nHere is a summary of the user's detailed data from the current year:\n`;

                const dailyDataForYear = new Map<string, { activities: any[], notes: any[], analysis: any }>();

                const yearPromises = [
                    (dataOptions.includeYearLogs || dataOptions.includeYearScreenshots || dataOptions.includeYearTags)
                        ? database.screenshots.getScreenshotsForExport(startOfYear, endOfYear, false)
                        : Promise.resolve([]),
                    dataOptions.includeYearNotes
                        ? database.notes.getNotesInRange(startOfYear, endOfYear)
                        : Promise.resolve([]),
                    dataOptions.includeYearAnalyses
                        ? database.dayAnalyses.getAnalysesInRange(startOfYear, endOfYear)
                        : Promise.resolve([])
                ];

                try {
                    const [yearScreenshots, yearNotes, yearAnalyses] = await Promise.all(yearPromises);

                    const ensureDateEntry = (date: string) => {
                        if (!dailyDataForYear.has(date)) {
                            dailyDataForYear.set(date, { activities: [], notes: [], analysis: null });
                        }
                    };

                    // Process and group screenshots for the year
                    for (const s of yearScreenshots) {
                        const timestamp = new Date(s.timestamp);
                        const date = timestamp.toISOString().split('T')[0];
                        ensureDateEntry(date);

                        const entry: any = {
                            time: timestamp.toLocaleTimeString('en-US', { hour12: false }),
                            category: s.category,
                            activity: s.activity,
                        };
                        if (dataOptions.includeYearScreenshots && s.description && s.description.trim()) {
                            entry.description = s.description;
                        }
                        if (dataOptions.includeYearTags && s.tags) {
                            try { entry.tags = JSON.parse(s.tags); } catch { }
                        }
                        dailyDataForYear.get(date)!.activities.push(entry);
                    }

                    // Process and group notes for the year
                    for (const n of yearNotes) {
                        const timestamp = new Date(n.timestamp);
                        const date = timestamp.toISOString().split('T')[0];
                        ensureDateEntry(date);
                        dailyDataForYear.get(date)!.notes.push({
                            time: timestamp.toLocaleTimeString('en-US', { hour12: false }),
                            content: n.content
                        });
                    }

                    // Process and group analyses for the year
                    for (const a of yearAnalyses) {
                        const date = new Date(a.date).toISOString().split('T')[0];
                        ensureDateEntry(date);
                        dailyDataForYear.get(date)!.analysis = a.content;
                    }

                    const sortedYearDates = Array.from(dailyDataForYear.keys()).sort();

                    if (sortedYearDates.length === 0) {
                        systemPrompt += "\nNote: No data found for the current year with the selected options.\n";
                    }

                    for (const date of sortedYearDates) {
                        const data = dailyDataForYear.get(date)!;
                        systemPrompt += `\nDate: ${date}\n`;

                        if (data.activities.length > 0) {
                            const shouldMergeYearActivities = dataOptions.includeYearLogs && !dataOptions.includeYearScreenshots && !dataOptions.includeYearTags;
                            if (shouldMergeYearActivities) {
                                const mergedEntries = [];
                                let currentMergedEntry = { ...data.activities[0] };
                                for (let i = 1; i < data.activities.length; i++) {
                                    const currentEntry = data.activities[i];
                                    if (currentEntry.category === currentMergedEntry.category) {
                                        currentMergedEntry.activity += `, ${currentEntry.activity}`;
                                    } else {
                                        mergedEntries.push(currentMergedEntry);
                                        currentMergedEntry = { ...currentEntry };
                                    }
                                }
                                mergedEntries.push(currentMergedEntry);
                                for (const entry of mergedEntries) {
                                    systemPrompt += `  - Activity @ ${entry.time}: [${entry.category}] ${entry.activity}\n`;
                                }
                            } else {
                                for (const entry of data.activities) {
                                    systemPrompt += `  - Activity @ ${entry.time}: [${entry.category}] ${entry.activity}\n`;
                                    if (entry.description) systemPrompt += `    Description: ${entry.description}\n`;
                                    if (entry.tags && entry.tags.length > 0) systemPrompt += `    Tags: ${entry.tags.join(', ')}\n`;
                                }
                            }
                        }

                        if (data.notes.length > 0) {
                            for (const note of data.notes) {
                                systemPrompt += `  - Note @ ${note.time}: ${note.content}\n`;
                            }
                        }

                        if (data.analysis) {
                            systemPrompt += `  - Day's Analysis: ${JSON.stringify(data.analysis)}\n`;
                        }
                    }
                } catch (error) {
                    console.error('Error processing yearly combined data:', error);
                    systemPrompt += "\nNote: Error processing yearly data.\n";
                }
            } else {
                systemPrompt += "\nNote: The user has chosen not to include any detailed current year data in this conversation.\n";
            }

            // Add yearly stats data if requested
            if (dataOptions.includeYearStats) {
                try {
                    const [yearlyStats, yearDailyStats] = await Promise.all([
                        database.stats.getYearlyMonthlyCategoryStats(now.getFullYear(), store.get('interval')),
                        database.stats.getYearlyDailyCategoryStats(now.getFullYear(), store.get('interval'))
                    ]);
                    
                    systemPrompt += `\nActivity Statistics for the current year:\n`;

                    type YearlyStatsData = {
                        timeInHours: Record<string, number>;
                        monthlyAverages: Record<string, number>;
                        daysWithData: number;
                    };

                    type DailyStatsData = {
                        percentages: Record<string, number>;
                        timeInHours: Record<string, number>;
                        totalScreenshots: number;
                    };

                    // First, show yearly summary by months
                    systemPrompt += `\nYearly Summary by Month:\n`;
                    
                    (Object.entries(yearlyStats.data) as [string, YearlyStatsData][])
                        .sort(([dateA], [dateB]) => new Date(dateA).getTime() - new Date(dateB).getTime())
                        .forEach(([monthKey, data]) => {
                            const [year, month] = monthKey.split('-');
                            const date = new Date(parseInt(year), parseInt(month) - 1);
                            const formattedMonth = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

                            systemPrompt += `\n${formattedMonth}:\n`;
                            
                            const timeInHours = data.timeInHours || {};
                            
                            const totalHours = Object.entries(timeInHours)
                                .filter(([category, hours]) => 
                                    category !== 'UNKNOWN' && 
                                    typeof hours === 'number'
                                )
                                .reduce((sum, [, hours]) => sum + hours, 0);
                            
                            const categories = Object.entries(timeInHours)
                                .filter(([category, hours]) => 
                                    category !== 'UNKNOWN' && 
                                    typeof hours === 'number' && 
                                    hours > 0
                                )
                                .sort(([, a], [, b]) => b - a);

                            if (categories.length === 0) {
                                systemPrompt += `  No activity data recorded\n`;
                            } else {
                                categories.forEach(([category, hours]) => {
                                    const roundedHours = Math.floor(hours);
                                    const remainingMinutes = Math.round((hours - roundedHours) * 60);
                                    
                                    const timeStr = roundedHours > 0 
                                        ? `${roundedHours}h ${remainingMinutes}m`
                                        : `${remainingMinutes}m`;

                                    const percentage = totalHours > 0 ? (hours / totalHours) * 100 : 0;

                                    systemPrompt += `  • ${category}: ${percentage.toFixed(1)}% (${timeStr})\n`;
                                });
                            }

                            if (data.daysWithData) {
                                systemPrompt += `  Data from ${data.daysWithData} days\n`;
                            }
                        });

                    // Then, show detailed daily breakdown for the entire year
                    systemPrompt += `\n\nDaily Breakdown for Entire Year:\n`;

                    // Create a map to group days by month
                    const daysByMonth = new Map<string, Array<[string, DailyStatsData]>>();

                    // Group all days by month
                    (Object.entries(yearDailyStats) as [string, DailyStatsData][])
                        .sort(([dateA], [dateB]) => new Date(dateA).getTime() - new Date(dateB).getTime())
                        .forEach(([dateStr, dayData]) => {
                            const date = new Date(dateStr);
                            const monthKey = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
                            
                            if (!daysByMonth.has(monthKey)) {
                                daysByMonth.set(monthKey, []);
                            }
                            daysByMonth.get(monthKey)!.push([dateStr, dayData]);
                        });

                    // Output each month's daily data
                    for (const [monthKey, days] of daysByMonth) {
                        systemPrompt += `\n${monthKey}:\n`;
                        
                        days.forEach(([dateStr, dayData]) => {
                            const dayDate = new Date(dateStr);
                            const formattedDate = dayDate.toLocaleDateString('en-US', {
                                weekday: 'short',
                                month: 'short',
                                day: 'numeric'
                            });

                            systemPrompt += `  ${formattedDate}:\n`;
                            
                            // Sort categories by percentage (descending)
                            Object.entries(dayData.percentages)
                                .filter(([category]) => category !== 'UNKNOWN' && dayData.percentages[category] > 0)
                                .sort(([, a], [, b]) => b - a)
                                .forEach(([category, percentage]) => {
                                    const hours = dayData.timeInHours[category];
                                    const roundedHours = Math.floor(hours);
                                    const remainingMinutes = Math.round((hours - roundedHours) * 60);
                                    
                                    const timeStr = roundedHours > 0 
                                        ? `${roundedHours}h ${remainingMinutes}m`
                                        : `${remainingMinutes}m`;

                                    systemPrompt += `    • ${category}: ${percentage.toFixed(1)}% (${timeStr})\n`;
                                });

                            if (dayData.totalScreenshots) {
                                systemPrompt += `    Total tracked: ${dayData.totalScreenshots} screenshots\n`;
                            }
                        });
                    }

                } catch (error) {
                    logger.error('Error fetching yearly stats:', error);
                    systemPrompt += "\nNote: There was an error fetching yearly statistics data.\n";
                }
            } else {
                systemPrompt += "\nNote: The user has chosen not to include current year monthly statistics in this conversation.\n";
            }

            // The old separate data sections are removed

            systemPrompt += `\n\nWhen responding:
1. Be helpful and insightful about productivity patterns
2. Provide actionable advice when appropriate
3. Reference specific data points when relevant (if data is available)
4. Keep responses conversational and friendly
5. If asked about specific time periods or activities, use the timestamp data if available
6. Use year data for long-term trends and month data for recent patterns

Chat history:
`;

            // Add chat history to the prompt
            if (history.length > 1) {
                // Only include previous messages if there's history
                // Skip the current user message (last in array) as we'll add it separately
                for (let i = 0; i < history.length - 1; i++) {
                    const entry = history[i];
                    systemPrompt += `\n${entry.role === 'user' ? 'User' : 'Assistant'}: ${entry.content}`;
                }
            }
            
            // Add current user message
            systemPrompt += `\n\nUser: ${message}`;

            // For debugging: save the prompt to a temp file
            try {
                const tmpDir = os.tmpdir();
                const fileName = `gemini-prompt-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
                const filePath = path.join(tmpDir, fileName);
                fs.writeFileSync(filePath, systemPrompt, 'utf8');
                logger.info(`Saved Gemini prompt for debugging to: ${filePath}`);
            } catch (debugError) {
                logger.error('Failed to save Gemini prompt for debugging:', debugError);
            }

            const result = await genAI.models.generateContent({
                model: store.get('chatGeminiModel') || 'gemini-2.0-flash',
                contents: systemPrompt,
                config: {
                    temperature: 0.7,
                    maxOutputTokens: 2048,
                }
            });

            if (!result || !result.text) {
                throw new Error('No response from AI');
            }

            // Add assistant response to history
            history.push({ role: 'assistant', content: result.text });
            
            // Update history in map (limited to last 20 messages to prevent token overflow)
            if (history.length > 20) {
                history.splice(0, history.length - 20);
            }
            chatHistory.set(windowId, history);

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

    // Data Counts handler
    ipcMain.handle('get-data-counts', async () => {
        try {
            const now = new Date();
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
            const startOfYear = new Date(now.getFullYear(), 0, 1);
            const endOfYear = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
            
            // Run all count queries in parallel for maximum efficiency
            const [
                descriptionsCount,
                logsCount,
                statsCount,
                notesCount,
                analysesCount,
                yearDescriptionsCount,
                yearLogsCount,
                yearStatsCount,
                yearNotesCount,
                yearAnalysesCount,
                tagsCount,
                yearTagsCount
            ] = await Promise.all([
                // Monthly counts
                database.screenshots.countScreenshotsWithDescriptionInRange(startOfMonth, endOfMonth),
                database.screenshots.countScreenshotsInRange(startOfMonth, endOfMonth),
                database.stats.countDaysWithStatsInMonth(now),
                database.notes.countNotesInRange(startOfMonth, endOfMonth),
                database.dayAnalyses.countAnalysesInRange(startOfMonth, endOfMonth),
                
                // Yearly counts
                database.screenshots.countScreenshotsWithDescriptionInRange(startOfYear, endOfYear),
                database.screenshots.countScreenshotsInRange(startOfYear, endOfYear),
                database.stats.countDaysWithStatsInYear(now.getFullYear()),
                database.notes.countNotesInRange(startOfYear, endOfYear),
                database.dayAnalyses.countAnalysesInRange(startOfYear, endOfYear),
                
                // Tags counts
                database.screenshots.countScreenshotsWithTagsInRange(startOfMonth, endOfMonth),
                database.screenshots.countScreenshotsWithTagsInRange(startOfYear, endOfYear)
            ]);
            
            return {
                success: true,
                counts: {
                    // Monthly counts
                    descriptions: descriptionsCount,
                    logs: logsCount,
                    stats: statsCount,
                    notes: notesCount,
                    analyses: analysesCount,
                    tags: tagsCount,
                    
                    // Yearly counts
                    yearDescriptions: yearDescriptionsCount,
                    yearLogs: yearLogsCount,
                    yearStats: yearStatsCount,
                    yearNotes: yearNotesCount,
                    yearAnalyses: yearAnalysesCount,
                    yearTags: yearTagsCount
                }
            };
        } catch (error) {
            console.error('Error getting data counts:', error);
            return { 
                success: false, 
                error: getErrorMessage(error),
                counts: {
                    // Monthly counts
                    descriptions: 0,
                    logs: 0,
                    stats: 0,
                    notes: 0,
                    analyses: 0,
                    tags: 0,
                    
                    // Yearly counts
                    yearDescriptions: 0,
                    yearLogs: 0,
                    yearStats: 0,
                    yearNotes: 0,
                    yearAnalyses: 0,
                    yearTags: 0
                }
            };
        }
    });

    // Get productivity by hour handler
    ipcMain.handle('get-productivity-by-hour', async () => {
        try {
            const db = dependencies.database.getConnection();
            const now = new Date();
            const startDate = new Date(now.getTime() - (365 * 24 * 60 * 60 * 1000)); // 365 days ago

            interface HourlyDataRow {
                hour: string;
                timestamp: string;
                category: 'WORK' | 'LEARN';
                next_timestamp: string | null;
            }

            // Query to get hourly productivity data
            const results = await new Promise<HourlyDataRow[]>((resolve, reject) => {
                db.all(`
                    SELECT 
                        strftime('%H', timestamp) as hour,
                        timestamp,
                        category,
                        LEAD(timestamp) OVER (PARTITION BY strftime('%Y-%m-%d', timestamp) ORDER BY timestamp ASC) as next_timestamp
                    FROM screenshots 
                    WHERE 
                        timestamp >= ? 
                        AND timestamp <= ? 
                        AND category IN ('WORK', 'LEARN')
                    ORDER BY timestamp ASC
                `, [
                    startDate.toISOString(),
                    now.toISOString()
                ], (err: Error | null, rows: HourlyDataRow[]) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve(rows || []);
                });
            });
            
            const intervalMinutes = store.get('interval') || 5;

            // Process the results into hourly data (in minutes)
            const hourlyMinutes: Record<string, { work: number; learn: number }> = {};
            
            // Initialize all hours
            for (let i = 0; i < 24; i++) {
                const hour = i.toString().padStart(2, '0');
                hourlyMinutes[hour] = { work: 0, learn: 0 };
            }

            // Fill in the data
            results.forEach(row => {
                const hour = row.hour;
                const category = row.category.toLowerCase();
                
                let diffMinutes = 0;
                if (row.next_timestamp) {
                    const currentTime = new Date(row.timestamp);
                    const nextTime = new Date(row.next_timestamp);
                    const calculatedDiff = Math.abs((nextTime.getTime() - currentTime.getTime()) / (1000 * 60));
                    
                    if (calculatedDiff <= intervalMinutes) {
                        diffMinutes = calculatedDiff;
                    } else {
                        diffMinutes = intervalMinutes;
                    }
                } else {
                    diffMinutes = intervalMinutes;
                }
                
                if (category === 'work') {
                    hourlyMinutes[hour].work += diffMinutes;
                } else if (category === 'learn') {
                    hourlyMinutes[hour].learn += diffMinutes;
                }
            });

            // Convert minutes to hours and calculate total
            const hourlyData: Record<string, { work: number; learn: number; total: number }> = {};
            Object.keys(hourlyMinutes).forEach(hour => {
                const workHours = hourlyMinutes[hour].work / 60;
                const learnHours = hourlyMinutes[hour].learn / 60;
                hourlyData[hour] = {
                    work: workHours,
                    learn: learnHours,
                    total: workHours + learnHours
                };
            });

            return {
                success: true,
                data: hourlyData
            };
        } catch (error) {
            console.error('Error getting productivity by hour:', error);
            return {
                success: false,
                error: getErrorMessage(error),
                data: {}
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