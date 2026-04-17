import { app, BrowserWindow, ipcMain, powerMonitor, Tray, Menu, globalShortcut } from 'electron';
import * as path from 'path';
import Store from 'electron-store';
import { GoogleGenAI } from '@google/genai';
import * as fs from 'fs';
import AutoLaunch from 'auto-launch';
import * as database from './db';
import * as logger from './logger';
import ScreenshotCapture from './screenshot';
import SimpleRobustScheduler from './scheduler';
import { initializeIpcHandlers } from './ipc-handlers';
import { AppState, AnalysisError, AnalysisResponse, GeminiApiResponse, DayAnalysisData } from './types';
import { Category, categories, initializeDatabase, closeDatabase } from './db/core';

// Initialize the store with default values
const store = new Store<{
    interval: number;
    geminiModel: string;
    geminiFallbackModel: string;
    apiKey?: string;
}>({
    defaults: {
        interval: 1, // Default to 1 minute
        geminiModel: 'gemini-3.1-flash-lite-preview',
        geminiFallbackModel: 'gemini-flash-lite-latest'
    }
});

const FALLBACK_GEMINI_MODEL = 'gemini-flash-lite-latest';

// Initialize app state
const state: AppState = {
    mainWindow: null,
    isTracking: false,
    ai: null,
    scheduler: null,
    dayAnalysisScheduler: null,
    currentDate: new Date(),
    tray: null,
    isQuitting: false,
    hasShownMinimizeNotification: false,
    appLogger: null as any, // Will be initialized in app.whenReady()
    screenshotCapture: null,
    lastAnalysisError: null,
    lastActiveTime: Date.now()
};

// Initialize auto launcher
const autoLauncher = new AutoLaunch({
    name: 'WhatDidIDo',
    path: app.getPath('exe'),
});

function createWindow() {
    state.mainWindow = new BrowserWindow({
        width: 1600,
        height: 800,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        frame: false,
        focusable: true,
        show: false,
        titleBarStyle: 'hidden',
        icon: path.join(__dirname, '../../assets/icon.ico'),
    });

    state.mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

    state.mainWindow.webContents.on('did-finish-load', async () => {
        try {
            state.currentDate = new Date();
            
            const initialData = await database.stats.getActivityStats(state.currentDate, store.get('interval'));
            console.log('Initial data loaded:', initialData);
            
            state.mainWindow?.webContents.send('initial-data', initialData);
            
            setTimeout(() => {
                state.mainWindow?.show();
                state.mainWindow?.webContents.send('refresh-ui');
            }, 100);
        } catch (error) {
            console.error('Error loading initial data:', error);
            state.mainWindow?.show();
        }
    });

    state.mainWindow.on('close', (event: Electron.Event) => {
        if (!state.isQuitting) {
            event.preventDefault();
            state.mainWindow?.hide();
            showTrayNotification();
            return false;
        }
        return true;
    });

    state.mainWindow.on('minimize', (event: Electron.Event) => {
        event.preventDefault();
        state.mainWindow?.hide();
    });
}

// Initialize Gemini API with file manager
async function initializeGeminiAPI(apiKey: string): Promise<GeminiApiResponse> {
    try {
        state.appLogger.info('Initializing Gemini API...');
        state.ai = new GoogleGenAI({apiKey});
        
        // Test the API key with a simple request
        const result = await generateContentWithFallback({
            model: store.get('geminiModel') || 'gemini-3.1-flash-lite-preview',
            contents: 'Hello, this is a test message.'
        }, 'initializeGeminiAPI');
        
        if (result && result.text) {
            store.set('apiKey', apiKey);
            return { success: true };
        }
        
        state.appLogger.error('Invalid API response received during initialization');
        return { success: false, error: 'Invalid API response' };
    } catch (error) {
        if (error instanceof Error) {
            state.appLogger.error('API validation error:', {
                message: error.message,
                stack: error.stack,
                fullError: error
            });
            return { 
                success: false, 
                error: error.message || 'Invalid API key'
            };
        }
        return {
            success: false,
            error: 'Unknown error occurred'
        };
    }
}

