const { getConnection } = require('./core');

/**
 * Save a new note to the database
 * @param {Date} date - Date for the note
 * @param {string} content - Note content
 * @returns {Promise<number>} The ID of the inserted note
 */
function saveNote(date, content) {
    return new Promise((resolve, reject) => {
        const db = getConnection();
        const timestamp = new Date().toISOString();
        const dateStr = new Date(date).toISOString().split('T')[0]; // Format as YYYY-MM-DD
        
        db.run(`
            INSERT INTO notes (
                date, 
                timestamp, 
                content,
                updated_at
            ) VALUES (?, ?, ?, ?)
        `, [
            dateStr,
            timestamp,
            content,
            timestamp
        ], function(err) {
            if (err) {
                console.error('Error saving note:', err);
                reject(err);
                return;
            }
            resolve(this.lastID);
        });
    });
}

/**
 * Get all notes for a specific date
 * @param {Date} date - Date to get notes for
 * @returns {Promise<Array>} Array of note objects
 */
function getNotesForDate(date) {
    return new Promise((resolve, reject) => {
        const db = getConnection();
        const dateStr = new Date(date).toISOString().split('T')[0]; // Format as YYYY-MM-DD
        
        db.all(`
            SELECT 
                id,
                date,
                timestamp,
                content,
                created_at,
                updated_at
            FROM notes 
            WHERE date = ?
            ORDER BY timestamp DESC
        `, [dateStr], (err, notes) => {
            if (err) {
                console.error('Error getting notes:', err);
                reject(err);
                return;
            }
            
            const processedNotes = (notes || []).map(note => ({
                id: note.id,
                date: note.date,
                timestamp: note.timestamp,
                content: note.content,
                created_at: note.created_at,
                updated_at: note.updated_at
            }));
            
            resolve(processedNotes);
        });
    });
}

/**
 * Update an existing note
 * @param {number} id - Note ID
 * @param {string} content - New note content
 * @returns {Promise<boolean>} True if updated, false otherwise
 */
function updateNote(id, content) {
    return new Promise((resolve, reject) => {
        const db = getConnection();
        const timestamp = new Date().toISOString();
        
        db.run(`
            UPDATE notes 
            SET content = ?, updated_at = ?
            WHERE id = ?
        `, [
            content,
            timestamp,
            id
        ], function(err) {
            if (err) {
                console.error('Error updating note:', err);
                reject(err);
                return;
            }
            resolve(this.changes > 0);
        });
    });
}

/**
 * Delete a note by ID
 * @param {number} id - Note ID
 * @returns {Promise<boolean>} True if deleted, false otherwise
 */
function deleteNote(id) {
    return new Promise((resolve, reject) => {
        const db = getConnection();
        db.run('DELETE FROM notes WHERE id = ?', [id], function(err) {
            if (err) {
                console.error('Error deleting note:', err);
                reject(err);
                return;
            }
            resolve(this.changes > 0);
        });
    });
}

/**
 * Get notes within a date range
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 * @returns {Promise<Array>} Array of note objects
 */
function getNotesInRange(startDate, endDate) {
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
                created_at,
                updated_at
            FROM notes 
            WHERE date BETWEEN ? AND ?
            ORDER BY date DESC, timestamp DESC
        `, [startDateStr, endDateStr], (err, notes) => {
            if (err) {
                console.error('Error getting notes in range:', err);
                reject(err);
                return;
            }
            
            const processedNotes = (notes || []).map(note => ({
                id: note.id,
                date: note.date,
                timestamp: note.timestamp,
                content: note.content,
                created_at: note.created_at,
                updated_at: note.updated_at
            }));
            
            resolve(processedNotes);
        });
    });
}

/**
 * Get notes for day analysis
 * @param {Date} date - Date to get notes for
 * @returns {Promise<Array>} Array of note objects for analysis
 */
function getNotesForAnalysis(date) {
    return new Promise((resolve, reject) => {
        const db = getConnection();
        const dateStr = new Date(date).toISOString().split('T')[0];
        
        db.all(`
            SELECT timestamp, content
            FROM notes 
            WHERE date = ?
            ORDER BY timestamp ASC
        `, [dateStr], (err, notes) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(notes || []);
        });
    });
}

/**
 * Get historical notes for analysis context
 * @param {Date} startDate - Start date for historical data
 * @param {Date} endDate - End date (exclusive)
 * @returns {Promise<Array>} Array of historical note objects
 */
function getHistoricalNotes(startDate, endDate) {
    return new Promise((resolve, reject) => {
        const db = getConnection();
        const startDateStr = new Date(startDate).toISOString().split('T')[0];
        const endDateStr = new Date(endDate).toISOString().split('T')[0];
        
        db.all(`
            SELECT date, timestamp, content
            FROM notes 
            WHERE date >= ? AND date < ?
            ORDER BY date DESC, timestamp DESC
        `, [startDateStr, endDateStr], (err, notes) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(notes || []);
        });
    });
}

module.exports = {
    saveNote,
    getNotesForDate,
    updateNote,
    deleteNote,
    getNotesInRange,
    getNotesForAnalysis,
    getHistoricalNotes
}; 