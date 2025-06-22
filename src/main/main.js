// File: main.js
const { app, BrowserWindow, ipcMain, screen, powerMonitor, Tray, Menu } = require('electron');
const path = require('path');
const Store = require('electron-store');
const schedule = require('node-schedule');
const { GoogleGenerativeAI, Type } = require('@google/generative-ai');
const { GoogleAIFileManager } = require('@google/generative-ai/server');
const fs = require('fs');
const store = new Store({
    defaults: {
        interval: 1 // Default to 1 minute
    }
});
const AutoLaunch = require('auto-launch');
const database = require('./database');
const logger = require('./logger');
const ScreenshotCapture = require('./screenshot');

let mainWindow;
let isTracking = false;
let genAI;
let model;
let fileManager;


// Get categories from database module
const { categories } = database;


// Add this near the top with other global variables
let currentDate = new Date();

// Add this near other global variables
const autoLauncher = new AutoLaunch({
    name: 'WhatDidIDo',
    path: app.getPath('exe'),
});

// Add these global variables near the top
let tray = null;
let isQuitting = false;

// Add this near your other global variables
let hasShownMinimizeNotification = false;

// Initialize logger
let appLogger;
let screenshotCapture;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    },
    frame: false,
    focusable: true,
    show: false,
    titleBarStyle: 'hidden',
    icon: path.join(__dirname, '../../assets/icon.ico'),
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  
  mainWindow.webContents.on('did-finish-load', async () => {
    try {
      currentDate = new Date();
      
      const initialData = await database.getActivityStats(currentDate, store.get('interval'));
      console.log('Initial data loaded:', initialData);
      
      mainWindow.webContents.send('initial-data', initialData);
      
      setTimeout(() => {
        mainWindow.show();
        mainWindow.webContents.send('refresh-ui');
      }, 100);
    } catch (error) {
      console.error('Error loading initial data:', error);
      mainWindow.show();
    }
  });

  // Add these window event handlers
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      showTrayNotification();
      return false;
    }
    return true;
  });

  mainWindow.on('minimize', (event) => {
    event.preventDefault();
    mainWindow.hide();
  });
}

// Initialize Gemini API with file manager
async function initializeGeminiAPI(apiKey) {
  try {
    appLogger.info('Initializing Gemini API...');
    genAI = new GoogleGenerativeAI(apiKey);
    
    model = genAI.getGenerativeModel({ 
      model: "gemini-2.0-flash",
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 8192
      }
    });
    
    // Test the API key with a simple request
    const result = await model.generateContent('Hello, this is a test message.');
    const response = await result.response;
    
    if (response) {
      fileManager = new GoogleAIFileManager(apiKey);
      store.set('apiKey', apiKey);
      return { success: true };
    }
    
    appLogger.error('Invalid API response received during initialization');
    return { success: false, error: 'Invalid API response' };
  } catch (error) {
    appLogger.error('API validation error:', error.message);
    return { 
      success: false, 
      error: error.message || 'Invalid API key'
    };
  }
}