async function buildRecentHistoryContext(): Promise<string> {
    const recentScreenshots = await database.screenshots.getLastNScreenshotsMetadata(20);
    if (recentScreenshots.length === 0) {
        return '';
    }

    return `\nRecent activity history (last ${recentScreenshots.length} screenshots, from newest to oldest) as helpful context to what the user have been doing. if you notice a pattern or a shared thing in the recent history, mention it in the context. if the user is still doing the same thing, only mention what's new about it, don't repeat the same thing:\n` +
        recentScreenshots.map((ss) =>
            `- [${new Date(ss.timestamp).toLocaleTimeString()}] Category: ${ss.category}, Activity: ${ss.activity}\n  Description: ${ss.description || ''}`
        ).join('\n');
}

function buildScreenshotAnalysisPrompt(recentHistoryContext: string): string {
    return `Analyze this screenshot and categorize the activity based on the user's apparent task.
            Return a JSON object with "category", "activity", "description", and "tags" fields, where category must be EXACTLY one of these values: 
            ${categories.join(', ')}. 
            

            Focus on the purpose of the activity rather than the specific application.
            For example:
            - Games, videos, entertainment live streams, clearly entertainment YouTube videos, social media content consumption, casual browsing, or scrolling would be "ENTERTAINMENT" (even if user is commenting/chatting on entertainment content)
            - Coding, documents, or professional tasks would be "WORK"
            - Online courses, tutorials, or research or podcasts and youtube videos (like tech / ai related  / psychology etc.) would be "LEARN"
            - Meetings, direct messaging, emails, or professional/personal communication would be "SOCIAL" (IMPORTANT: interactions on entertainment platforms like YouTube comments, Twitch chat, or social media entertainment content are NOT social - they count as ENTERTAINMENT)
            - Tasks that don't clearly fit into WORK, LEARN, SOCIAL, or ENTERTAINMENT would be "OTHER" (e.g., personal finance, shopping, health tracking, system settings, etc.)

            For the "description" field, provide a comprehensive description (max 150-300 words) of what the user is doing, what's visible on the screen, and any relevant context about the activity. This should be detailed enough to understand the user's behavior and the content they're interacting with.

                        For the behavior analysis "tags" field, generate an array of 10-15 detailed tags following this hierarchical structure to ensure they are useful for future behavioral analysis. Tags should be action and behavior-based, not just single, vague words (e.g., use "writing javascript code" instead of "coding"). Infer user intent and avoid literal tags from UI elements (e.g., use "music discovery" instead of "recommended songs").
            1.  **User Intention (1-2 tags):** The user's likely purpose or goal for this specific action (e.g., learning a new skill, solving a bug, relaxing).
            2.  **Primary Activity (2-3 tags):** The main task being performed (e.g., software development, writing, watching video).
            3.  **Tools & Technologies (2-3 tags):** Applications or platforms in use (e.g., VS Code, YouTube, JavaScript).
            4.  **Specific Subjects (2-3 tags):** The high-level topic or project (e.g., adk-typescript project, stoicism).
            5.  **Content Keywords (3-5 tags):** Specific nouns and concepts from the on-screen content (e.g., tanker truck of blood, animal blood processing, biodiesel).
            6.  **Inferred User Action (2-3 tags):** The user's specific, verb-based actions (e.g., writing code, reading comments, planning improvements).

            Example response 1: {
              "category": "WORK", 
              "activity": "software development",
              "description": "The user is engaged in software development work in an IDE. They appear to be writing JavaScript code for their 'adk-typescript' project, with multiple files open in tabs. The code seems to be related to data processing or API integration based on the function names visible. The user has a terminal open at the bottom of the screen showing recent command executions. There's also a browser window partially visible with what looks like documentation or Stack Overflow. The overall context suggests focused programming work on a professional project.",
              "tags": ["feature development", "software development", "web development", "visual studio code", "javascript", "adk-typescript project", "api integration", "writing javascript code", "refactoring api module", "debugging code", "reading documentation"]
            }

            Example response 2: {
              "category": "LEARN",
              "activity": "AI-assisted self-reflection",
              "description": "The user is interacting with an AI chat assistant (ChatGPT) to analyze and improve their personal productivity. They are expressing frustration about not accomplishing enough work on the previous day and are seeking strategies to overcome procrastination. The conversation references Stoic philosophy, specifically ideas from Marcus Aurelius, as a framework for building better discipline. This indicates a targeted effort to diagnose a specific productivity issue and find actionable solutions.",
              "tags": ["overcoming procrastination", "improving daily discipline", "ai-assisted self-reflection", "chatgpt", "web browser", "stoic philosophy", "marcus aurelius", "previous day's performance", "analyzing past behavior", "seeking advice", "planning focus techniques"]
            }

            Example response 3: {
              "category": "ENTERTAINMENT",
              "activity": "browsing reddit",
              "description": "The user is browsing Reddit, specifically on the r/mildlyinteresting subreddit. The main content of the page is a post featuring a tanker truck filled with blood. The user is viewing the comments section of this post, which contains discussions related to the origin and purpose of the blood. One comment mentions working at a waste reduction plant that processed animal blood into biodiesel and fertilizer.",
              "tags": ["casual entertainment", "browsing social media", "reading user-generated content", "reddit", "web browser", "r/mildlyinteresting", "tanker truck of blood", "animal blood processing", "biodiesel", "reading comments", "scrolling content"]
            }
              
            ${recentHistoryContext}`;
}

