// File: main.js
const { app, BrowserWindow, ipcMain, screen, powerMonitor, Tray, Menu } = require('electron');
const path = require('path');
const Store = require('electron-store');
const schedule = require('node-schedule');
const screenshot = require('screenshot-desktop');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GoogleAIFileManager } = require('@google/generative-ai/server');
const fs = require('fs');
const sharp = require('sharp');
const store = new Store({
    defaults: {
        interval: 1 // Default to 1 minute
    }
});
const { windowManager } = require('node-window-manager');
const sqlite3 = require('sqlite3').verbose();
const AutoLaunch = require('auto-launch');
const winston = require('winston');
const { format } = winston;

let mainWindow;
let isTracking = false;
let genAI;
let model;
let fileManager;

const DEBUG = true;

// Add this near the top with other global variables
let currentDate = new Date();
let db;

// Add this global variable with your other ones
let lastActiveTime = Date.now();

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

// Initialize database
function initializeDatabase() {
    return new Promise((resolve, reject) => {
        const dbPath = path.join(app.getPath('userData'), 'screenshots.db');
        db = new sqlite3.Database(dbPath, (err) => {
            if (err) {
                console.error('Database initialization error:', err);
                reject(err);
                return;
            }

            // Create screenshots table
            db.run(`
                CREATE TABLE IF NOT EXISTS screenshots (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT NOT NULL,
                    category TEXT NOT NULL,
                    activity TEXT NOT NULL,
                    image_data BLOB NOT NULL,
                    thumbnail_data BLOB NOT NULL,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP
                )
            `, (err) => {
                if (err) {
                    console.error('Table creation error:', err);
                    reject(err);
                    return;
                }
                resolve();
            });
        });
    });
}

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
    icon: path.join(__dirname, 'assets/icon.ico'),
  });

  mainWindow.loadFile('index.html');
  
  mainWindow.webContents.on('did-finish-load', async () => {
    try {
      currentDate = new Date();
      
      const initialData = await getActivityStats();
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
    genAI = new GoogleGenerativeAI(apiKey);
    model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-lite" });
    
    // Test the API key with a simple request
    const result = await model.generateContent('Hello, this is a test message.');
    const response = await result.response;
    
    if (response) {
      fileManager = new GoogleAIFileManager(apiKey);
      store.set('apiKey', apiKey);
      return { success: true };
    }
    return { success: false, error: 'Invalid API response' };
  } catch (error) {
    console.error('API validation error:', error);
    return { 
      success: false, 
      error: error.message || 'Invalid API key'
    };
  }
}

// Categories for classification
const categories = [
  'WORK',           // Professional tasks, productivity
  'LEARN',          // Education, tutorials, research
  'SOCIAL',         // Meetings, chat, emails, social media
  'ENTERTAINMENT'   // Games, videos, browsing for fun
];

// Add this function to create screenshots directory if it doesn't exist
function ensureScreenshotDirectory() {
  const screenshotDir = path.join(app.getPath('userData'), 'screenshots');
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir);
  }
  return screenshotDir;
}

