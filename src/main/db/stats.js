const { getConnection, categories } = require('./core');
const { getScreenshotTimingData, getScreenshotsForDate } = require('./screenshots');
const { getNotesForDate } = require('./notes');
const { getDayAnalysis } = require('./day-analyses');

/**
 * Calculate activity statistics for a given date
 * @param {Date} currentDate - Date to calculate stats for
 * @param {number} intervalMinutes - Screenshot interval in minutes
 * @returns {Promise<Object>} Object containing stats, screenshots, notes, and day analysis
 */
async function getActivityStats(currentDate, intervalMinutes) {
    console.log('Calculating stats for date:', currentDate);
    console.log('Interval minutes:', intervalMinutes);

    try {
        // Get timing data for statistics calculation
        const timeResults = await getScreenshotTimingData(currentDate);
        console.log('Total screenshots found:', timeResults.length);

        // Initialize stats object
        const stats = {};
        const timeInHours = {};
        const categoryMinutes = {};
        const categoryCounts = {};
        let totalScreenshots = 0;

        // Initialize stats for all categories except UNKNOWN
        categories.filter(category => category !== 'UNKNOWN').forEach(category => {
            stats[category] = 0;
            timeInHours[category] = 0;
            categoryMinutes[category] = 0;
            categoryCounts[category] = 0;
        });

        // Calculate time differences and sum up by category
        if (timeResults && timeResults.length > 0) {
            timeResults.forEach((row, index) => {
                categoryCounts[row.category] = (categoryCounts[row.category] || 0) + 1;
                totalScreenshots++;

                // Calculate time difference if there's a next screenshot
                if (row.next_timestamp) {
                    const currentTime = new Date(row.timestamp);
                    const nextTime = new Date(row.next_timestamp);
                    const diffMinutes = Math.abs((nextTime - currentTime) / (1000 * 60));

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
            categories.filter(category => category !== 'UNKNOWN').forEach(category => {
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
 * @param {Date} currentDate - Date within the month to analyze
 * @param {number} intervalMinutes - Screenshot interval in minutes
 * @returns {Promise<Object>} Object containing monthly averages and time data
 */
function getMonthlyAverages(currentDate, intervalMinutes) {
    return new Promise((resolve, reject) => {
        const db = getConnection();
        const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
        const endOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0, 23, 59, 59, 999);

        // Get all screenshots for the month
        db.all(`
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

            const monthlyAverages = {};
            const monthlyTimeInHours = {};
            const categoryMinutes = {};
            const categoryCounts = {};
            const uniqueDays = new Set();
            let totalScreenshots = 0;

            // Initialize stats for all categories except UNKNOWN
            categories.filter(category => category !== 'UNKNOWN').forEach(category => {
                monthlyAverages[category] = 0;
                monthlyTimeInHours[category] = 0;
                categoryMinutes[category] = 0;
                categoryCounts[category] = 0;
            });

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
                        const diffMinutes = Math.abs((nextTime - currentTime) / (1000 * 60));

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
                    categories.filter(category => category !== 'UNKNOWN').forEach(category => {
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
 * @param {Date} currentDate - Date within the month to analyze
 * @param {number} intervalMinutes - Screenshot interval in minutes
 * @returns {Promise<Object>} Object containing daily stats for each day in the month
 */
function getDailyCategoryStats(currentDate, intervalMinutes) {
    return new Promise((resolve, reject) => {
        const db = getConnection();
        const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
        const endOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0, 23, 59, 59, 999);

        // Get all screenshots for the month with their timestamps
        db.all(`
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
            const dailyStats = {};

            // Process results
            if (timeResults && timeResults.length > 0) {
                // Group results by date
                timeResults.forEach(row => {
                    const date = row.date;
                    
                    // Initialize stats for this date if not exists
                    if (!dailyStats[date]) {
                        dailyStats[date] = {
                            percentages: {},
                            timeInHours: {},
                            categoryMinutes: {},
                            categoryCounts: {},
                            totalScreenshots: 0
                        };
                        
                        // Initialize categories
                        categories.filter(category => category !== 'UNKNOWN').forEach(category => {
                            dailyStats[date].percentages[category] = 0;
                            dailyStats[date].timeInHours[category] = 0;
                            dailyStats[date].categoryMinutes[category] = 0;
                            dailyStats[date].categoryCounts[category] = 0;
                        });
                    }

                    // Count screenshots
                    dailyStats[date].categoryCounts[row.category]++;
                    dailyStats[date].totalScreenshots++;

                    // Calculate time spent
                    if (row.next_timestamp) {
                        const currentTime = new Date(row.timestamp);
                        const nextTime = new Date(row.next_timestamp);
                        const diffMinutes = Math.abs((nextTime - currentTime) / (1000 * 60));

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

                // Calculate percentages and hours for each date
                Object.keys(dailyStats).forEach(date => {
                    const stats = dailyStats[date];
                    if (stats.totalScreenshots > 0) {
                        categories.filter(category => category !== 'UNKNOWN').forEach(category => {
                            // Calculate percentage
                            stats.percentages[category] = 
                                (stats.categoryCounts[category] / stats.totalScreenshots) * 100;
                            
                            // Calculate hours
                            stats.timeInHours[category] = stats.categoryMinutes[category] / 60;
                        });
                    }
                });
            }

            resolve(dailyStats);
        });
    });
}

/**
 * Get total hours per category for each month in a year
 * @param {number} year - Year to analyze
 * @param {number} intervalMinutes - Screenshot interval in minutes
 * @returns {Promise<Object>} Object containing monthly stats for each category
 */
function getYearlyMonthlyCategoryStats(year, intervalMinutes) {
    return new Promise((resolve, reject) => {
        const db = getConnection();
        const startOfYear = new Date(year, 0, 1, 0, 0, 0, 0);
        const endOfYear = new Date(year, 11, 31, 23, 59, 59, 999);

        db.all(`
            SELECT 
                strftime('%m', timestamp) as month,
                category,
                timestamp,
                LEAD(timestamp) OVER (PARTITION BY strftime('%m', timestamp) ORDER BY timestamp ASC) as next_timestamp
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

            // Structure: { '01': { WORK: hours, ... }, ... }
            const result = {};
            // Initialize for all months and categories
            for (let m = 1; m <= 12; m++) {
                const mm = m.toString().padStart(2, '0');
                result[mm] = {};
                categories.filter(c => c !== 'UNKNOWN').forEach(cat => {
                    result[mm][cat] = 0;
                });
            }

            // For each month, accumulate minutes per category
            const categoryMinutesByMonth = {};
            rows.forEach((row, idx) => {
                const month = row.month;
                if (!categoryMinutesByMonth[month]) categoryMinutesByMonth[month] = {};
                if (!categoryMinutesByMonth[month][row.category]) categoryMinutesByMonth[month][row.category] = 0;

                // Calculate time difference if there's a next screenshot in the same month
                if (row.next_timestamp) {
                    const currentTime = new Date(row.timestamp);
                    const nextTime = new Date(row.next_timestamp);
                    const diffMinutes = Math.abs((nextTime - currentTime) / (1000 * 60));
                    // Only count if difference is 5 minutes or less
                    if (diffMinutes <= 5) {
                        categoryMinutesByMonth[month][row.category] += diffMinutes;
                    }
                } else {
                    // For the last screenshot of a sequence, count a default duration
                    const defaultDuration = Math.min(intervalMinutes, 5);
                    categoryMinutesByMonth[month][row.category] += defaultDuration;
                }
            });

            // Convert minutes to hours and fill result
            Object.keys(categoryMinutesByMonth).forEach(month => {
                Object.keys(categoryMinutesByMonth[month]).forEach(cat => {
                    result[month][cat] = categoryMinutesByMonth[month][cat] / 60;
                });
            });

            resolve(result);
        });
    });
}

/**
 * Export statistics data for a specific date range
 * @param {Date} startDate - Start date for export
 * @param {Date} endDate - End date for export
 * @returns {Promise<Object>} Object containing statistics data
 */
function getExportStats(startDate, endDate) {
    return new Promise((resolve, reject) => {
        const db = getConnection();
        db.all(`
            SELECT 
                category,
                COUNT(*) as count,
                DATE(timestamp) as date
            FROM screenshots 
            WHERE timestamp BETWEEN ? AND ?
            GROUP BY category, date
            ORDER BY date DESC
        `, [startDate.toISOString(), endDate.toISOString()], (err, statResults) => {
            if (err) {
                console.error('Error getting export stats:', err);
                reject(err);
                return;
            }

            // Process stats into a more usable format
            const dailyStats = {};
            const overallStats = {};
            categories.forEach(category => {
                overallStats[category] = 0;
            });

            if (statResults && statResults.length > 0) {
                statResults.forEach(row => {
                    if (!dailyStats[row.date]) {
                        dailyStats[row.date] = {};
                        categories.forEach(category => {
                            dailyStats[row.date][category] = 0;
                        });
                    }
                    dailyStats[row.date][row.category] = row.count;
                    overallStats[row.category] += row.count;
                });
            }

            resolve({
                overall: overallStats,
                daily: dailyStats
            });
        });
    });
}

module.exports = {
    getActivityStats,
    getMonthlyAverages,
    getDailyCategoryStats,
    getYearlyMonthlyCategoryStats,
    getExportStats
}; 