function parseGeminiAnalysisResponse(responseText: string | undefined): AnalysisResponse | null {
    if (!responseText) {
        return null;
    }

    let parsedResponse: any;
    try {
        parsedResponse = JSON.parse(responseText);
    } catch {
        return null;
    }

    if (!parsedResponse.category || !parsedResponse.activity) {
        return null;
    }

    const normalizedCategory = categories.find((cat: Category) =>
        cat.toUpperCase() === String(parsedResponse.category).toUpperCase()
    );

    if (!normalizedCategory) {
        return null;
    }

    return {
        category: normalizedCategory,
        activity: parsedResponse.activity,
        description: parsedResponse.description || 'No description available.',
        tags: parsedResponse.tags || []
    };
}

async function analyzeScreenshotWithGemini(
    imgBuffer: Buffer,
    timestamp: string,
    logContext: string
): Promise<AnalysisResponse | null> {
    let tempFilePath: string | null = null;

    try {
        const safeTimestamp = timestamp.replace(/[:.]/g, '-');
        tempFilePath = path.join(
            app.getPath('temp'),
            `temp-screenshot-${safeTimestamp}.png`
        );

        fs.mkdirSync(path.dirname(tempFilePath), { recursive: true });
        fs.writeFileSync(tempFilePath, imgBuffer);

        state.appLogger.info('Attempting file upload to Gemini...', { filePath: tempFilePath, context: logContext });
        if (!state.ai) {
            throw new Error('AI is not initialized');
        }

        const uploadResult = await state.ai.files.upload({
            file: tempFilePath,
            config: {
                mimeType: 'image/png',
                displayName: `screenshot-${safeTimestamp}.png`
            }
        });

        state.appLogger.info('Gemini file upload successful', {
            uri: uploadResult.uri,
            name: uploadResult.name,
            mimeType: uploadResult.mimeType,
            context: logContext
        });

        const recentHistoryContext = await buildRecentHistoryContext();
        const prompt = buildScreenshotAnalysisPrompt(recentHistoryContext);

        state.appLogger.info('Starting Gemini analysis...', { context: logContext });

        const result = await generateContentWithFallback({
            model: store.get('geminiModel') || 'gemini-3.1-flash-lite-preview',
            contents: [
                {
                    parts: [
                        {
                            fileData: {
                                mimeType: 'image/png',
                                fileUri: uploadResult.uri
                            }
                        },
                        { text: prompt }
                    ]
                }
            ],
            config: {
                temperature: 0.6,
                maxOutputTokens: 8192,
                responseMimeType: "application/json",
                responseSchema: {
                    type: "OBJECT",
                    properties: {
                        category: {
                            type: "STRING",
                            enum: categories,
                            description: "The category of the activity, must be one of: " + categories.join(", ")
                        },
                        activity: {
                            type: "STRING",
                            description: "Brief description of the specific activity being performed (software development, browsing reddit, etc.)"
                        },
                        description: {
                            type: "STRING",
                            description: "Detailed description of what the user is doing, what's visible on screen, and context about the activity (150-200 words)"
                        },
                        tags: {
                            type: "ARRAY",
                            items: {
                                type: "STRING"
                            },
                            description: "An array of 10-15 detailed tags about the activity."
                        }
                    },
                    required: ["category", "activity", "description", "tags"]
                }
            }
        }, logContext);

        state.appLogger.info('Received Gemini response', { context: logContext });
        state.appLogger.info('Raw Gemini response:', { responseText: result.text, context: logContext });

        const parsedResponse = parseGeminiAnalysisResponse(result.text);
        if (parsedResponse) {
            state.appLogger.info('Successfully parsed Gemini response:', parsedResponse);
            return parsedResponse;
        }

        state.appLogger.error('Invalid or incomplete Gemini response', {
            responseText: result.text,
            context: logContext
        });
    } catch (error) {
        if (error instanceof Error) {
            state.appLogger.error('Error in Gemini content generation:', {
                message: error.message,
                stack: error.stack,
                fullError: error,
                context: logContext
            });
        }
    } finally {
        if (tempFilePath && fs.existsSync(tempFilePath)) {
            try {
                fs.unlinkSync(tempFilePath);
            } catch (error) {
                if (error instanceof Error) {
                    state.appLogger.error('Error cleaning up temp file:', error.message);
                }
            }
        }
    }

    return null;
}


