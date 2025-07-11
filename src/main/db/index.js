const core = require('./core');
const screenshots = require('./screenshots');
const notes = require('./notes');
const dayAnalyses = require('./day-analyses');
const stats = require('./stats');

/**
 * Get comprehensive day data for analysis (combines multiple data sources)
 * @param {Date} date - Date to get data for
 * @returns {Promise<Object>} Object containing screenshots, notes, and historical data
 */
async function getDayDataForAnalysis(date) {
    const localDate = new Date(date);
    const year = localDate.getFullYear();
    const month = localDate.getMonth();
    const day = localDate.getDate();

    const startOfDay = new Date(year, month, day, 0, 0, 0, 0);
    const endOfDay = new Date(year, month, day, 23, 59, 59, 999);

    // Get start of month for historical data
    const startOfMonth = new Date(year, month, 1);
    const dateStr = startOfDay.toISOString().split('T')[0];

    try {
        const [screenshotsData, notesData, historicalNotes, historicalAnalyses] = await Promise.all([
            screenshots.getScreenshotsForAnalysis(date),
            notes.getNotesForAnalysis(date),
            notes.getHistoricalNotes(startOfMonth, new Date(dateStr)),
            dayAnalyses.getHistoricalAnalyses(startOfMonth, new Date(dateStr))
        ]);

        return {
            screenshots: screenshotsData,
            notes: notesData,
            historicalData: {
                notes: historicalNotes,
                analyses: historicalAnalyses
            }
        };
    } catch (error) {
        console.error('Error getting day data for analysis:', error);
        throw error;
    }
}

/**
 * Export data for a specific date range with options
 * @param {Date} startDate - Start date for export
 * @param {Date} endDate - End date for export
 * @param {boolean} includeMedia - Whether to include image data
 * @param {boolean} includeStats - Whether to include statistics
 * @returns {Promise<Object>} Exported data object
 */
async function exportData(startDate, endDate, includeMedia = false, includeStats = false) {
    try {
        const screenshotsData = await screenshots.getScreenshotsForExport(startDate, endDate, includeMedia);
        
        let result = {
            dateRange: {
                startDate,
                endDate
            },
            screenshots: screenshotsData
        };

        if (includeStats) {
            const statisticsData = await stats.getExportStats(startDate, endDate);
            result.statistics = statisticsData;
        }

        return result;
    } catch (error) {
        console.error('Error exporting data:', error);
        throw error;
    }
}

// Export all functions from all modules
module.exports = {
    // Core functions
    ...core,
    
    // Screenshot functions
    ...screenshots,
    
    // Notes functions
    ...notes,
    
    // Day analyses functions
    ...dayAnalyses,
    
    // Stats functions
    ...stats,
    
    // Combined functions
    getDayDataForAnalysis,
    exportData
}; 