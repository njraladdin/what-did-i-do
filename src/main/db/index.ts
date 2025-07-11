import { getConnection, type Category } from './core';
import * as screenshots from './screenshots';
import * as notes from './notes';
import * as dayAnalyses from './day-analyses';
import * as stats from './stats';

interface HistoricalData {
    notes: Array<{
        date: string;
        timestamp: string;
        content: string;
    }>;
    analyses: Array<{
        date: string;
        content: string;
    }>;
}

interface DayAnalysisData {
    screenshots: Array<{
        timestamp: string;
        category: Category;
        activity: string;
        description?: string;
    }>;
    notes: Array<{
        timestamp: string;
        content: string;
    }>;
    historicalData: HistoricalData;
}

interface ExportData {
    dateRange: {
        startDate: Date;
        endDate: Date;
    };
    screenshots: Array<{
        id: number;
        timestamp: string;
        category: Category;
        activity: string;
        description?: string;
        image_data?: Buffer;
        thumbnail_data?: Buffer;
    }>;
    statistics?: {
        dailyStats: {
            [date: string]: {
                percentages: Record<Category, number>;
                timeInHours: Record<Category, number>;
                categoryMinutes: Record<Category, number>;
                categoryCounts: Record<Category, number>;
                totalScreenshots: number;
            };
        };
        monthlyStats: {
            [month: string]: {
                monthlyAverages: Record<Category, number>;
                monthlyTimeInHours: Record<Category, number>;
                daysWithData: number;
            };
        };
    };
}

/**
 * Get comprehensive day data for analysis (combines multiple data sources)
 * @param date - Date to get data for
 * @returns Object containing screenshots, notes, and historical data
 */
export async function getDayDataForAnalysis(date: Date): Promise<DayAnalysisData> {
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
            screenshots: screenshotsData.map(s => ({
                timestamp: s.timestamp,
                category: s.category,
                activity: s.activity,
                description: s.description || ''
            })),
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
 * @param startDate - Start date for export
 * @param endDate - End date for export
 * @param includeMedia - Whether to include image data
 * @param includeStats - Whether to include statistics
 * @returns Exported data object
 */
export async function exportData(
    startDate: Date,
    endDate: Date,
    includeMedia: boolean = false,
    includeStats: boolean = false
): Promise<ExportData> {
    try {
        const screenshotsData = await screenshots.getScreenshotsForExport(startDate, endDate, includeMedia);
        
        const result: ExportData = {
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
export {
    // Core functions
    getConnection,
    
    // Screenshot functions
    screenshots,
    
    // Notes functions
    notes,
    
    // Day analyses functions
    dayAnalyses,
    
    // Stats functions
    stats
}; 