// Modify the captureAndAnalyze function
async function captureAndAnalyze() {
    try {
        state.appLogger.info('Starting capture and analyze process...');
        
        const now = new Date();
        const timestamp = now.toISOString();
        state.appLogger.info('Created timestamp:', timestamp);

        // Check if screenshotCapture is initialized
        if (!state.screenshotCapture) {
            throw new Error('Screenshot capture module not initialized');
        }

        // Capture screenshot and thumbnail using the new module
        const { imgBuffer, thumbnailBuffer } = await state.screenshotCapture.captureWithThumbnail();
        
        state.appLogger.info('Processing screenshot with Gemini...');
        
        // Default response in case of any failure
        let response: AnalysisResponse = {
            category: 'UNKNOWN',  // Changed from 'WORK' to 'UNKNOWN' to avoid misleading categorization
            activity: 'screenshot captured (analysis unavailable)',
            description: 'No description available due to analysis failure.',
            tags: []
        };

        const analysisResult = await analyzeScreenshotWithGemini(
            imgBuffer,
            timestamp,
            'captureAndAnalyze'
        );
        if (analysisResult) {
            response = analysisResult;
        }

        const analysisSucceeded = response.category !== 'UNKNOWN' ||
            response.activity !== 'screenshot captured (analysis unavailable)';

        // Store the screenshot even when analysis fails so history can still show it.
        try {
            await database.screenshots.saveScreenshot(
                timestamp,
                response.category as Category,
                response.activity,
                imgBuffer,
                thumbnailBuffer,
                response.description,
                response.tags
            );

            if (analysisSucceeded) {
                state.lastAnalysisError = null;
            } else {
                const errorMessage = 'AI analysis failed - screenshot captured but could not be categorized';
                state.lastAnalysisError = {
                    timestamp: new Date().toISOString(),
                    message: errorMessage,
                    type: 'analysis_failed'
                };
                state.appLogger.info('Screenshot capture completed, analysis failed, and fallback data was saved');
            }

            // Try to update UI, but don't let it break the process
            try {
                const updatedData = await database.stats.getActivityStats(state.currentDate, store.get('interval'));

                if (state.mainWindow?.webContents) {
                    state.mainWindow.webContents.send('activity-updated', updatedData);

                    if (analysisSucceeded) {
                        state.mainWindow.webContents.send('analysis-error-cleared');
                    } else {
                        state.mainWindow.webContents.send('analysis-error', state.lastAnalysisError);
                    }

                    setTimeout(() => {
                        state.mainWindow?.webContents.send('refresh-ui');
                    }, 100);
                }
            } catch (error) {
                if (error instanceof Error) {
                    state.appLogger.error('Error updating UI (non-critical):', error.message);
                }
            }

            state.appLogger.info(
                analysisSucceeded
                    ? 'Screenshot capture and analysis completed successfully'
                    : 'Screenshot capture completed with analysis fallback'
            );
        } catch (error) {
            if (error instanceof Error) {
                state.appLogger.error('Database operation failed (non-critical):', error.message);
            }
        }

    } catch (error) {
        if (error instanceof Error) {
            state.appLogger.error('Error in capture and analyze:', error);
            state.appLogger.error('Stack trace:', error.stack);
        }
        // Don't throw - let the schedule continue regardless of any errors
    }
}

