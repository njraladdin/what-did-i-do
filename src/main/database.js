const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { app } = require('electron');

let db;

// Categories for classification
const categories = [
    'WORK',           // Professional tasks, productivity
    'LEARN',          // Education, tutorials, research
    'SOCIAL',         // Meetings, chat, emails, social media
    'ENTERTAINMENT',  // Games, videos, browsing for fun
    'OTHER',          // Tasks that don't fit other categories
    'UNKNOWN'         // Internal use only - for failed analyses, not shown in UI
];

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
                    description TEXT,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP
                )
            `, (err) => {
                if (err) {
                    console.error('Table creation error:', err);
                    reject(err);
                    return;
                }
                
                // Create diary_logs table
                db.run(`
                    CREATE TABLE IF NOT EXISTS diary_logs (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        date TEXT NOT NULL,
                        timestamp TEXT NOT NULL,
                        title TEXT,
                        content TEXT NOT NULL,
                        mood TEXT,
                        tags TEXT,
                        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
                    )
                `, (err) => {
                    if (err) {
                        console.error('Diary logs table creation error:', err);
                        reject(err);
                        return;
                    }
                    
                    // Add description column if it doesn't exist (for existing databases)
                    db.run(`ALTER TABLE screenshots ADD COLUMN description TEXT`, (err) => {
                        // Ignore error if column already exists
                        if (err && !err.message.includes('duplicate column name')) {
                            console.error('Column addition error:', err);
                        }
                        
                        // Create index on timestamp for faster date filtering
                        db.run(`
                            CREATE INDEX IF NOT EXISTS idx_screenshots_timestamp 
                            ON screenshots(timestamp)
                        `, (err) => {
                            if (err) {
                                console.error('Index creation error:', err);
                                reject(err);
                                return;
                            }
                            
                            // Create composite index for timestamp and category aggregations
                            db.run(`
                                CREATE INDEX IF NOT EXISTS idx_screenshots_timestamp_category 
                                ON screenshots(timestamp, category)
                            `, (err) => {
                                if (err) {
                                    console.error('Composite index creation error:', err);
                                    reject(err);
                                    return;
                                }
                                
                                // Create index on diary_logs date for faster filtering
                                db.run(`
                                    CREATE INDEX IF NOT EXISTS idx_diary_logs_date 
                                    ON diary_logs(date)
                                `, (err) => {
                                    if (err) {
                                        console.error('Diary logs index creation error:', err);
                                        reject(err);
                                        return;
                                    }
                                    resolve();
                                });
                            });
                        });
                    });
                });
            });
        });
    });
}

// Calculate activity statistics for a given date
function getActivityStats(currentDate, intervalMinutes) {
    return new Promise((resolve, reject) => {
        const startOfDay = new Date(currentDate);
        startOfDay.setHours(0, 0, 0, 0);
        
        const endOfDay = new Date(currentDate);
        endOfDay.setHours(23, 59, 59, 999);

        console.log('Calculating stats for date:', currentDate);
        console.log('Interval minutes:', intervalMinutes);

        // First, get all screenshots for the day ordered by timestamp to calculate actual durations
        db.all(`
            SELECT 
                timestamp,
                category,
                LEAD(timestamp) OVER (ORDER BY timestamp ASC) as next_timestamp
            FROM screenshots 
            WHERE timestamp BETWEEN ? AND ? AND category != 'UNKNOWN'
            ORDER BY timestamp ASC
        `, [
            startOfDay.toISOString(),
            endOfDay.toISOString()
        ], (err, timeResults) => {
            if (err) {
                console.error('Error getting time stats:', err);
                reject(err);
                return;
            }

            console.log('Total screenshots found:', timeResults.length);

            // Initialize stats object
            const stats = {};
            const timeInHours = {};
            const categoryMinutes = {};
            const categoryCounts = {};
            let totalScreenshots = 0;

            // Initialize stats for all categories except UNKNOWN
            categories.filter(category => category !== 'UNKNOWN').forEach(category => {
                stats[category] = 0;
                timeInHours[category] = 0;
                categoryMinutes[category] = 0;
                categoryCounts[category] = 0;
            });

            // Calculate time differences and sum up by category
            if (timeResults && timeResults.length > 0) {
                
                timeResults.forEach((row, index) => {
                    categoryCounts[row.category] = (categoryCounts[row.category] || 0) + 1;
                    totalScreenshots++;

                    // Calculate time difference if there's a next screenshot
                    if (row.next_timestamp) {
                        const currentTime = new Date(row.timestamp);
                        const nextTime = new Date(row.next_timestamp);
                        const diffMinutes = Math.abs((nextTime - currentTime) / (1000 * 60));


                        // Only count if difference is 5 minutes or less
                        if (diffMinutes <= 5) {
                            categoryMinutes[row.category] = (categoryMinutes[row.category] || 0) + diffMinutes;
                        } 
                    } else {
                        // For the last screenshot of a sequence, count a default duration
                        const defaultDuration = Math.min(intervalMinutes, 5);
                        categoryMinutes[row.category] = (categoryMinutes[row.category] || 0) + defaultDuration;
                    }

                });

                // Calculate percentages and convert minutes to hours
                categories.filter(category => category !== 'UNKNOWN').forEach(category => {
                    stats[category] = totalScreenshots > 0 
                        ? (categoryCounts[category] / totalScreenshots) * 100 
                        : 0;
                    timeInHours[category] = categoryMinutes[category] / 60;
                    
                });
            }

            // Then get screenshot details (without large image_data)
            db.all(`
                SELECT 
                    id,
                    timestamp,
                    category,
                    activity,
                    thumbnail_data,
                    description
                FROM screenshots 
                WHERE timestamp BETWEEN ? AND ? AND category != 'UNKNOWN'
                ORDER BY timestamp DESC
                LIMIT 100
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

                const processedScreenshots = screenshots.map(screenshot => ({
                    id: screenshot.id,
                    timestamp: screenshot.timestamp,
                    category: screenshot.category,
                    activity: screenshot.activity,
                    description: screenshot.description,
                    thumbnail: `data:image/png;base64,${screenshot.thumbnail_data.toString('base64')}`
                }));

                // Get diary logs for the current date
                getDiaryLogsForDate(currentDate).then(diaryLogs => {
                    const result = {
                        stats,
                        timeInHours,
                        screenshots: processedScreenshots,
                        diaryLogs: diaryLogs
                    };

                    resolve(result);
                }).catch(err => {
                    console.error('Error getting diary logs:', err);
                    // Still resolve with empty diary logs if there's an error
                    const result = {
                        stats,
                        timeInHours,
                        screenshots: processedScreenshots,
                        diaryLogs: []
                    };

                    resolve(result);
                });
            });
        });
    });
}

