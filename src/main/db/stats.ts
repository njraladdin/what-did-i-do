import { getConnection, categories, type Category } from './core';
import { getScreenshotTimingData, getScreenshotsForDate } from './screenshots';
import { getNotesForDate } from './notes';
import { getDayAnalysis } from './day-analyses';

interface ActivityStats {
    stats: Record<Category, number>;
    timeInHours: Record<Category, number>;
    screenshots: Array<{
        id: number;
        timestamp: string;
        category: Category;
        activity: string;
        description: string;
        thumbnail: string;
    }>;
    notes: Array<{
        id: number;
        date: string;
        timestamp: string;
        content: string;
        created_at?: string;
        updated_at?: string;
    }>;
    dayAnalysis: {
        id: number;
        date: string;
        timestamp: string;
        content: string;
        created_at?: string;
    } | null;
}

interface MonthlyStats {
    monthlyAverages: Record<Category, number>;
    monthlyTimeInHours: Record<Category, number>;
    daysWithData: number;
}

interface DailyCategoryStats {
    [date: string]: {
        percentages: Record<Category, number>;
        timeInHours: Record<Category, number>;
        categoryMinutes: Record<Category, number>;
        categoryCounts: Record<Category, number>;
        totalScreenshots: number;
    };
}

interface YearlyMonthlyStats {
    [month: string]: {
        percentages: Record<Category, number>;
        timeInHours: Record<Category, number>;
        daysWithData: number;
    };
}

interface ExportStats {
    dailyStats: DailyCategoryStats;
    monthlyStats: Record<string, MonthlyStats>;
}

function initializeCategoryRecord(): Record<Category, number> {
    return categories.reduce((acc, category) => {
        acc[category] = 0;
        return acc;
    }, {} as Record<Category, number>);
}

/**
 * Calculate activity statistics for a given date
 * @param currentDate - Date to calculate stats for
 * @param intervalMinutes - Screenshot interval in minutes
 * @returns Object containing stats, screenshots, notes, and day analysis
 */
export async function getActivityStats(
    currentDate: Date,
    intervalMinutes: number
): Promise<ActivityStats> {
    console.log('Calculating stats for date:', currentDate);
    console.log('Interval minutes:', intervalMinutes);

    try {
        // Get timing data for statistics calculation
        const timeResults = await getScreenshotTimingData(currentDate);
        console.log('Total screenshots found:', timeResults.length);

        // Initialize stats object
        const stats = initializeCategoryRecord();
        const timeInHours = initializeCategoryRecord();
        const categoryMinutes = initializeCategoryRecord();
        const categoryCounts = initializeCategoryRecord();
        let totalScreenshots = 0;

        // Calculate time differences and sum up by category
        if (timeResults && timeResults.length > 0) {
            timeResults.forEach((row, index) => {
                categoryCounts[row.category] = (categoryCounts[row.category] || 0) + 1;
                totalScreenshots++;

                // Calculate time difference if there's a next screenshot
                if (row.next_timestamp) {
                    const currentTime = new Date(row.timestamp);
                    const nextTime = new Date(row.next_timestamp);
                    const diffMinutes = Math.abs((nextTime.getTime() - currentTime.getTime()) / (1000 * 60));

                    // Only count if difference is 5 minutes or less
                    if (diffMinutes <= 5) {
                        categoryMinutes[row.category] = (categoryMinutes[row.category] || 0) + diffMinutes;
                    }
                } else {
                    // For the last screenshot of a sequence, count a default duration
                    const defaultDuration = Math.min(intervalMinutes, 5);
                    categoryMinutes[row.category] = (categoryMinutes[row.category] || 0) + defaultDuration;
                }
            });

            // Calculate percentages and convert minutes to hours
            categories.forEach(category => {
                stats[category] = totalScreenshots > 0 
                    ? (categoryCounts[category] / totalScreenshots) * 100 
                    : 0;
                timeInHours[category] = categoryMinutes[category] / 60;
            });
        }

        // Get screenshots, notes, and day analysis in parallel
        const [screenshots, notes, dayAnalysis] = await Promise.all([
            getScreenshotsForDate(currentDate),
            getNotesForDate(currentDate),
            getDayAnalysis(currentDate)
        ]);

        return {
            stats,
            timeInHours,
            screenshots,
            notes,
            dayAnalysis
        };
    } catch (error) {
        console.error('Error calculating activity stats:', error);
        throw error;
    }
}