async function retryScreenshotAnalysis(id: number): Promise<boolean> {
    try {
        state.appLogger.info('Retrying screenshot analysis', { id });

        const record = await database.screenshots.getScreenshotImageById(id);
        if (!record || !record.image_data) {
            state.appLogger.error('Screenshot not found for retry', { id });
            return false;
        }

        const analysisResult = await analyzeScreenshotWithGemini(
            record.image_data,
            record.timestamp,
            `retryScreenshot:${id}`
        );

        if (!analysisResult) {
            state.appLogger.error('Retry analysis failed', { id });
            return false;
        }

        const updated = await database.screenshots.updateScreenshotAnalysis(
            id,
            analysisResult.category as Category,
            analysisResult.activity,
            analysisResult.description,
            analysisResult.tags
        );

        if (updated) {
            state.appLogger.info('Screenshot analysis updated after retry', { id });
        }

        return updated;
    } catch (error) {
        if (error instanceof Error) {
            state.appLogger.error('Error retrying screenshot analysis:', {
                message: error.message,
                stack: error.stack,
                fullError: error,
                id
            });
        }
        return false;
    }
}

// Add this after captureAndAnalyze function
async function generateDayAnalysis(date: string): Promise<string> {
    try {
        state.appLogger.info('Starting day analysis generation for date:', date);
        const selectedModel = store.get('geminiModel') || 'gemini-3.1-flash-lite-preview';
        
        // Get all required data in parallel
        const [data, dailyStats] = await Promise.all([
            database.getDayDataForAnalysis(new Date(date)),
            database.stats.getDailyCategoryStats(new Date(date), 5) // Using 5 minutes as default interval
        ]);

        state.appLogger.info('Retrieved data for analysis:', {
            screenshotsCount: data.screenshots.length,
            notesCount: data.notes.length,
            historicalNotesCount: data.historicalData.notes.length,
            historicalAnalysesCount: data.historicalData.analyses.length,
            daysWithStats: Object.keys(dailyStats).length
        });

        if (!state.ai) {
            throw new Error('AI is not initialized. Please check your API key.');
        }

        const prompt = `You are a behavioral analyst. Your task is to analyze my activity logs and notes to create a report about my day, while considering my recent history and patterns from this month.

Here is today's data for analysis:

**Today's Activities Data (timestamps, categories, and descriptions):**
${JSON.stringify(data.screenshots, null, 2)}

**Today's Notes (${new Date(date).toISOString().split('T')[0]}):**
${JSON.stringify(data.notes, null, 2)}

The report must have three distinct sections:

1. Based on Todays data: **My Day:** Write an objective, chronological summary of my day from a first-person perspective (using "I"). State events simply and factually. Instead of vague descriptions like "for a while," use general but concrete estimates like "for about an hour" or "for a few minutes." Avoid complex language. Just describe what I did in the order it happened.

2. Based on Todays data: **Behavioral Analysis:** Write a very concise and focused analysis of the user's behavior from a third-person, objective perspective. Use a numbered list. Identify 3-4 key, actionable patterns related to focus, context-switching, activity triggers, or the alignment between the user's actions and stated intentions. Get straight to the point. give direct observation (1-2 sentences max).

3. Based on Todays data and Historical data: **Monthly Progress & Trends:** Based on the historical data and daily category statistics provided, analyze how today's behavior compares to recent days. Be very direct and use a numbered list. Identify any improvements or regressions in productivity patterns, highlight emerging habits (both positive and concerning), and note any progress toward previously identified goals or recommendations. Use the daily category statistics to support your observations with concrete data. Where is the user going?

**Historical Data from This Month for more context for the progress and trends analysis:**


**Daily Category Statistics for Current Month:**
This shows the percentage of time spent and hours spent in each category for each day this month:
${JSON.stringify(dailyStats, null, 2)}

Previous Days' Notes (before ${new Date(date).toISOString().split('T')[0]}):
${JSON.stringify(data.historicalData.notes, null, 2)}

Previous Days' Analyses:
${JSON.stringify(data.historicalData.analyses, null, 2)}

Generate the report following the specified structure and tone. IMPORTANT: Do not include any introductory text like "Of course, here is the report." Just return the raw markdown content of the report.

When analyzing trends and progress:
1. Compare today's activities with patterns from previous days using the daily category statistics
2. Note any improvements in areas previously identified as needing work
3. Identify if previously suggested strategies have been implemented
4. Look for consistency or changes in daily routines
5. Consider how today's behavior aligns with patterns from earlier in the month
6. Use the category statistics to identify any shifts in time allocation patterns`;

        state.appLogger.info('Sending request to Gemini API', { prompt: (prompt) });
        const result = await generateContentWithFallback({
             model: selectedModel,
             contents: prompt,
             config: {
                temperature: 0.7,
                maxOutputTokens: 8192,
            }
        }, 'generateDayAnalysis');
        state.appLogger.info('Received response from Gemini API');

        if (!result || !result.text) {
            throw new Error('Invalid response from Gemini API');
        }

        // Save to the day_analyses table
        await database.dayAnalyses.saveDayAnalysis(new Date(date), result.text);
        state.appLogger.info('Analysis saved to database');

        return result.text;
    } catch (error) {
        if (error instanceof Error) {
            state.appLogger.error('Error in generateDayAnalysis:', error);
        }
        throw error;
    }
}