// Load more screenshots with pagination
function getMoreScreenshots(currentDate, offset = 0, limit = 50) {
    return new Promise((resolve, reject) => {
        const startOfDay = new Date(currentDate);
        startOfDay.setHours(0, 0, 0, 0);
        
        const endOfDay = new Date(currentDate);
        endOfDay.setHours(23, 59, 59, 999);

        db.all(`
            SELECT 
                id,
                timestamp,
                category,
                activity,
                thumbnail_data,
                description
            FROM screenshots 
            WHERE timestamp BETWEEN ? AND ?
            ORDER BY timestamp DESC
            LIMIT ? OFFSET ?
        `, [
            startOfDay.toISOString(),
            endOfDay.toISOString(),
            limit,
            offset
        ], (err, screenshots) => {
            if (err) {
                console.error('Error getting more screenshots:', err);
                reject(err);
                return;
            }

            screenshots = screenshots || [];

            const processedScreenshots = screenshots.map(screenshot => ({
                id: screenshot.id,
                timestamp: screenshot.timestamp,
                category: screenshot.category,
                activity: screenshot.activity,
                description: screenshot.description,
                thumbnail: `data:image/png;base64,${screenshot.thumbnail_data.toString('base64')}`
            }));

            resolve(processedScreenshots);
        });
    });
}

// Save a new screenshot to the database
function saveScreenshot(timestamp, category, activity, imageBuffer, thumbnailBuffer, description) {
    return new Promise((resolve, reject) => {
        db.run(`
            INSERT INTO screenshots (
                timestamp, 
                category, 
                activity, 
                image_data, 
                thumbnail_data,
                description
            ) VALUES (?, ?, ?, ?, ?, ?)
        `, [
            timestamp,
            category,
            activity,
            imageBuffer,
            thumbnailBuffer,
            description
        ], function(err) {
            if (err) {
                console.error('Error saving screenshot:', err);
                reject(err);
                return;
            }
            resolve(this.lastID);
        });
    });
}

// Delete a screenshot by ID
function deleteScreenshot(id) {
    return new Promise((resolve, reject) => {
        db.run('DELETE FROM screenshots WHERE id = ?', [id], function(err) {
            if (err) {
                console.error('Error deleting screenshot:', err);
                reject(err);
                return;
            }
            resolve(this.changes > 0);
        });
    });
}

// Check if there was a recent failed analysis