/**
 * Get monthly averages for each category
 * @param currentDate - Date within the month to analyze
 * @param intervalMinutes - Screenshot interval in minutes
 * @returns Object containing monthly averages and time data
 */
export function getMonthlyAverages(
    currentDate: Date,
    intervalMinutes: number
): Promise<MonthlyStats> {
    return new Promise((resolve, reject) => {
        const db = getConnection();
        const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
        const endOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0, 23, 59, 59, 999);

        // Get all screenshots for the month
        db.all<{ timestamp: string; category: Category; next_timestamp?: string; }>(`
            SELECT 
                timestamp,
                category,
                LEAD(timestamp) OVER (ORDER BY timestamp ASC) as next_timestamp
            FROM screenshots 
            WHERE timestamp BETWEEN ? AND ? AND category != 'UNKNOWN'
            ORDER BY timestamp ASC
        `, [
            startOfMonth.toISOString(),
            endOfMonth.toISOString()
        ], (err, timeResults) => {
            if (err) {
                console.error('Error getting monthly stats:', err);
                reject(err);
                return;
            }

            const monthlyAverages = initializeCategoryRecord();
            const monthlyTimeInHours = initializeCategoryRecord();
            const categoryMinutes = initializeCategoryRecord();
            const categoryCounts = initializeCategoryRecord();
            const uniqueDays = new Set<string>();
            let totalScreenshots = 0;

            // Process results
            if (timeResults && timeResults.length > 0) {
                timeResults.forEach(row => {
                    // Track unique days
                    const day = new Date(row.timestamp).toISOString().split('T')[0];
                    uniqueDays.add(day);

                    // Count screenshots per category
                    categoryCounts[row.category] = (categoryCounts[row.category] || 0) + 1;
                    totalScreenshots++;

                    // Calculate time difference if there's a next screenshot
                    if (row.next_timestamp) {
                        const currentTime = new Date(row.timestamp);
                        const nextTime = new Date(row.next_timestamp);
                        const diffMinutes = Math.abs((nextTime.getTime() - currentTime.getTime()) / (1000 * 60));

                        // Only count if difference is 5 minutes or less
                        if (diffMinutes <= 5) {
                            categoryMinutes[row.category] = (categoryMinutes[row.category] || 0) + diffMinutes;
                        }
                    } else {
                        // For the last screenshot of a sequence, count a default duration
                        const defaultDuration = Math.min(intervalMinutes, 5);
                        categoryMinutes[row.category] = (categoryMinutes[row.category] || 0) + defaultDuration;
                    }
                });
                
                if (totalScreenshots > 0) {
                    categories.forEach(category => {
                        // Calculate average percentage
                        monthlyAverages[category] = (categoryCounts[category] / totalScreenshots) * 100;
                        
                        // Calculate total hours for the month
                        monthlyTimeInHours[category] = categoryMinutes[category] / 60;
                    });
                }
            }

            resolve({
                monthlyAverages,
                monthlyTimeInHours,
                daysWithData: uniqueDays.size
            });
        });
    });
}

/**
 * Get daily category stats for the current month
 * @param currentDate - Date within the month to analyze
 * @param intervalMinutes - Screenshot interval in minutes
 * @returns Object containing daily stats for each day in the month
 */