// Add this helper function
function pauseTracking() {
  stopTracking();
  state.ai = null;
  if (state.mainWindow) {
    state.mainWindow.webContents.send('tracking-paused');
  }
}

// Helper functions for state management
function getCurrentDate(): Date {
  return state.currentDate;
}

function setCurrentDate(newDate: Date) {
  state.currentDate = newDate;
}

function getIsTracking(): boolean {
  return state.isTracking;
}

function setIsTracking(tracking: boolean) {
  state.isTracking = tracking;
}

function setIsQuitting(quitting: boolean) {
  state.isQuitting = quitting;
}

// Scheduler management functions
function startTracking() {
  if (!state.scheduler || !state.ai) {
    return false;
  }
  
  state.isTracking = true;
  state.scheduler.start(captureAndAnalyze);
  return true;
}

function stopTracking() {
  if (state.scheduler) {
    state.scheduler.stop();
  }
  state.isTracking = false;
}

function updateSchedulerInterval(newInterval: number) {
  if (state.scheduler) {
    state.scheduler.updateInterval(newInterval);
  }
}

// Update getSchedulerStatus function to return a boolean
function getSchedulerStatus(): boolean {
    return state.scheduler ? state.scheduler.getStatus().isRunning : false;
}

// Error tracking functions
function getLastAnalysisError(): AnalysisError | null {
  return state.lastAnalysisError;
}

