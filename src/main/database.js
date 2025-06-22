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
    'UNKNOWN'         // For failed analyses
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
                            resolve();
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

        // First, get statistics using aggregation (much faster)
        db.all(`
            SELECT 
                category,
                COUNT(*) as count
            FROM screenshots 
            WHERE timestamp BETWEEN ? AND ?
            GROUP BY category
        `, [
            startOfDay.toISOString(),
            endOfDay.toISOString()
        ], (err, statResults) => {
            if (err) {
                console.error('Error getting stats:', err);
                reject(err);
                return;
            }

            // Initialize stats object
            const stats = {};
            const timeInHours = {};
            categories.forEach(category => {
                stats[category] = 0;
                timeInHours[category] = 0;
            });

            let totalScreenshots = 0;
            const categoryCounts = {};
            
            // Process aggregated results
            if (statResults && statResults.length > 0) {
                statResults.forEach(row => {
                    categoryCounts[row.category] = row.count;
                    totalScreenshots += row.count;
                });
                
                categories.forEach(category => {
                    const count = categoryCounts[category] || 0;
                    stats[category] = totalScreenshots > 0 
                        ? (count / totalScreenshots) * 100 
                        : 0;
                    // Calculate hours based on interval and count
                    timeInHours[category] = (count * intervalMinutes) / 60;
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
                WHERE timestamp BETWEEN ? AND ?
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

                const result = {
                    stats,
                    timeInHours,
                    screenshots: processedScreenshots
                };

                resolve(result);
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
        startOfMonth.setHours(0, 0, 0, 0);
        
        const endOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
        endOfMonth.setHours(23, 59, 59, 999);

        // Get statistics using aggregation for the entire month
        db.all(`
            SELECT 
                category,
                COUNT(*) as count,
                strftime('%Y-%m-%d', timestamp) as day
            FROM screenshots 
            WHERE timestamp BETWEEN ? AND ?
            GROUP BY category, day
        `, [
            startOfMonth.toISOString(),
            endOfMonth.toISOString()
        ], (err, results) => {
            if (err) {
                console.error('Error getting monthly averages:', err);
                reject(err);
                return;
            }

            // Initialize stats objects
            const monthlyAverages = {};
            const monthlyTimeInHours = {};
            categories.forEach(category => {
                monthlyAverages[category] = 0;
                monthlyTimeInHours[category] = 0;
            });

            // Process results to get daily counts
            const dailyTotals = {};
            const categoryCounts = {};
            categories.forEach(category => {
                categoryCounts[category] = 0;
            });

            // Count unique days with data
            const uniqueDays = new Set();
            
            if (results && results.length > 0) {
                results.forEach(row => {
                    uniqueDays.add(row.day);
                    categoryCounts[row.category] = (categoryCounts[row.category] || 0) + row.count;
                    
                    // Track daily totals for percentage calculation
                    if (!dailyTotals[row.day]) {
                        dailyTotals[row.day] = 0;
                    }
                    dailyTotals[row.day] += row.count;
                });
                
                // Calculate the average percentage and time for each category
                const daysWithData = uniqueDays.size;
                
                if (daysWithData > 0) {
                    // Calculate total screenshots across all categories
                    const totalScreenshots = Object.values(categoryCounts).reduce((sum, count) => sum + count, 0);
                    
                    categories.forEach(category => {
                        const count = categoryCounts[category] || 0;
                        // Calculate average percentage
                        monthlyAverages[category] = totalScreenshots > 0 
                            ? (count / totalScreenshots) * 100 
                            : 0;
                        
                        // Calculate total hours for the month
                        monthlyTimeInHours[category] = (count * intervalMinutes) / 60;
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
        let query = `
            SELECT 
                id,
                timestamp,
                category,
                activity,
                description
        `;
        
        if (includeMedia) {
            query += `, image_data, thumbnail_data`;
        }
        
        query += `
            FROM screenshots 
            WHERE timestamp BETWEEN ? AND ?
            ORDER BY timestamp DESC
        `;

        db.all(query, [startDate, endDate], (err, screenshots) => {
            if (err) {
                console.error('Error exporting screenshots:', err);
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

module.exports = {
    initializeDatabase,
    getActivityStats,
    getMoreScreenshots,
    saveScreenshot,
    deleteScreenshot,
    closeDatabase,
    categories,
    getMonthlyAverages,
    exportData
}; 