// Modify the captureAndAnalyze function
async function captureAndAnalyze() {
    try {
        const idleTime = powerMonitor.getSystemIdleTime();
        const idleMinutes = idleTime / 60;
        const interval = store.get('interval');

        if (idleMinutes >= interval) {
            logger.info(`User idle for ${idleMinutes.toFixed(1)} minutes. Skipping screenshot.`);
            return;
        }

        logger.info('Starting capture and analyze process...');
        
        const now = new Date();
        const timestamp = now.toISOString();
        logger.info('Created timestamp:', timestamp);

        // Get active window and display information
        const activeWindow = windowManager.getActiveWindow();
        const displays = screen.getAllDisplays();
        let imgBuffer;
        
        if (activeWindow) {
            const windowBounds = activeWindow.getBounds();
            
            // Get all available displays from screenshot-desktop
            const availableDisplays = await screenshot.listDisplays();

            // Find the display with the most overlap
            let maxOverlap = 0;
            let targetDisplayId = null;

            displays.forEach((display, index) => {
                const dBounds = display.bounds;
                const xOverlap = Math.max(0, 
                    Math.min(windowBounds.x + windowBounds.width, dBounds.x + dBounds.width) - 
                    Math.max(windowBounds.x, dBounds.x)
                );
                
                const yOverlap = Math.max(0,
                    Math.min(windowBounds.y + windowBounds.height, dBounds.y + dBounds.height) - 
                    Math.max(windowBounds.y, dBounds.y)
                );
                
                const overlapArea = xOverlap * yOverlap;

                if (overlapArea > maxOverlap) {
                    maxOverlap = overlapArea;
                    targetDisplayId = availableDisplays[index].id;
                }
            });

            if (targetDisplayId) {
                imgBuffer = await screenshot({ screen: targetDisplayId });
            }
        }

        // Fallback to primary display if needed
        if (!imgBuffer) {
            const displays = await screenshot.listDisplays();
            imgBuffer = await screenshot({ screen: displays[0].id });
        }

        // Create thumbnail using sharp
        const thumbnailBuffer = await sharp(imgBuffer)
            .resize(200, 150, { fit: 'inside' })
            .toBuffer();
        
        logger.info('Processing screenshot with Gemini...');
        
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

            logger.info('Gemini file upload successful');

            const generationConfig = {
                temperature: 1,
                maxOutputTokens: 8192,
                responseMimeType: "application/json"
            };

            logger.info('Starting Gemini analysis...');
            const chatSession = model.startChat({ generationConfig });
            
            const prompt = `Analyze this screenshot and categorize the activity based on the user's apparent task.
            Return a JSON object with "category" and "activity" fields, where category must be one of: 
            ${categories.join(', ')}. 
            Focus on the purpose of the activity rather than the specific application.
            For example:
            - Games, videos, entertainment live streams, YouTube, social media content consumption, casual browsing, or scrolling would be "ENTERTAINMENT" (even if user is commenting/chatting on entertainment content)
            - Coding, documents, or professional tasks would be "WORK"
            - Online courses, tutorials, or research would be "LEARN"
            - Meetings, direct messaging, emails, or professional/personal communication would be "SOCIAL" (IMPORTANT: interactions on entertainment platforms like YouTube comments, Twitch chat, or social media entertainment content are NOT social - they count as ENTERTAINMENT)

            Example response: {"category": "WORK", "activity": "software development"}`;

            const result = await chatSession.sendMessage([
                {
                    fileData: {
                        mimeType: 'image/png',
                        fileUri: uploadResult.file.uri
                    }
                },
                { text: prompt }
            ]);

            logger.info('Received Gemini response:', result.response.text());
            response = JSON.parse(result.response.text());
            
        } catch (geminiError) {
            logger.error('Error in Gemini analysis (will continue with fallback):', geminiError.message);
            // Keep the default response - don't throw error
        } finally {
            // Clean up temp file
            if (tempFilePath && fs.existsSync(tempFilePath)) {
                try {
                    fs.unlinkSync(tempFilePath);
                } catch (cleanupError) {
                    logger.error('Error cleaning up temp file:', cleanupError.message);
                }
            }
        }

        // Store in database - wrap in try-catch to prevent database errors from breaking the schedule
        try {
            await new Promise((resolve) => {
                db.run(`
                    INSERT INTO screenshots (
                        timestamp, 
                        category, 
                        activity, 
                        image_data, 
                        thumbnail_data
                    ) VALUES (?, ?, ?, ?, ?)
                `, [
                    timestamp,
                    response.category,
                    response.activity,
                    imgBuffer,
                    thumbnailBuffer
                ], async function(err) {
                    if (err) {
                        logger.error('Error saving to database:', err);
                        // Don't reject - just log and continue
                        resolve();
                        return;
                    }
                    
                    // Try to update UI, but don't let it break the process
                    try {
                        const updatedData = await getActivityStats();
                        
                        if (mainWindow && !mainWindow.isDestroyed()) {
                            mainWindow.webContents.send('activity-updated', updatedData);
                            setTimeout(() => {
                                mainWindow.webContents.send('refresh-ui');
                            }, 100);
                        }
                    } catch (uiError) {
                        logger.error('Error updating UI (non-critical):', uiError.message);
                    }
                    
                    resolve();
                });
            });
        } catch (dbError) {
            logger.error('Database operation failed (non-critical):', dbError.message);
        }

        logger.info('Screenshot capture and analysis completed successfully');

    } catch (error) {
        logger.error('Error in capture and analyze:', error);
        logger.error('Stack trace:', error.stack);
        // Don't throw - let the schedule continue regardless of any errors
    }
}

