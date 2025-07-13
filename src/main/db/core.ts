import sqlite3 from 'sqlite3';
import path from 'path';
import { app } from 'electron';

let db: sqlite3.Database | null = null;

// Categories for classification
export const categories = [
    'WORK',           // Professional tasks, productivity
    'LEARN',          // Education, tutorials, research
    'SOCIAL',         // Meetings, chat, emails, social media
    'ENTERTAINMENT',  // Games, videos, browsing for fun
    'OTHER',          // Tasks that don't fit other categories
    'UNKNOWN'         // Internal use only - for failed analyses, not shown in UI
] as const;

export type Category = typeof categories[number];

/**
 * Get the database connection instance
 * @returns The database instance
 */
export function getConnection(): sqlite3.Database {
    if (!db) {
        throw new Error('Database not initialized. Call initializeDatabase() first.');
    }
    return db;
}

/**
 * Initialize the database connection and create all tables
 */
export async function initializeDatabase(): Promise<void> {
    const dbPath = path.join(app.getPath('userData'), 'whatdidido.db');
    return new Promise<void>((resolve, reject) => {
        const sqlite = sqlite3.verbose();
        db = new sqlite.Database(dbPath, async (err: Error | null) => {
            if (err) {
                console.error('Database initialization error:', err);
                reject(err);
                return;
            }

            try {
                // Create notes table
                await new Promise<void>((resolve, reject) => {
                    db!.run(`
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
                await new Promise<void>((resolve, reject) => {
                    db!.run(`
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
                await new Promise<void>((resolve, reject) => {
                    db!.run(`
                        CREATE TABLE IF NOT EXISTS screenshots (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            timestamp TEXT NOT NULL,
                            category TEXT NOT NULL,
                            activity TEXT NOT NULL,
                            image_data BLOB NOT NULL,
                            thumbnail_data BLOB NOT NULL,
                            description TEXT,
                            tags TEXT,
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
                await new Promise<void>((resolve, reject) => {
                    db!.run(`
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

                // Add 'tags' column to screenshots table if it doesn't exist
                await new Promise<void>((resolve, reject) => {
                    db!.all("PRAGMA table_info(screenshots)", (err, columns) => {
                        if (err) {
                            console.error('Error getting table info:', err);
                            return reject(err);
                        }

                        const hasTagsColumn = columns.some((col: any) => col.name === 'tags');
                        if (!hasTagsColumn) {
                            db!.run("ALTER TABLE screenshots ADD COLUMN tags TEXT", (err) => {
                                if (err) {
                                    console.error('Error adding tags column:', err);
                                    return reject(err);
                                }
                                resolve();
                            });
                        } else {
                            resolve();
                        }
                    });
                });

                // Create indices
                await Promise.all([
                    new Promise<void>((resolve, reject) => {
                        db!.run(`
                            CREATE INDEX IF NOT EXISTS idx_screenshots_timestamp 
                            ON screenshots(timestamp)
                        `, (err) => err ? reject(err) : resolve());
                    }),
                    new Promise<void>((resolve, reject) => {
                        db!.run(`
                            CREATE INDEX IF NOT EXISTS idx_screenshots_timestamp_category 
                            ON screenshots(timestamp, category)
                        `, (err) => err ? reject(err) : resolve());
                    }),
                    new Promise<void>((resolve, reject) => {
                        db!.run(`
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
 */
export async function closeDatabase(): Promise<void> {
    return new Promise<void>((resolve) => {
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