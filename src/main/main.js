
const { app, BrowserWindow, ipcMain, screen, powerMonitor, Tray, Menu } = require('electron');
const path = require('path');
const Store = require('electron-store');
const { GoogleGenAI, Type } = require('@google/genai');
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
const SimpleRobustScheduler = require('./scheduler');
const { initializeIpcHandlers } = require('./ipc-handlers');


let mainWindow;
let isTracking = false;
let ai;
let scheduler;

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
    ai = new GoogleGenAI({apiKey: apiKey});
    
    // Test the API key with a simple request
    const result = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: 'Hello, this is a test message.'
    });
    
    if (result && result.text) {
      store.set('apiKey', apiKey);
      return { success: true };
    }
    
    appLogger.error('Invalid API response received during initialization');
    return { success: false, error: 'Invalid API response' };
  } catch (error) {
    appLogger.error('API validation error:', {
      message: error.message,
      status: error.status,
      statusText: error.statusText,
      stack: error.stack,
      fullError: error
    });
    return { 
      success: false, 
      error: error.message || 'Invalid API key'
    };
  }
}


// Modify the captureAndAnalyze function
async function captureAndAnalyze() {
    try {
        appLogger.info('Starting capture and analyze process...');
        
        const now = new Date();
        const timestamp = now.toISOString();
        appLogger.info('Created timestamp:', timestamp);

        // Capture screenshot and thumbnail using the new module
        const { imgBuffer, thumbnailBuffer } = await screenshotCapture.captureWithThumbnail();
        
        appLogger.info('Processing screenshot with Gemini...');
        
        // Default response in case of any failure
        let response = {
            category: 'UNKNOWN',  // Changed from 'WORK' to 'UNKNOWN' to avoid misleading categorization
            activity: 'screenshot captured (analysis unavailable)',
            description: 'No description available due to analysis failure.'
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
            appLogger.info('Attempting file upload to Gemini...', { filePath: tempFilePath });
            const uploadResult = await ai.files.upload({
                file: tempFilePath,
                mimeType: 'image/png',
                displayName: `screenshot-${safeTimestamp}.png`
            });

            appLogger.info('Gemini file upload successful', { 
                uri: uploadResult.uri,
                name: uploadResult.name,
                mimeType: uploadResult.mimeType
            });
            
            const prompt = `Analyze this screenshot and categorize the activity based on the user's apparent task.
            Return a JSON object with "category", "activity", and "description" fields, where category must be EXACTLY one of these values: 
            ${categories.join(', ')}. 
            Focus on the purpose of the activity rather than the specific application.
            For example:
            - Games, videos, entertainment live streams, clearly entertainment YouTube videos, social media content consumption, casual browsing, or scrolling would be "ENTERTAINMENT" (even if user is commenting/chatting on entertainment content)
            - Coding, documents, or professional tasks would be "WORK"
            - Online courses, tutorials, or research or podcasts and youtube videos (like tech / ai related  / psychology etc.) would be "LEARN"
            - Meetings, direct messaging, emails, or professional/personal communication would be "SOCIAL" (IMPORTANT: interactions on entertainment platforms like YouTube comments, Twitch chat, or social media entertainment content are NOT social - they count as ENTERTAINMENT)

            For the "description" field, provide a comprehensive description (150-200 words) of what the user is doing, what's visible on the screen, and any relevant context about the activity. This should be detailed enough to understand the user's behavior and the content they're interacting with.

            Example response: {
              "category": "WORK", 
              "activity": "software development",
              "description": "The user is engaged in software development work in an IDE. They appear to be writing JavaScript code for a web application, with multiple files open in tabs. The code seems to be related to data processing or API integration based on the function names visible. The user has a terminal open at the bottom of the screen showing recent command executions. There's also a browser window partially visible with what looks like documentation or Stack Overflow. The overall context suggests focused programming work on a professional project."
            }`;
            
            try {
                appLogger.info('Starting Gemini analysis...');
                
                const result = await ai.models.generateContent({
                    model: 'gemini-2.0-flash',
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
                                }
                            },
                            required: ["category", "activity", "description"]
                        }
                    }
                });

                appLogger.info('Received Gemini response');
                
                // Parse the response text
                try {
                    appLogger.info('Raw Gemini response:', { responseText: result.text });
                    const parsedResponse = JSON.parse(result.text);
                    
                    // Simple normalization to ensure consistent category casing
                    if (parsedResponse.category && parsedResponse.activity) {
                        const normalizedCategory = categories.find(cat => 
                            cat.toUpperCase() === parsedResponse.category.toUpperCase());
                        
                        if (normalizedCategory) {
                            response = {
                                category: normalizedCategory,
                                activity: parsedResponse.activity,
                                description: parsedResponse.description || 'No description available.'
                            };
                            appLogger.info('Successfully parsed Gemini response:', response);
                        } else {
                            // Keep default response if category not found
                            appLogger.error('Invalid category in response:', {
                                receivedCategory: parsedResponse.category,
                                validCategories: categories,
                                fullResponse: parsedResponse
                            });
                        }
                    } else {
                        appLogger.error('Missing required fields in response:', {
                            hasCategory: !!parsedResponse.category,
                            hasActivity: !!parsedResponse.activity,
                            fullResponse: parsedResponse
                        });
                    }
                } catch (parseError) {
                    appLogger.error('Error parsing JSON response:', {
                        error: parseError.message,
                        rawResponse: result.text,
                        stack: parseError.stack
                    });
                }
            } catch (geminiError) {
                appLogger.error('Error in Gemini content generation:', {
                    message: geminiError.message,
                    status: geminiError.status,
                    statusText: geminiError.statusText,
                    stack: geminiError.stack,
                    fullError: geminiError
                });
            }
        } catch (geminiError) {
            appLogger.error('Error in Gemini analysis (outer catch):', {
                message: geminiError.message,
                status: geminiError.status,
                statusText: geminiError.statusText,
                stack: geminiError.stack,
                fullError: geminiError
            });
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
                thumbnailBuffer,
                response.description
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


// Add this helper function
function pauseTracking() {
  stopTracking();
  ai = null;
  if (mainWindow) {
    mainWindow.webContents.send('tracking-paused');
  }
}

// Helper functions for state management
function getCurrentDate() {
  return currentDate;
}

function setCurrentDate(newDate) {
  currentDate = newDate;
}

function getIsTracking() {
  return isTracking;
}

function setIsTracking(tracking) {
  isTracking = tracking;
}

function setIsQuitting(quitting) {
  isQuitting = quitting;
}

// Scheduler management functions
function startTracking() {
  if (!scheduler || !ai) {
    return false;
  }
  
  isTracking = true;
  scheduler.start(captureAndAnalyze);
  return true;
}

function stopTracking() {
  if (scheduler) {
    scheduler.stop();
  }
  isTracking = false;
}

function updateSchedulerInterval(newInterval) {
  if (scheduler) {
    scheduler.updateInterval(newInterval);
  }
}

function getSchedulerStatus() {
  return scheduler ? scheduler.getStatus() : null;
}

// Add this helper function for the countdown
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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



app.whenReady().then(async () => {
    try {
        appLogger = logger.createLogger();
        screenshotCapture = new ScreenshotCapture(appLogger);
        
        // Initialize the simple robust scheduler
        scheduler = new SimpleRobustScheduler(appLogger, {
            intervalMinutes: store.get('interval'),
            maxRetries: 2,
            idleThresholdMinutes: store.get('interval') // Skip if idle for interval duration
        });
        
        await handleFirstRun();
        await database.initializeDatabase();
        createWindow();
        createTray();
        initializeIdleMonitor();
        
        // Initialize IPC handlers
        initializeIpcHandlers({
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
            getSchedulerStatus
        });
        
        // Only start tracking if API key exists
        const apiKey = store.get('apiKey');
        if (apiKey) {
            await initializeGeminiAPI(apiKey);
            startTracking();
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
    if (scheduler) {
        scheduler.stop();
    }
    await database.closeDatabase();
    if (tray) {
        tray.destroy();
    }
});


