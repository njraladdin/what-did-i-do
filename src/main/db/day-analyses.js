const { getConnection } = require('./core');

/**
 * Save a day analysis to the database
 * @param {Date} date - Date for the analysis
 * @param {string} content - Analysis content
 * @returns {Promise<number>} The ID of the inserted analysis
 */
async function saveDayAnalysis(date, content) {
    console.log('Saving day analysis for date:', date);
    return new Promise((resolve, reject) => {
        const db = getConnection();
        const timestamp = new Date().toISOString();
        const dateStr = new Date(date).toISOString().split('T')[0];
        
        db.run(`
            INSERT INTO day_analyses (
                date,
                timestamp,
                content
            ) VALUES (?, ?, ?)
        `, [dateStr, timestamp, content], function(err) {
            if (err) {
                console.error('Error saving day analysis:', err);
                reject(err);
                return;
            }
            console.log('Day analysis saved successfully, ID:', this.lastID);
            resolve(this.lastID);
        });
    });
}

/**
 * Get the most recent day analysis for a specific date
 * @param {Date} date - Date to get analysis for
 * @returns {Promise<Object|null>} Analysis object or null if not found
 */
async function getDayAnalysis(date) {
    console.log('Getting day analysis for date:', date);
    return new Promise((resolve, reject) => {
        const db = getConnection();
        const dateStr = new Date(date).toISOString().split('T')[0];
        
        db.get(`
            SELECT * FROM day_analyses 
            WHERE date = ?
            ORDER BY timestamp DESC
            LIMIT 1
        `, [dateStr], (err, analysis) => {
            if (err) {
                console.error('Error getting day analysis:', err);
                reject(err);
                return;
            }
            console.log('Retrieved day analysis:', analysis);
            resolve(analysis);
        });
    });
}

/**
 * Get historical day analyses for context
 * @param {Date} startDate - Start date for historical data
 * @param {Date} endDate - End date (exclusive)
 * @returns {Promise<Array>} Array of historical analysis objects
 */
function getHistoricalAnalyses(startDate, endDate) {
    return new Promise((resolve, reject) => {
        const db = getConnection();
        const startDateStr = new Date(startDate).toISOString().split('T')[0];
        const endDateStr = new Date(endDate).toISOString().split('T')[0];
        
        db.all(`
            SELECT date, content
            FROM day_analyses 
            WHERE date >= ? AND date < ?
            ORDER BY date DESC
        `, [startDateStr, endDateStr], (err, analyses) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(analyses || []);
        });
    });
}

/**
 * Get day analyses within a date range
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 * @returns {Promise<Array>} Array of analysis objects
 */
function getAnalysesInRange(startDate, endDate) {
    return new Promise((resolve, reject) => {
        const db = getConnection();
        const startDateStr = new Date(startDate).toISOString().split('T')[0];
        const endDateStr = new Date(endDate).toISOString().split('T')[0];
        
        db.all(`
            SELECT 
                id,
                date,
                timestamp,
                content,
                created_at
            FROM day_analyses 
            WHERE date BETWEEN ? AND ?
            ORDER BY date DESC, timestamp DESC
        `, [startDateStr, endDateStr], (err, analyses) => {
            if (err) {
                console.error('Error getting analyses in range:', err);
                reject(err);
                return;
            }
            resolve(analyses || []);
        });
    });
}

/**
 * Delete a day analysis by ID
 * @param {number} id - Analysis ID
 * @returns {Promise<boolean>} True if deleted, false otherwise
 */
function deleteAnalysis(id) {
    return new Promise((resolve, reject) => {
        const db = getConnection();
        db.run('DELETE FROM day_analyses WHERE id = ?', [id], function(err) {
            if (err) {
                console.error('Error deleting analysis:', err);
                reject(err);
                return;
            }
            resolve(this.changes > 0);
        });
    });
}

/**
 * Update an existing day analysis
 * @param {number} id - Analysis ID
 * @param {string} content - New analysis content
 * @returns {Promise<boolean>} True if updated, false otherwise
 */
function updateAnalysis(id, content) {
    return new Promise((resolve, reject) => {
        const db = getConnection();
        const timestamp = new Date().toISOString();
        
        db.run(`
            UPDATE day_analyses 
            SET content = ?, timestamp = ?
            WHERE id = ?
        `, [content, timestamp, id], function(err) {
            if (err) {
                console.error('Error updating analysis:', err);
                reject(err);
                return;
            }
            resolve(this.changes > 0);
        });
    });
}

module.exports = {
    saveDayAnalysis,
    getDayAnalysis,
    getHistoricalAnalyses,
    getAnalysesInRange,
    deleteAnalysis,
    updateAnalysis
}; 