// Calculate activity statistics
function getActivityStats() {
    return new Promise((resolve, reject) => {
        const startOfDay = new Date(currentDate);
        startOfDay.setHours(0, 0, 0, 0);
        
        const endOfDay = new Date(currentDate);
        endOfDay.setHours(23, 59, 59, 999);

        db.all(`
            SELECT * FROM screenshots 
            WHERE timestamp BETWEEN ? AND ?
            ORDER BY timestamp DESC
        `, [
            startOfDay.toISOString(),
            endOfDay.toISOString()
        ], (err, screenshots) => {
            if (err) {
                console.error('Error getting screenshots:', err);
                reject(err);
                return;
            }

            screenshots = screenshots || [];

            // Initialize stats object
            const stats = {};
            const timeInHours = {};
            categories.forEach(category => {
                stats[category] = 0;
                timeInHours[category] = 0;
            });

            if (screenshots.length > 0) {
                const categoryCounts = {};
                categories.forEach(category => {
                    categoryCounts[category] = screenshots.filter(
                        shot => shot.category === category
                    ).length;
                });

                const totalScreenshots = screenshots.length;
                const interval = store.get('interval'); // Get interval in minutes
                
                categories.forEach(category => {
                    stats[category] = totalScreenshots > 0 
                        ? (categoryCounts[category] / totalScreenshots) * 100 
                        : 0;
                    // Calculate hours based on interval and count
                    timeInHours[category] = (categoryCounts[category] * interval) / 60;
                });
            }

            const processedScreenshots = screenshots.map(screenshot => ({
                id: screenshot.id,
                timestamp: screenshot.timestamp,
                category: screenshot.category,
                activity: screenshot.activity,
                thumbnail: `data:image/png;base64,${screenshot.thumbnail_data.toString('base64')}`
            }));

            const result = {
                stats,
                timeInHours, // Add the time data to the result
                screenshots: processedScreenshots
            };

            resolve(result);
        });
    });
}

// Add this new function to get screenshot history
function getScreenshotHistory() {
  const activityData = store.get('activityData') || [];
  return activityData.map(activity => ({
    timestamp: activity.timestamp,
    category: activity.category,
    activity: activity.activity,
    thumbnail: activity.screenshot.thumbnail
  })).reverse(); // Most recent first
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
    const data = await getActivityStats();
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
    const data = await getActivityStats();
    return {
        stats: data.stats,
        timeInHours: data.timeInHours,
        screenshots: data.screenshots
    };
});

// Add this IPC handler to allow manual refresh requests
ipcMain.handle('request-refresh', async () => {
    try {
        const data = await getActivityStats();
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
    tray = new Tray(path.join(__dirname, 'assets/icon.ico'));
    
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
            icon: path.join(__dirname, 'assets/icon.ico'),
            iconType: 'custom'
        });
        hasShownMinimizeNotification = true;
    }
}

// Add after other global variables
let logger;

// Add this function near the top of the file
function initializeLogger() {
    const logPath = path.join(app.getPath('userData'), 'logs');
    if (!fs.existsSync(logPath)) {
        fs.mkdirSync(logPath);
    }

    logger = winston.createLogger({
        format: format.combine(
            format.timestamp(),
            format.printf(({ level, message, timestamp }) => {
                return `${timestamp} [${level.toUpperCase()}]: ${message}`;
            })
        ),
        transports: [
            new winston.transports.File({ 
                filename: path.join(logPath, 'error.log'), 
                level: 'error' 
            }),
            new winston.transports.File({ 
                filename: path.join(logPath, 'combined.log'),
                maxsize: 5242880, // 5MB
                maxFiles: 5,
                tailable: true
            })
        ]
    });

    // Also log to console in development
    if (DEBUG) {
        logger.add(new winston.transports.Console({
            format: format.simple()
        }));
    }

    // Replace console.log and console.error with logger
    console.log = (...args) => logger.info(args.join(' '));
    console.error = (...args) => logger.error(args.join(' '));
}

// Add these IPC handlers
ipcMain.handle('open-logs', () => {
    const logPath = path.join(app.getPath('userData'), 'logs', 'combined.log');
    if (fs.existsSync(logPath)) {
        require('electron').shell.openPath(logPath);
        return true;
    }
    return false;
});

ipcMain.handle('get-recent-logs', async () => {
    try {
        const logPath = path.join(app.getPath('userData'), 'logs', 'combined.log');
        if (!fs.existsSync(logPath)) {
            return [];
        }

        // Read last 1000 lines of logs
        const logs = fs.readFileSync(logPath, 'utf8')
            .split('\n')
            .filter(Boolean)
            .slice(-1000);
        
        return logs;
    } catch (error) {
        logger.error('Error reading logs:', error);
        return [];
    }
});

app.whenReady().then(async () => {
    try {
        initializeLogger();
        await handleFirstRun();
        await initializeDatabase();
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
app.on('will-quit', () => {
    if (db) {
        db.close((err) => {
            if (err) {
                console.error('Error closing database:', err);
            }
        });
    }
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
    return new Promise((resolve, reject) => {
        db.run('DELETE FROM screenshots WHERE id = ?', [id], function(err) {
            if (err) {
                console.error('Error deleting screenshot:', err);
                resolve(false);
                return;
            }
            resolve(true);
        });
    });
});

// Add this IPC handler near your other IPC handlers
ipcMain.handle('quit-app', () => {
    isQuitting = true;
    app.quit();
});
