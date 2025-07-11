import { getConnection } from './core';
import type { Category } from './core';

interface Screenshot {
    id: number;
    timestamp: string;
    category: Category;
    activity: string;
    description?: string;
    image_data?: Buffer;
    thumbnail_data?: Buffer;
    created_at?: string;
}

interface ProcessedScreenshot {
    id: number;
    timestamp: string;
    category: Category;
    activity: string;
    description: string;
    thumbnail: string;
}

interface ScreenshotTiming {
    timestamp: string;
    category: Category;
    next_timestamp?: string;
}

/**
 * Save a new screenshot to the database
 * @param timestamp - Screenshot timestamp
 * @param category - Activity category
 * @param activity - Activity description
 * @param imageBuffer - Full image data
 * @param thumbnailBuffer - Thumbnail image data
 * @param description - Screenshot description
 * @returns The ID of the inserted screenshot
 */
export function saveScreenshot(
    timestamp: string,
    category: Category,
    activity: string,
    imageBuffer: Buffer,
    thumbnailBuffer: Buffer,
    description: string
): Promise<number> {
    return new Promise((resolve, reject) => {
        const db = getConnection();
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

/**
 * Delete a screenshot by ID
 * @param id - Screenshot ID
 * @returns True if deleted, false otherwise
 */
export function deleteScreenshot(id: number): Promise<boolean> {
    return new Promise((resolve, reject) => {
        const db = getConnection();
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

/**
 * Load more screenshots with pagination
 * @param currentDate - Date to get screenshots for
 * @param offset - Number of screenshots to skip
 * @param limit - Maximum number of screenshots to return
 * @returns Array of screenshot objects
 */
export function getMoreScreenshots(
    currentDate: Date,
    offset: number = 0,
    limit: number = 50
): Promise<ProcessedScreenshot[]> {
    return new Promise((resolve, reject) => {
        const db = getConnection();
        const startOfDay = new Date(currentDate);
        startOfDay.setHours(0, 0, 0, 0);
        
        const endOfDay = new Date(currentDate);
        endOfDay.setHours(23, 59, 59, 999);

        db.all<Screenshot>(`
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
                description: screenshot.description || '',
                thumbnail: `data:image/png;base64,${screenshot.thumbnail_data!.toString('base64')}`
            }));

            resolve(processedScreenshots);
        });
    });
}

/**
 * Get screenshots for a specific date (used in activity stats)
 * @param currentDate - Date to get screenshots for
 * @returns Array of screenshot objects with thumbnails
 */
export function getScreenshotsForDate(currentDate: Date): Promise<ProcessedScreenshot[]> {
    return new Promise((resolve, reject) => {
        const db = getConnection();
        const localDate = new Date(currentDate);
        const year = localDate.getFullYear();
        const month = localDate.getMonth();
        const day = localDate.getDate();

        const startOfDay = new Date(year, month, day, 0, 0, 0, 0);
        const endOfDay = new Date(year, month, day, 23, 59, 59, 999);

        db.all<Screenshot>(`
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
                description: screenshot.description || '',
                thumbnail: `data:image/png;base64,${screenshot.thumbnail_data!.toString('base64')}`
            }));

            resolve(processedScreenshots);
        });
    });
}

/**
 * Get time-based screenshot data for statistics calculation
 * @param currentDate - Date to get screenshots for
 * @returns Array of screenshot timing data
 */
export function getScreenshotTimingData(currentDate: Date): Promise<ScreenshotTiming[]> {
    return new Promise((resolve, reject) => {
        const db = getConnection();
        const localDate = new Date(currentDate);
        const year = localDate.getFullYear();
        const month = localDate.getMonth();
        const day = localDate.getDate();

        const startOfDay = new Date(year, month, day, 0, 0, 0, 0);
        const endOfDay = new Date(year, month, day, 23, 59, 59, 999);

        db.all<ScreenshotTiming>(`
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

            resolve(timeResults || []);
        });
    });
}

/**
 * Get screenshot data for day analysis
 * @param date - Date to get screenshots for
 * @returns Array of screenshot metadata
 */
export function getScreenshotsForAnalysis(date: Date): Promise<Screenshot[]> {
    return new Promise((resolve, reject) => {
        const db = getConnection();
        const localDate = new Date(date);
        const year = localDate.getFullYear();
        const month = localDate.getMonth();
        const day = localDate.getDate();

        const startOfDay = new Date(year, month, day, 0, 0, 0, 0);
        const endOfDay = new Date(year, month, day, 23, 59, 59, 999);

        db.all<Screenshot>(`
            SELECT timestamp, category, activity, description
            FROM screenshots 
            WHERE timestamp BETWEEN ? AND ?
            ORDER BY timestamp ASC
        `, [startOfDay.toISOString(), endOfDay.toISOString()], 
        (err, screenshots) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(screenshots || []);
        });
    });
}

/**
 * Get screenshots for export
 * @param startDate - Start date for export
 * @param endDate - End date for export
 * @param includeMedia - Whether to include image data
 * @returns Array of screenshot data
 */
export function getScreenshotsForExport(
    startDate: Date,
    endDate: Date,
    includeMedia: boolean = false
): Promise<Screenshot[]> {
    return new Promise((resolve, reject) => {
        const db = getConnection();
        const fields = [
            'id',
            'timestamp',
            'category',
            'activity',
            'description'
        ];

        if (includeMedia) {
            fields.push('image_data', 'thumbnail_data');
        }

        db.all<Screenshot>(`
            SELECT ${fields.join(', ')}
            FROM screenshots 
            WHERE timestamp BETWEEN ? AND ?
            ORDER BY timestamp ASC
        `, [
            startDate.toISOString(),
            endDate.toISOString()
        ], (err, screenshots) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(screenshots || []);
        });
    });
}

/**
 * Get metadata for the last N screenshots
 * @param n - Number of screenshots to get
 * @returns Array of screenshot metadata
 */
export function getLastNScreenshotsMetadata(n: number = 10): Promise<Screenshot[]> {
    return new Promise((resolve, reject) => {
        const db = getConnection();
        db.all<Screenshot>(`
            SELECT id, timestamp, category, activity, description
            FROM screenshots 
            ORDER BY timestamp DESC
            LIMIT ?
        `, [n], (err, screenshots) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(screenshots || []);
        });
    });
} 