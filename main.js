// File: main.js
const { app, BrowserWindow, ipcMain, screen, powerMonitor } = require('electron');
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
}

// Initialize Gemini API with file manager
async function initializeGeminiAPI(apiKey) {
  try {
    genAI = new GoogleGenerativeAI(apiKey);
    model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-002" });
    
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
        const idleMinutes = idleTime / 60; // Convert seconds to minutes
        const interval = store.get('interval');

        // If user has been idle for longer than the screenshot interval, skip
        if (idleMinutes >= interval) {
            console.log(`User idle for ${idleMinutes.toFixed(1)} minutes. Skipping screenshot.`);
            return;
        }

        console.log('Starting capture and analyze process...');
        
        const now = new Date();
        const timestamp = now.toISOString();
        console.log('Created timestamp:', timestamp);

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
        
        console.log('Processing screenshot with Gemini...');
        
        // Create a temporary file with a safe filename
        const safeTimestamp = timestamp.replace(/[:.]/g, '-');
        const tempFilePath = path.join(
            app.getPath('temp'), 
            `temp-screenshot-${safeTimestamp}.png`
        );

        try {
            // Ensure the temp directory exists
            fs.mkdirSync(path.dirname(tempFilePath), { recursive: true });
            // Write the file
            fs.writeFileSync(tempFilePath, imgBuffer);

            // Upload image to Gemini using the temporary file
            const uploadResult = await fileManager.uploadFile(tempFilePath, {
                mimeType: 'image/png',
                displayName: `screenshot-${safeTimestamp}.png`
            });

            console.log('Upload successful');

            const generationConfig = {
                temperature: 1,
                maxOutputTokens: 8192,
                responseMimeType: "application/json"
            };

            console.log('Starting Gemini analysis...');
            const chatSession = model.startChat({ generationConfig });
            
            const prompt = `Analyze this screenshot and categorize the activity based on the user's apparent task.
            Return a JSON object with "category" and "activity" fields, where category must be one of: 
            ${categories.join(', ')}. 
            Focus on the purpose of the activity rather than the specific application.
            For example:
            - Games, videos, or casual browsing or scrolling or social media consuming would be "ENTERTAINMENT"
            - Coding, documents, or professional tasks would be "WORK"
            - Online courses, tutorials, or research would be "LEARN"
            - Meetings, chat apps, or any social interactions would be "SOCIAL" (just browsing social media is not social)

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

            console.log('Received Gemini response:', result.response.text());
            const response = JSON.parse(result.response.text());

            // Store in database
            return new Promise((resolve, reject) => {
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
                        console.error('Error saving to database:', err);
                        reject(err);
                        return;
                    }
                    
                    try {
                        // Get updated stats for current date
                        const updatedData = await getActivityStats();
                        
                        // Send both notifications
                        if (mainWindow && !mainWindow.isDestroyed()) {
                            mainWindow.webContents.send('activity-updated', updatedData);
                            // Add a small delay before triggering refresh
                            setTimeout(() => {
                                mainWindow.webContents.send('refresh-ui');
                            }, 100);
                        }
                        resolve();
                    } catch (error) {
                        console.error('Error updating UI:', error);
                        reject(error);
                    }
                });
            });

        } finally {
            // Clean up temporary file
            if (fs.existsSync(tempFilePath)) {
                fs.unlinkSync(tempFilePath);
            }
        }

    } catch (error) {
        console.error('Error in capture and analyze:', error);
        console.error(error.stack);
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

app.whenReady().then(async () => {
    try {
        await handleFirstRun();
        await initializeDatabase();
        createWindow();
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
  if (mainWindow) mainWindow.close();
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