// Modify the captureAndAnalyze function
async function captureAndAnalyze() {
    try {
        const idleTime = powerMonitor.getSystemIdleTime();
        const idleMinutes = idleTime / 60;
        const interval = store.get('interval');

        if (idleMinutes >= interval) {
            appLogger.info(`User idle for ${idleMinutes.toFixed(1)} minutes. Skipping screenshot.`);
            return;
        }

        appLogger.info('Starting capture and analyze process...');
        
        const now = new Date();
        const timestamp = now.toISOString();
        appLogger.info('Created timestamp:', timestamp);

        // Capture screenshot and thumbnail using the new module
        const { imgBuffer, thumbnailBuffer } = await screenshotCapture.captureWithThumbnail();
        
        appLogger.info('Processing screenshot with Gemini...');
        
        // Default response in case of any failure
        let response = {
            category: 'WORK',
            activity: 'screenshot captured (analysis unavailable)'
        };

        // Try Gemini analysis with full error isolation
        let tempFilePath = null;
        try {
            // Create a temporary file with a safe filename
            const safeTimestamp = timestamp.replace(/[:.]/g, '-');
            tempFilePath = path.join(
                app.getPath('temp'), 
                `temp-screenshot-${safeTimestamp}.png`
            );

            fs.mkdirSync(path.dirname(tempFilePath), { recursive: true });
            fs.writeFileSync(tempFilePath, imgBuffer);

            // Try uploading to Gemini
            const uploadResult = await fileManager.uploadFile(tempFilePath, {
                mimeType: 'image/png',
                displayName: `screenshot-${safeTimestamp}.png`
            });

            appLogger.info('Gemini file upload successful');

            const generationConfig = {
                temperature: 0.2, // Lower temperature for more consistent outputs
                maxOutputTokens: 8192,
                responseMimeType: "application/json",
                responseSchema: {
                    type: "OBJECT",
                    properties: {
                        category: {
                            type: "STRING",
                            enum: categories, // Enforce only valid categories
                            description: "The category of the activity, must be one of: " + categories.join(", ")
                        },
                        activity: {
                            type: "STRING",
                            description: "Brief description of the specific activity being performed (software development, browsing reddit, etc.)"
                        }
                    },
                    required: ["category", "activity"]
                }
            };

            appLogger.info('Starting Gemini analysis...');
            const chatSession = model.startChat({ generationConfig });
            
            const prompt = `Analyze this screenshot and categorize the activity based on the user's apparent task.
            Return a JSON object with "category" and "activity" fields, where category must be EXACTLY one of these values: 
            ${categories.join(', ')}. 
            Focus on the purpose of the activity rather than the specific application.
            For example:
            - Games, videos, entertainment live streams, YouTube, social media content consumption, casual browsing, or scrolling would be "ENTERTAINMENT" (even if user is commenting/chatting on entertainment content)
            - Coding, documents, or professional tasks would be "WORK"
            - Online courses, tutorials, or research or non-entertainment podcasts would be "LEARN"
            - Meetings, direct messaging, emails, or professional/personal communication would be "SOCIAL" (IMPORTANT: interactions on entertainment platforms like YouTube comments, Twitch chat, or social media entertainment content are NOT social - they count as ENTERTAINMENT)

            Example response: {"category": "WORK", "activity": "software development"}`;
            
            try {
                const result = await chatSession.sendMessage([
                    {
                        fileData: {
                            mimeType: 'image/png',
                            fileUri: uploadResult.file.uri
                        }
                    },
                    { text: prompt }
                ]);

                appLogger.info('Received Gemini response');
                
                // Access the structured response directly
                if (result.response.functionResponse) {
                    response = result.response.functionResponse;
                } else {
                    try {
                        const parsedResponse = JSON.parse(result.response.text());
                        
                        // Simple normalization to ensure consistent category casing
                        if (parsedResponse.category && parsedResponse.activity) {
                            const normalizedCategory = categories.find(cat => 
                                cat.toUpperCase() === parsedResponse.category.toUpperCase());
                            
                            if (normalizedCategory) {
                                response = {
                                    category: normalizedCategory,
                                    activity: parsedResponse.activity
                                };
                            } else {
                                // Keep default response if category not found
                                appLogger.error('Invalid category in response:', parsedResponse.category);
                            }
                        }
                    } catch (parseError) {
                        appLogger.error('Error parsing JSON response:', parseError.message);
                    }
                }
            } catch (geminiError) {
                appLogger.error('Error in Gemini analysis (will continue with fallback):', geminiError.message);
            }
        } catch (geminiError) {
            appLogger.error('Error in Gemini analysis (will continue with fallback):', geminiError.message);
            // Keep the default response - don't throw error
        } finally {
            // Clean up temp file
            if (tempFilePath && fs.existsSync(tempFilePath)) {
                try {
                    fs.unlinkSync(tempFilePath);
                } catch (cleanupError) {
                    appLogger.error('Error cleaning up temp file:', cleanupError.message);
                }
            }
        }

        // Store in database - wrap in try-catch to prevent database errors from breaking the schedule
        try {
            await database.saveScreenshot(
                timestamp,
                response.category,
                response.activity,
                imgBuffer,
                thumbnailBuffer
            );
            
            // Try to update UI, but don't let it break the process
            try {
                const updatedData = await database.getActivityStats(currentDate, store.get('interval'));
                
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('activity-updated', updatedData);
                    setTimeout(() => {
                        mainWindow.webContents.send('refresh-ui');
                    }, 100);
                }
            } catch (uiError) {
                appLogger.error('Error updating UI (non-critical):', uiError.message);
            }
        } catch (dbError) {
            appLogger.error('Database operation failed (non-critical):', dbError.message);
        }

        appLogger.info('Screenshot capture and analysis completed successfully');

    } catch (error) {
        appLogger.error('Error in capture and analyze:', error);
        appLogger.error('Stack trace:', error.stack);
        // Don't throw - let the schedule continue regardless of any errors
    }
}


// IPC handlers
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

ipcMain.handle('get-stats', async () => {
  try {
    const data = await database.getActivityStats(currentDate, store.get('interval'));
    return {
      stats: {
        stats: data.stats,
        timeInHours: data.timeInHours  // Make sure this is included
      },
      screenshots: data.screenshots
    };
  } catch (error) {
    console.error('Error getting stats:', error);
    return {
      stats: {
        stats: {},
        timeInHours: {}  // Include empty timeInHours object
      },
      screenshots: []
    };
  }
});

ipcMain.handle('toggle-tracking', async (event, shouldTrack) => {
  const apiKey = store.get('apiKey');
  if (!apiKey) {
    pauseTracking();
    return false;
  }
  
  isTracking = shouldTrack;
  if (isTracking) {
    const interval = store.get('interval');
    schedule.scheduleJob(`*/${interval} * * * *`, captureAndAnalyze);
  } else {
    schedule.gracefulShutdown();
  }
  return isTracking;
});

// Add this helper function for the countdown
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Modify the test-screenshot handler
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