export function getDailyCategoryStats(
    currentDate: Date,
    intervalMinutes: number
): Promise<DailyCategoryStats> {
    return new Promise((resolve, reject) => {
        const db = getConnection();
        const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
        const endOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0, 23, 59, 59, 999);

        // Get all screenshots for the month with their timestamps
        db.all<{ date: string; timestamp: string; category: Category; next_timestamp?: string; }>(`
            SELECT 
                DATE(timestamp) as date,
                timestamp,
                category,
                LEAD(timestamp) OVER (ORDER BY timestamp ASC) as next_timestamp
            FROM screenshots 
            WHERE timestamp BETWEEN ? AND ? AND category != 'UNKNOWN'
            ORDER BY timestamp ASC
        `, [
            startOfMonth.toISOString(),
            endOfMonth.toISOString()
        ], (err, timeResults) => {
            if (err) {
                console.error('Error getting daily category stats:', err);
                reject(err);
                return;
            }

            // Initialize data structure for daily stats
            const dailyStats: DailyCategoryStats = {};

            // Process results
            if (timeResults && timeResults.length > 0) {
                // Group results by date
                timeResults.forEach(row => {
                    const date = row.date;
                    
                    // Initialize stats for this date if not exists
                    if (!dailyStats[date]) {
                        dailyStats[date] = {
                            percentages: initializeCategoryRecord(),
                            timeInHours: initializeCategoryRecord(),
                            categoryMinutes: initializeCategoryRecord(),
                            categoryCounts: initializeCategoryRecord(),
                            totalScreenshots: 0
                        };
                    }

                    // Count screenshots
                    dailyStats[date].categoryCounts[row.category]++;
                    dailyStats[date].totalScreenshots++;

                    // Calculate time spent
                    if (row.next_timestamp) {
                        const currentTime = new Date(row.timestamp);
                        const nextTime = new Date(row.next_timestamp);
                        const diffMinutes = Math.abs((nextTime.getTime() - currentTime.getTime()) / (1000 * 60));

                        // Only count if difference is 5 minutes or less
                        if (diffMinutes <= 5) {
                            dailyStats[date].categoryMinutes[row.category] += diffMinutes;
                        }
                    } else {
                        // For the last screenshot of a sequence, count a default duration
                        const defaultDuration = Math.min(intervalMinutes, 5);
                        dailyStats[date].categoryMinutes[row.category] += defaultDuration;
                    }
                });

                // Calculate percentages and convert minutes to hours for each day
                Object.keys(dailyStats).forEach(date => {
                    const dayStats = dailyStats[date];
                    categories.forEach(category => {
                        dayStats.percentages[category] = dayStats.totalScreenshots > 0
                            ? (dayStats.categoryCounts[category] / dayStats.totalScreenshots) * 100
                            : 0;
                        dayStats.timeInHours[category] = dayStats.categoryMinutes[category] / 60;
                    });
                });
            }

            resolve(dailyStats);
        });
    });
}

/**
 * Get yearly monthly category stats
 * @param year - Year to analyze
 * @param intervalMinutes - Screenshot interval in minutes
 * @returns Object containing monthly stats for each month in the year
 */
export function getYearlyMonthlyCategoryStats(
    year: number,
    intervalMinutes: number
): Promise<{ data: YearlyMonthlyStats, topCategories: string[] }> {
    return new Promise((resolve, reject) => {
        const db = getConnection();
        const startOfYear = new Date(year, 0, 1);
        const endOfYear = new Date(year, 11, 31, 23, 59, 59, 999);

        // SQL query to get all screenshots for the year
        db.all<{
            month: string;
            category: Category;
            timestamp: string;
            next_timestamp: string | null;
        }>(`
            SELECT 
                strftime('%Y-%m', timestamp) as month,
                category,
                timestamp,
                LEAD(timestamp) OVER (PARTITION BY strftime('%Y-%m-%d', timestamp) ORDER BY timestamp ASC) as next_timestamp
            FROM screenshots 
            WHERE timestamp BETWEEN ? AND ? AND category != 'UNKNOWN'
            ORDER BY timestamp ASC
        `, [
            startOfYear.toISOString(),
            endOfYear.toISOString()
        ], (err, rows) => {
            if (err) {
                console.error('Error getting yearly monthly stats:', err);
                reject(err);
                return;
            }

            const yearlyData: {
                [month: string]: {
                    categoryMinutes: Record<Category, number>;
                    categoryCounts: Record<Category, number>;
                    totalScreenshots: number;
                    uniqueDays: Set<string>;
                }
            } = {};

            const overallCategoryMinutes: Record<Category, number> = initializeCategoryRecord();

            // Process all rows
            if (rows && rows.length > 0) {
                rows.forEach(row => {
                    const month = row.month;

                    // Initialize month data if it doesn't exist
                    if (!yearlyData[month]) {
                        yearlyData[month] = {
                            categoryMinutes: initializeCategoryRecord(),
                            categoryCounts: initializeCategoryRecord(),
                            totalScreenshots: 0,
                            uniqueDays: new Set()
                        };
                    }

                    // Track unique days for each month
                    const day = new Date(row.timestamp).toISOString().split('T')[0];
                    yearlyData[month].uniqueDays.add(day);

                    // Count screenshots
                    yearlyData[month].categoryCounts[row.category]++;
                    yearlyData[month].totalScreenshots++;

                    // Calculate time difference if there's a next screenshot within the same day
                    if (row.next_timestamp) {
                        const currentTime = new Date(row.timestamp);
                        const nextTime = new Date(row.next_timestamp);
                        const diffMinutes = Math.abs((nextTime.getTime() - currentTime.getTime()) / (1000 * 60));

                        // Only add if the time difference is less than or equal to the interval
                        if (diffMinutes <= intervalMinutes) {
                            yearlyData[month].categoryMinutes[row.category] += diffMinutes;
                            overallCategoryMinutes[row.category] += diffMinutes;
                        } else {
                            // If gap is too large, add default interval duration
                            yearlyData[month].categoryMinutes[row.category] += intervalMinutes;
                            overallCategoryMinutes[row.category] += intervalMinutes;
                        }
                    } else {
                        // For the last screenshot of a day, add default interval duration
                        yearlyData[month].categoryMinutes[row.category] += intervalMinutes;
                        overallCategoryMinutes[row.category] += intervalMinutes;
                    }
                });
            }

            // Determine top 3 categories for the whole year
            const topCategories = Object.entries(overallCategoryMinutes)
                .sort(([, a], [, b]) => b - a)
                .slice(0, 3)
                .map(([category]) => category);

            const finalStats: YearlyMonthlyStats = {};
            
            // Format data for each month
            Object.keys(yearlyData).forEach(month => {
                const monthData = yearlyData[month];
                const percentages = initializeCategoryRecord();
                const timeInHours = initializeCategoryRecord();
                
                categories.forEach(category => {
                    if (monthData.totalScreenshots > 0) {
                        percentages[category] = (monthData.categoryCounts[category] / monthData.totalScreenshots) * 100;
                    }
                    timeInHours[category] = monthData.categoryMinutes[category] / 60;
                });
                
                finalStats[month] = {
                    percentages,
                    timeInHours,
                    daysWithData: monthData.uniqueDays.size
                };
            });

            resolve({ data: finalStats, topCategories });
        });
    });
}

