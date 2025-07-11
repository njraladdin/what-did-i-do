import { getConnection } from './core';

interface Note {
    id: number;
    date: string;
    timestamp: string;
    content: string;
    created_at?: string;
    updated_at?: string;
}

interface NoteForAnalysis {
    timestamp: string;
    content: string;
}

interface HistoricalNote {
    date: string;
    timestamp: string;
    content: string;
}

/**
 * Save a new note to the database
 * @param date - Date for the note
 * @param content - Note content
 * @returns The ID of the inserted note
 */
export function saveNote(date: Date, content: string): Promise<number> {
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
 * @param date - Date to get notes for
 * @returns Array of note objects
 */
export function getNotesForDate(date: Date): Promise<Note[]> {
    return new Promise((resolve, reject) => {
        const db = getConnection();
        const dateStr = new Date(date).toISOString().split('T')[0]; // Format as YYYY-MM-DD
        
        db.all<Note>(`
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
 * @param id - Note ID
 * @param content - New note content
 * @returns True if updated, false otherwise
 */
export function updateNote(id: number, content: string): Promise<boolean> {
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
 * @param id - Note ID
 * @returns True if deleted, false otherwise
 */
export function deleteNote(id: number): Promise<boolean> {
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
 * @param startDate - Start date
 * @param endDate - End date
 * @returns Array of note objects
 */
export function getNotesInRange(startDate: Date, endDate: Date): Promise<Note[]> {
    return new Promise((resolve, reject) => {
        const db = getConnection();
        const startDateStr = new Date(startDate).toISOString().split('T')[0];
        const endDateStr = new Date(endDate).toISOString().split('T')[0];
        
        db.all<Note>(`
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
 * @param date - Date to get notes for
 * @returns Array of note objects for analysis
 */
export function getNotesForAnalysis(date: Date): Promise<NoteForAnalysis[]> {
    return new Promise((resolve, reject) => {
        const db = getConnection();
        const dateStr = new Date(date).toISOString().split('T')[0];
        
        db.all<NoteForAnalysis>(`
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
 * @param startDate - Start date for historical data
 * @param endDate - End date (exclusive)
 * @returns Array of historical note objects
 */
export function getHistoricalNotes(startDate: Date, endDate: Date): Promise<HistoricalNote[]> {
    return new Promise((resolve, reject) => {
        const db = getConnection();
        const startDateStr = new Date(startDate).toISOString().split('T')[0];
        const endDateStr = new Date(endDate).toISOString().split('T')[0];
        
        db.all<HistoricalNote>(`
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