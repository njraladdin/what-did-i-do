const { getConnection } = require('./core');

/**
 * Save a new screenshot to the database
 * @param {string} timestamp - Screenshot timestamp
 * @param {string} category - Activity category
 * @param {string} activity - Activity description
 * @param {Buffer} imageBuffer - Full image data
 * @param {Buffer} thumbnailBuffer - Thumbnail image data
 * @param {string} description - Screenshot description
 * @returns {Promise<number>} The ID of the inserted screenshot
 */
function saveScreenshot(timestamp, category, activity, imageBuffer, thumbnailBuffer, description) {
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
 * @param {number} id - Screenshot ID
 * @returns {Promise<boolean>} True if deleted, false otherwise
 */
function deleteScreenshot(id) {
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
 * @param {Date} currentDate - Date to get screenshots for
 * @param {number} offset - Number of screenshots to skip
 * @param {number} limit - Maximum number of screenshots to return
 * @returns {Promise<Array>} Array of screenshot objects
 */
function getMoreScreenshots(currentDate, offset = 0, limit = 50) {
    return new Promise((resolve, reject) => {
        const db = getConnection();
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

/**
 * Get screenshots for a specific date (used in activity stats)
 * @param {Date} currentDate - Date to get screenshots for
 * @returns {Promise<Array>} Array of screenshot objects with thumbnails
 */
function getScreenshotsForDate(currentDate) {
    return new Promise((resolve, reject) => {
        const db = getConnection();
        const localDate = new Date(currentDate);
        const year = localDate.getFullYear();
        const month = localDate.getMonth();
        const day = localDate.getDate();

        const startOfDay = new Date(year, month, day, 0, 0, 0, 0);
        const endOfDay = new Date(year, month, day, 23, 59, 59, 999);

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

            resolve(processedScreenshots);
        });
    });
}

/**
 * Get time-based screenshot data for statistics calculation
 * @param {Date} currentDate - Date to get screenshots for
 * @returns {Promise<Array>} Array of screenshot timing data
 */
function getScreenshotTimingData(currentDate) {
    return new Promise((resolve, reject) => {
        const db = getConnection();
        const localDate = new Date(currentDate);
        const year = localDate.getFullYear();
        const month = localDate.getMonth();
        const day = localDate.getDate();

        const startOfDay = new Date(year, month, day, 0, 0, 0, 0);
        const endOfDay = new Date(year, month, day, 23, 59, 59, 999);

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

            resolve(timeResults || []);
        });
    });
}

/**
 * Get screenshot data for day analysis
 * @param {Date} date - Date to get screenshots for
 * @returns {Promise<Array>} Array of screenshot metadata
 */
function getScreenshotsForAnalysis(date) {
    return new Promise((resolve, reject) => {
        const db = getConnection();
        const localDate = new Date(date);
        const year = localDate.getFullYear();
        const month = localDate.getMonth();
        const day = localDate.getDate();

        const startOfDay = new Date(year, month, day, 0, 0, 0, 0);
        const endOfDay = new Date(year, month, day, 23, 59, 59, 999);

        db.all(`
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
 * @param {Date} startDate - Start date for export
 * @param {Date} endDate - End date for export
 * @param {boolean} includeMedia - Whether to include image data
 * @returns {Promise<Array>} Array of screenshot data
 */
function getScreenshotsForExport(startDate, endDate, includeMedia = false) {
    return new Promise((resolve, reject) => {
        const db = getConnection();
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

        db.all(query, [startDate.toISOString(), endDate.toISOString()], (err, screenshots) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(screenshots || []);
        });
    });
}

/**
 * Get the last N screenshots metadata
 * @param {number} n - Number of screenshots to retrieve
 * @returns {Promise<Array>} Array of screenshot metadata
 */
function getLastNScreenshotsMetadata(n = 10) {
    return new Promise((resolve, reject) => {
        const db = getConnection();
        db.all(`
            SELECT 
                timestamp,
                category,
                activity,
                description
            FROM screenshots 
            WHERE category != 'UNKNOWN'
            ORDER BY timestamp DESC
            LIMIT ?
        `, [n], (err, screenshots) => {
            if (err) {
                console.error('Error getting last N screenshots:', err);
                reject(err);
                return;
            }
            resolve(screenshots || []);
        });
    });
}

module.exports = {
    saveScreenshot,
    deleteScreenshot,
    getMoreScreenshots,
    getScreenshotsForDate,
    getScreenshotTimingData,
    getScreenshotsForAnalysis,
    getScreenshotsForExport,
    getLastNScreenshotsMetadata
}; 