function clearAnalysisError() {
  state.lastAnalysisError = null;
}

// Add this helper function for the countdown
function sleep(ms: number): Promise<void> {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}

function getFallbackModel(): string {
    return store.get('geminiFallbackModel') || FALLBACK_GEMINI_MODEL;
}

function isGeminiModelOverloaded(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
        return false;
    }

    const anyError = error as { message?: unknown; code?: number | string; status?: unknown };
    const message = typeof anyError.message === 'string' ? anyError.message : '';
    const code = anyError.code;
    const status = anyError.status;
    const statusText = typeof status === 'string' ? status : (status == null ? '' : String(status));

    if (code === 503 || code === '503') {
        return true;
    }

    if (statusText && statusText.toUpperCase() === 'UNAVAILABLE') {
        return true;
    }

    if (message.includes('\"code\":503') || message.includes('status\":\"UNAVAILABLE\"')) {
        return true;
    }

    if (message.includes('503') && message.toLowerCase().includes('high demand')) {
        return true;
    }

    return false;
}

async function generateContentWithFallback(
    params: Parameters<GoogleGenAI['models']['generateContent']>[0],
    logContext: string
) {
    if (!state.ai) {
        throw new Error('AI is not initialized');
    }

    try {
        return await state.ai.models.generateContent(params);
    } catch (error) {
        if (!isGeminiModelOverloaded(error)) {
            throw error;
        }

        const primaryModel = params.model;
        const fallbackModel = getFallbackModel();
        if (primaryModel === fallbackModel) {
            throw error;
        }

        state.appLogger.info('Primary Gemini model unavailable (503). Retrying with fallback model.', {
            context: logContext,
            primaryModel,
            fallbackModel
        });

        return await state.ai.models.generateContent({
            ...params,
            model: fallbackModel
        });
    }
}

// Add this near your other initialization code (in app.whenReady())
function initializeIdleMonitor() {
    // Update lastActiveTime whenever system becomes active
    powerMonitor.on('unlock-screen', () => {
        state.lastActiveTime = Date.now();
    });
    
    powerMonitor.on('resume', () => {
        state.lastActiveTime = Date.now();
    });

    // Check for user input events through the main window
    if (state.mainWindow) {
        state.mainWindow.webContents.on('input-event', () => {
            state.lastActiveTime = Date.now();
        });
    }
}

// Add this function to handle first-run setup
async function handleFirstRun() {
    const store = new Store();
    const hasRunBefore = store.get('hasRunBefore');
    
    if (!hasRunBefore) {
        try {
            // Enable auto-launch by default
            await autoLauncher.enable();
            // Mark as run
            store.set('hasRunBefore', true);
        } catch (error) {
            console.error('Error setting up first run:', error);
        }
    }
}

// Add this function to create the tray
function createTray() {
    state.tray = new Tray(path.join(__dirname, '../../assets/icon.ico'));
    
    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Open What Did I Do',
            click: () => {
                state.mainWindow?.show();
            }
        },
        {
            type: 'separator'
        },
        {
            label: 'Quit',
            click: () => {
                state.isQuitting = true;
                app.quit();
            }
        }
    ]);

    state.tray.setToolTip('What Did I Do - Running in Background');
    state.tray.setContextMenu(contextMenu);

    state.tray.on('double-click', () => {
        state.mainWindow?.show();
    });
}

// Add this function to show the notification
function showTrayNotification() {
    if (!state.hasShownMinimizeNotification) {
        state.tray?.displayBalloon({
            title: 'What Did I Do is still running',
            content: 'The app will continue running in the background. You can access it anytime from the system tray.',
            icon: path.join(__dirname, '../../assets/icon.ico'),
            iconType: 'custom'
        });
        state.hasShownMinimizeNotification = true;
    }
}

// Function to show window and open note modal
function showWindowAndOpenNoteModal() {
    if (state.mainWindow) {
        state.mainWindow.show();
        state.mainWindow.focus();
        
        // Send message to renderer to open note modal
        state.mainWindow.webContents.send('open-note-modal');
    }
}