// Close database connection
function closeDatabase() {
    return new Promise((resolve) => {
        if (db) {
            db.close((err) => {
                if (err) {
                    console.error('Error closing database:', err);
                }
                resolve();
            });
        } else {
            resolve();
        }
    });
}

// Get monthly averages for each category
function getMonthlyAverages(currentDate, intervalMinutes) {
    return new Promise((resolve, reject) => {
        const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
        const endOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0, 23, 59, 59, 999);

        // Get all screenshots for the month
        db.all(`
            SELECT 
                timestamp,
                category,
                LEAD(timestamp) OVER (ORDER BY timestamp ASC) as next_timestamp
            FROM screenshots 
            WHERE timestamp BETWEEN ? AND ? AND category != 'UNKNOWN'
            ORDER BY timestamp ASC
        `, [
            startOfMonth.toISOString(),
            endOfMonth.toISOString()
        ], (err, timeResults) => {
            if (err) {
                console.error('Error getting monthly stats:', err);
                reject(err);
                return;
            }

            const monthlyAverages = {};
            const monthlyTimeInHours = {};
            const categoryMinutes = {};
            const categoryCounts = {};
            const uniqueDays = new Set();
            let totalScreenshots = 0;

            // Initialize stats for all categories except UNKNOWN
            categories.filter(category => category !== 'UNKNOWN').forEach(category => {
                monthlyAverages[category] = 0;
                monthlyTimeInHours[category] = 0;
                categoryMinutes[category] = 0;
                categoryCounts[category] = 0;
            });

            // Process results
            if (timeResults && timeResults.length > 0) {
                timeResults.forEach(row => {
                    // Track unique days
                    const day = new Date(row.timestamp).toISOString().split('T')[0];
                    uniqueDays.add(day);

                    // Count screenshots per category
                    categoryCounts[row.category] = (categoryCounts[row.category] || 0) + 1;
                    totalScreenshots++;

                    // Calculate time difference if there's a next screenshot
                    if (row.next_timestamp) {
                        const currentTime = new Date(row.timestamp);
                        const nextTime = new Date(row.next_timestamp);
                        const diffMinutes = Math.abs((nextTime - currentTime) / (1000 * 60));

                        // Only count if difference is 5 minutes or less
                        if (diffMinutes <= 5) {
                            categoryMinutes[row.category] = (categoryMinutes[row.category] || 0) + diffMinutes;
                        }
                    } else {
                        // For the last screenshot of a sequence, count a default duration
                        const defaultDuration = Math.min(intervalMinutes, 5);
                        categoryMinutes[row.category] = (categoryMinutes[row.category] || 0) + defaultDuration;
                    }
                });
                
                if (totalScreenshots > 0) {
                    categories.filter(category => category !== 'UNKNOWN').forEach(category => {
                        // Calculate average percentage
                        monthlyAverages[category] = (categoryCounts[category] / totalScreenshots) * 100;
                        
                        // Calculate total hours for the month
                        monthlyTimeInHours[category] = categoryMinutes[category] / 60;
                    });
                }
            }

            resolve({
                monthlyAverages,
                monthlyTimeInHours,
                daysWithData: uniqueDays.size
            });
        });
    });
}

// Export data for a specific date range with options
function exportData(startDate, endDate, includeMedia, includeStats) {
    return new Promise((resolve, reject) => {
        // Get all screenshots for the date range
        const query = `
            SELECT 
                id,
                timestamp,
                category,
                activity,
                ${includeMedia ? 'image_data, thumbnail_data,' : ''}
                description
            FROM screenshots 
            WHERE timestamp BETWEEN ? AND ? AND category != 'UNKNOWN'
            ORDER BY timestamp ASC
        `;

        db.all(query, [startDate.toISOString(), endDate.toISOString()], async (err, screenshots) => {
            if (err) {
                reject(err);
                return;
            }

            let result = {
                dateRange: {
                    startDate,
                    endDate
                },
                screenshots: screenshots || []
            };

            if (includeStats) {
                // Get statistics for the date range
                db.all(`
                    SELECT 
                        category,
                        COUNT(*) as count,
                        DATE(timestamp) as date
                    FROM screenshots 
                    WHERE timestamp BETWEEN ? AND ?
                    GROUP BY category, date
                    ORDER BY date DESC
                `, [startDate, endDate], (err, statResults) => {
                    if (err) {
                        console.error('Error getting export stats:', err);
                        reject(err);
                        return;
                    }

                    // Process stats into a more usable format
                    const dailyStats = {};
                    const overallStats = {};
                    categories.forEach(category => {
                        overallStats[category] = 0;
                    });

                    if (statResults && statResults.length > 0) {
                        statResults.forEach(row => {
                            if (!dailyStats[row.date]) {
                                dailyStats[row.date] = {};
                                categories.forEach(category => {
                                    dailyStats[row.date][category] = 0;
                                });
                            }
                            dailyStats[row.date][row.category] = row.count;
                            overallStats[row.category] += row.count;
                        });
                    }

                    result.statistics = {
                        overall: overallStats,
                        daily: dailyStats
                    };

                    resolve(result);
                });
            } else {
                resolve(result);
            }
        });
    });
}

