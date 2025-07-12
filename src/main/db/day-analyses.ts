import { getConnection } from './core';

interface DayAnalysis {
    id: number;
    date: string;
    timestamp: string;
    content: string;
    created_at?: string;
}

interface HistoricalAnalysis {
    date: string;
    content: string;
}

/**
 * Save a day analysis to the database
 * @param date - Date for the analysis
 * @param content - Analysis content
 * @returns The ID of the inserted analysis
 */
export async function saveDayAnalysis(date: Date, content: string): Promise<number> {
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
 * @param date - Date to get analysis for
 * @returns Analysis object or null if not found
 */
export async function getDayAnalysis(date: Date): Promise<DayAnalysis | null> {
    console.log('Getting day analysis for date:', date);
    return new Promise((resolve, reject) => {
        const db = getConnection();
        const dateStr = new Date(date).toISOString().split('T')[0];
        
        db.get<DayAnalysis>(`
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
            resolve(analysis || null);
        });
    });
}

/**
 * Get historical day analyses for context
 * @param startDate - Start date for historical data
 * @param endDate - End date (exclusive)
 * @returns Array of historical analysis objects
 */
export function getHistoricalAnalyses(startDate: Date, endDate: Date): Promise<HistoricalAnalysis[]> {
    return new Promise((resolve, reject) => {
        const db = getConnection();
        const startDateStr = new Date(startDate).toISOString().split('T')[0];
        const endDateStr = new Date(endDate).toISOString().split('T')[0];
        
        db.all<HistoricalAnalysis>(`
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
 * @param startDate - Start date
 * @param endDate - End date
 * @returns Array of analysis objects
 */
export function getAnalysesInRange(startDate: Date, endDate: Date): Promise<DayAnalysis[]> {
    return new Promise((resolve, reject) => {
        const db = getConnection();
        const startDateStr = new Date(startDate).toISOString().split('T')[0];
        const endDateStr = new Date(endDate).toISOString().split('T')[0];
        
        db.all<DayAnalysis>(`
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
 * @param id - Analysis ID
 * @returns True if deleted, false otherwise
 */
export function deleteAnalysis(id: number): Promise<boolean> {
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
 * @param id - Analysis ID
 * @param content - New analysis content
 * @returns True if updated, false otherwise
 */
export function updateAnalysis(id: number, content: string): Promise<boolean> {
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

/**
 * Count day analyses within a date range.
 * @param startDate - Start date
 * @param endDate - End date
 * @returns A promise that resolves to the number of analyses.
 */
export function countAnalysesInRange(startDate: Date, endDate: Date): Promise<number> {
    return new Promise((resolve, reject) => {
        const db = getConnection();
        const startDateStr = new Date(startDate).toISOString().split('T')[0];
        const endDateStr = new Date(endDate).toISOString().split('T')[0];

        db.get<{ count: number }>(`
            SELECT COUNT(*) as count
            FROM day_analyses
            WHERE date BETWEEN ? AND ?
        `, [startDateStr, endDateStr], (err, row) => {
            if (err) {
                console.error('Error counting analyses in range:', err);
                reject(err);
                return;
            }
            resolve(row ? row.count : 0);
        });
    });
}