// Add this function to handle periodic day analysis
async function runPeriodicDayAnalysis() {
    try {
        state.appLogger.info('Running periodic day analysis');
        const today = new Date();
        await generateDayAnalysis(today.toISOString().split('T')[0]);
        state.appLogger.info('Periodic day analysis completed successfully');
    } catch (error) {
        state.appLogger.error('Error in periodic day analysis:', error);
        // Don't throw - let the scheduler continue
    }
}

// Add this function to delay the initial day analysis
function scheduleInitialDayAnalysis() {
    state.appLogger.info('Scheduling initial day analysis to run after 1 hour');
    setTimeout(async () => {
        try {
            await runPeriodicDayAnalysis();
            state.appLogger.info('Initial day analysis completed successfully');
        } catch (error) {
            state.appLogger.error('Error in initial day analysis:', error);
        }
    }, 60 * 60 * 1000); // 1 hour in milliseconds
}

app.whenReady().then(async () => {
    try {
        state.appLogger = logger.createLogger();
        state.screenshotCapture = new ScreenshotCapture(state.appLogger);
        
        // Initialize the simple robust scheduler
        state.scheduler = new SimpleRobustScheduler(state.appLogger, {
            intervalMinutes: store.get('interval'),
            maxRetries: 2,
            idleThresholdMinutes: store.get('interval') // Skip if idle for interval duration
        });

        // Initialize day analysis scheduler (every 3 hours = 180 minutes)
        state.dayAnalysisScheduler = new SimpleRobustScheduler(state.appLogger, {
            intervalMinutes: 180,
            maxRetries: 2,
            idleThresholdMinutes: 0 // No idle threshold - run analysis regardless of system state
        });
        
        await handleFirstRun();
        await initializeDatabase();
        createWindow();
        createTray();
        initializeIdleMonitor();
        
        // Register global shortcut for note modal
        globalShortcut.register('CommandOrControl+Shift+D', () => {
            showWindowAndOpenNoteModal();
        });
        
        // Initialize IPC handlers with type-safe dependencies
        initializeIpcHandlers({
            database,
            store: {
                get: (key: string) => store.get(key as keyof typeof store.store),
                set: (key: string, value: any) => store.set(key as keyof typeof store.store, value),
                delete: (key: string) => store.delete(key as keyof typeof store.store)
            },
            logger: {
                info: state.appLogger.info.bind(state.appLogger),
                error: state.appLogger.error.bind(state.appLogger),
                getLogPath: () => path.join(app.getPath('userData'), 'logs'),
                getRecentLogs: async () => []
            },
            mainWindow: state.mainWindow!,
            autoLauncher,
            initializeGeminiAPI,
            pauseTracking,
            captureAndAnalyze,
            retryScreenshotAnalysis,
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
            getLastAnalysisError: () => {
                const error = state.lastAnalysisError;
                return error ? error.message : null;
            },
            clearAnalysisError,
            generateDayAnalysis
        });
        
        // Only start tracking if API key exists
        const apiKey = store.get('apiKey');
        if (apiKey) {
            await initializeGeminiAPI(apiKey);
            startTracking();
            // Start day analysis scheduler
            state.dayAnalysisScheduler.start(runPeriodicDayAnalysis);
            // Schedule initial analysis to run after 1 hour instead of immediately
            scheduleInitialDayAnalysis();
        } else {
            pauseTracking();
        }
    } catch (error) {
        console.error('Error during app initialization:', error);
    }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});



// Add cleanup on app quit
app.on('will-quit', async () => {
    if (state.scheduler) {
        state.scheduler.stop();
    }
    if (state.dayAnalysisScheduler) {
        state.dayAnalysisScheduler.stop();
    }
    await closeDatabase();
    if (state.tray) {
        state.tray.destroy();
    }
    // Unregister all global shortcuts
    globalShortcut.unregisterAll();
});