// Diary logs functions
function saveDiaryLog(date, title, content, mood, tags) {
    return new Promise((resolve, reject) => {
        const timestamp = new Date().toISOString();
        const dateStr = new Date(date).toISOString().split('T')[0]; // Format as YYYY-MM-DD
        
        db.run(`
            INSERT INTO diary_logs (
                date, 
                timestamp, 
                title, 
                content, 
                mood, 
                tags,
                updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
            dateStr,
            timestamp,
            title,
            content,
            mood,
            tags,
            timestamp
        ], function(err) {
            if (err) {
                console.error('Error saving diary log:', err);
                reject(err);
                return;
            }
            resolve(this.lastID);
        });
    });
}

function getDiaryLogsForDate(date) {
    return new Promise((resolve, reject) => {
        const dateStr = new Date(date).toISOString().split('T')[0]; // Format as YYYY-MM-DD
        
        db.all(`
            SELECT 
                id,
                date,
                timestamp,
                title,
                content,
                mood,
                tags,
                created_at,
                updated_at
            FROM diary_logs 
            WHERE date = ?
            ORDER BY timestamp DESC
        `, [dateStr], (err, logs) => {
            if (err) {
                console.error('Error getting diary logs:', err);
                reject(err);
                return;
            }
            
            const processedLogs = (logs || []).map(log => ({
                id: log.id,
                date: log.date,
                timestamp: log.timestamp,
                title: log.title,
                content: log.content,
                mood: log.mood,
                tags: log.tags ? log.tags.split(',') : [],
                created_at: log.created_at,
                updated_at: log.updated_at
            }));
            
            resolve(processedLogs);
        });
    });
}

function updateDiaryLog(id, title, content, mood, tags) {
    return new Promise((resolve, reject) => {
        const timestamp = new Date().toISOString();
        
        db.run(`
            UPDATE diary_logs 
            SET title = ?, content = ?, mood = ?, tags = ?, updated_at = ?
            WHERE id = ?
        `, [
            title,
            content,
            mood,
            tags,
            timestamp,
            id
        ], function(err) {
            if (err) {
                console.error('Error updating diary log:', err);
                reject(err);
                return;
            }
            resolve(this.changes > 0);
        });
    });
}

function deleteDiaryLog(id) {
    return new Promise((resolve, reject) => {
        db.run('DELETE FROM diary_logs WHERE id = ?', [id], function(err) {
            if (err) {
                console.error('Error deleting diary log:', err);
                reject(err);
                return;
            }
            resolve(this.changes > 0);
        });
    });
}

function getDiaryLogsInRange(startDate, endDate) {
    return new Promise((resolve, reject) => {
        const startDateStr = new Date(startDate).toISOString().split('T')[0];
        const endDateStr = new Date(endDate).toISOString().split('T')[0];
        
        db.all(`
            SELECT 
                id,
                date,
                timestamp,
                title,
                content,
                mood,
                tags,
                created_at,
                updated_at
            FROM diary_logs 
            WHERE date BETWEEN ? AND ?
            ORDER BY date DESC, timestamp DESC
        `, [startDateStr, endDateStr], (err, logs) => {
            if (err) {
                console.error('Error getting diary logs in range:', err);
                reject(err);
                return;
            }
            
            const processedLogs = (logs || []).map(log => ({
                id: log.id,
                date: log.date,
                timestamp: log.timestamp,
                title: log.title,
                content: log.content,
                mood: log.mood,
                tags: log.tags ? log.tags.split(',') : [],
                created_at: log.created_at,
                updated_at: log.updated_at
            }));
            
            resolve(processedLogs);
        });
    });
}

module.exports = {
    initializeDatabase,
    getActivityStats,
    getMoreScreenshots,
    saveScreenshot,
    deleteScreenshot,
    closeDatabase,
    categories,
    getMonthlyAverages,
    exportData,
    saveDiaryLog,
    getDiaryLogsForDate,
    updateDiaryLog,
    deleteDiaryLog,
    getDiaryLogsInRange
}; 