// Add this IPC handler near your other handlers
ipcMain.handle('get-api-key', () => {
    return store.get('apiKey');
});

// Add this IPC handler near your other handlers
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
        genAI = null;
        model = null;
        fileManager = null;
        pauseTracking();
        return true;
    } catch (error) {
        console.error('Error deleting API key:', error);
        return false;
    }
});

// Add this helper function
function pauseTracking() {
  isTracking = false;
  schedule.gracefulShutdown();
  if (mainWindow) {
    mainWindow.webContents.send('tracking-paused');
  }
}

ipcMain.handle('update-interval', async (event, interval) => {
    store.set('interval', interval);
    if (isTracking) {
        schedule.gracefulShutdown();
        schedule.scheduleJob(`*/${interval} * * * *`, captureAndAnalyze);
    }
    return true;
});

ipcMain.handle('get-interval', () => {
    return store.get('interval');
});

// Add this IPC handler with the other IPC handlers
ipcMain.handle('update-current-date', async (event, newDateString) => {
    currentDate = new Date(newDateString);
    const data = await database.getActivityStats(currentDate, store.get('interval'));
    return {
        stats: data.stats,
        timeInHours: data.timeInHours,
        screenshots: data.screenshots
    };
});

// Add this IPC handler to allow manual refresh requests
ipcMain.handle('request-refresh', async () => {
    try {
        const data = await database.getActivityStats(currentDate, store.get('interval'));
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

// Add this near your other initialization code (in app.whenReady())
function initializeIdleMonitor() {
    // Update lastActiveTime whenever system becomes active
    powerMonitor.on('unlock-screen', () => {
        lastActiveTime = Date.now();
    });
    
    powerMonitor.on('resume', () => {
        lastActiveTime = Date.now();
    });

    // Check for user input events through the main window
    if (mainWindow) {
        mainWindow.webContents.on('input-event', () => {
            lastActiveTime = Date.now();
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
    tray = new Tray(path.join(__dirname, '../../assets/icon.ico'));
    
    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Open What Did I Do',
            click: () => {
                mainWindow.show();
            }
        },
        {
            type: 'separator'
        },
        {
            label: 'Quit',
            click: () => {
                isQuitting = true;
                app.quit();
            }
        }
    ]);

    tray.setToolTip('What Did I Do - Running in Background');
    tray.setContextMenu(contextMenu);

    tray.on('double-click', () => {
        mainWindow.show();
    });
}

// Add this function to show the notification
function showTrayNotification() {
    if (!hasShownMinimizeNotification) {
        tray.displayBalloon({
            title: 'What Did I Do is still running',
            content: 'The app will continue running in the background. You can access it anytime from the system tray.',
            icon: path.join(__dirname, '../../assets/icon.ico'),
            iconType: 'custom'
        });
        hasShownMinimizeNotification = true;
    }
}

// Add these IPC handlers
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
        appLogger.error('Error reading logs:', error);
        return [];
    }
});

app.whenReady().then(async () => {
    try {
        appLogger = logger.createLogger();
        screenshotCapture = new ScreenshotCapture(appLogger);
        await handleFirstRun();
        await database.initializeDatabase();
        createWindow();
        createTray();
        initializeIdleMonitor();
        
        // Only start tracking if API key exists
        const apiKey = store.get('apiKey');
        if (apiKey) {
            isTracking = true;
            const interval = store.get('interval');
            schedule.scheduleJob(`*/${interval} * * * *`, captureAndAnalyze);
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

// Add these IPC handlers for window controls
ipcMain.on('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-close', () => {
  if (mainWindow) mainWindow.hide();
});

// Add cleanup on app quit
app.on('will-quit', async () => {
    await database.closeDatabase();
    if (tray) {
        tray.destroy();
    }
});

// Add these IPC handlers
ipcMain.handle('get-auto-launch', async () => {
    try {
        const isEnabled = await autoLauncher.isEnabled();
        return isEnabled;
    } catch (error) {
        console.error('Error checking auto-launch status:', error);
        // Return true as default if there's an error checking status
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

// Add this new IPC handler with your other handlers
ipcMain.handle('delete-screenshot', async (event, id) => {
    try {
        const success = await database.deleteScreenshot(id);
        return success;
    } catch (error) {
        console.error('Error deleting screenshot:', error);
        return false;
    }
});

// Add this IPC handler near your other IPC handlers
ipcMain.handle('quit-app', () => {
    isQuitting = true;
    app.quit();
});

// Add this IPC handler near your other IPC handlers
ipcMain.handle('load-more-screenshots', async (event, offset = 0, limit = 50) => {
    try {
        const screenshots = await database.getMoreScreenshots(currentDate, offset, limit);
        return { success: true, screenshots };
    } catch (error) {
        console.error('Error loading more screenshots:', error);
        return { success: false, screenshots: [] };
    }
});

// Add this IPC handler near the other IPC handlers
ipcMain.handle('get-monthly-averages', async () => {
  try {
    const data = await database.getMonthlyAverages(currentDate, store.get('interval'));
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
