const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { app } = require('electron');

let db = null;

// Categories for classification
const categories = [
    'WORK',           // Professional tasks, productivity
    'LEARN',          // Education, tutorials, research
    'SOCIAL',         // Meetings, chat, emails, social media
    'ENTERTAINMENT',  // Games, videos, browsing for fun
    'OTHER',          // Tasks that don't fit other categories
    'UNKNOWN'         // Internal use only - for failed analyses, not shown in UI
];

/**
 * Get the database connection instance
 * @returns {sqlite3.Database} The database instance
 */
function getConnection() {
    if (!db) {
        throw new Error('Database not initialized. Call initializeDatabase() first.');
    }
    return db;
}

/**
 * Initialize the database connection and create all tables
 * @returns {Promise<void>}
 */
function initializeDatabase() {
    return new Promise((resolve, reject) => {
        const dbPath = path.join(app.getPath('userData'), 'whatdidido.db');
        db = new sqlite3.Database(dbPath, async (err) => {
            if (err) {
                console.error('Database initialization error:', err);
                reject(err);
                return;
            }

            try {
                // Create notes table
                await new Promise((resolve, reject) => {
                    db.run(`
                        CREATE TABLE IF NOT EXISTS notes (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            date TEXT NOT NULL,
                            timestamp TEXT NOT NULL,
                            content TEXT NOT NULL,
                            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
                        )
                    `, (err) => {
                        if (err) {
                            console.error('Error creating notes table:', err);
                            reject(err);
                        } else {
                            resolve();
                        }
                    });
                });

                // Create notes index
                await new Promise((resolve, reject) => {
                    db.run(`
                        CREATE INDEX IF NOT EXISTS idx_notes_date 
                        ON notes(date)
                    `, (err) => {
                        if (err) {
                            console.error('Error creating notes index:', err);
                            reject(err);
                        } else {
                            resolve();
                        }
                    });
                });

                // Create screenshots table
                await new Promise((resolve, reject) => {
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
                        } else {
                            resolve();
                        }
                    });
                });

                // Create day_analyses table
                await new Promise((resolve, reject) => {
                    db.run(`
                        CREATE TABLE IF NOT EXISTS day_analyses (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            date TEXT NOT NULL,
                            timestamp TEXT NOT NULL,
                            content TEXT NOT NULL,
                            created_at TEXT DEFAULT CURRENT_TIMESTAMP
                        )
                    `, (err) => {
                        if (err) {
                            console.error('Day analyses table creation error:', err);
                            reject(err);
                        } else {
                            resolve();
                        }
                    });
                });

                // Create indices
                await Promise.all([
                    new Promise((resolve, reject) => {
                        db.run(`
                            CREATE INDEX IF NOT EXISTS idx_screenshots_timestamp 
                            ON screenshots(timestamp)
                        `, (err) => err ? reject(err) : resolve());
                    }),
                    new Promise((resolve, reject) => {
                        db.run(`
                            CREATE INDEX IF NOT EXISTS idx_screenshots_timestamp_category 
                            ON screenshots(timestamp, category)
                        `, (err) => err ? reject(err) : resolve());
                    }),
                    new Promise((resolve, reject) => {
                        db.run(`
                            CREATE INDEX IF NOT EXISTS idx_day_analyses_date 
                            ON day_analyses(date)
                        `, (err) => err ? reject(err) : resolve());
                    })
                ]);

                resolve();
            } catch (error) {
                console.error('Error during database initialization:', error);
                reject(error);
            }
        });
    });
}

/**
 * Close the database connection
 * @returns {Promise<void>}
 */
function closeDatabase() {
    return new Promise((resolve) => {
        if (db) {
            db.close((err) => {
                if (err) {
                    console.error('Error closing database:', err);
                }
                db = null;
                resolve();
            });
        } else {
            resolve();
        }
    });
}

module.exports = {
    getConnection,
    initializeDatabase,
    closeDatabase,
    categories
}; 