/**
 * Get export stats
 * @param startDate - Start date for export
 * @param endDate - End date for export
 * @returns Object containing daily and monthly stats
 */
export async function getExportStats(startDate: Date, endDate: Date): Promise<ExportStats> {
    try {
        // Get daily stats
        const dailyStats = await getDailyCategoryStats(startDate, 5);

        // Get monthly stats
        const monthlyStats: Record<string, MonthlyStats> = {};
        let currentDate = new Date(startDate);
        while (currentDate <= endDate) {
            const monthKey = currentDate.toISOString().slice(0, 7); // YYYY-MM format
            const monthStats = await getMonthlyAverages(currentDate, 5);
            monthlyStats[monthKey] = monthStats;
            
            // Move to next month
            currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);
        }

        return {
            dailyStats,
            monthlyStats
        };
    } catch (error) {
        console.error('Error getting export stats:', error);
        throw error;
    }
}

/**
 * Count the number of days with screenshot data in a given month.
 * @param currentDate - A date within the month to count.
 * @returns A promise that resolves to the number of days with data.
 */
export function countDaysWithStatsInMonth(currentDate: Date): Promise<number> {
    return new Promise((resolve, reject) => {
        const db = getConnection();
        const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
        const endOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0, 23, 59, 59, 999);

        db.get<{ count: number }>(`
            SELECT COUNT(DISTINCT date(timestamp)) as count
            FROM screenshots
            WHERE timestamp BETWEEN ? AND ? AND category != 'UNKNOWN'
        `, [startOfMonth.toISOString(), endOfMonth.toISOString()], (err, row) => {
            if (err) {
                console.error('Error counting days with stats in month:', err);
                reject(err);
                return;
            }
            resolve(row ? row.count : 0);
        });
    });
}

/**
 * Count the number of months with screenshot data in a given year.
 * @param year - The year to count.
 * @returns A promise that resolves to the number of months with data.
 */
export function countMonthsWithStatsInYear(year: number): Promise<number> {
    return new Promise((resolve, reject) => {
        const db = getConnection();
        const startOfYear = new Date(year, 0, 1);
        const endOfYear = new Date(year, 11, 31, 23, 59, 59, 999);

        db.get<{ count: number }>(`
            SELECT COUNT(DISTINCT strftime('%Y-%m', timestamp)) as count
            FROM screenshots
            WHERE timestamp BETWEEN ? AND ? AND category != 'UNKNOWN'
        `, [startOfYear.toISOString(), endOfYear.toISOString()], (err, row) => {
            if (err) {
                console.error('Error counting months with stats in year:', err);
                reject(err);
                return;
            }
            resolve(row ? row.count : 0);
        });
    });
}