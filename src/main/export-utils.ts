import type { Category } from './db/core';

const CATEGORY_ORDER: Category[] = ['WORK', 'LEARN', 'SOCIAL', 'ENTERTAINMENT', 'OTHER', 'UNKNOWN'];
const REDUNDANT_SENTENCE_PATTERNS = [
    /^overall[, ]/i,
    /^overall activity/i,
    /^the overall activity/i,
    /^the overall context/i,
    /^this suggests/i,
    /^the presence of/i,
    /^the user seems to be/i,
    /^the user appears to be/i,
    /^the user is likely/i,
    /^the user is currently/i
];
const PREFIX_PATTERNS = [
    /^the user is\s+/i,
    /^the user appears to be\s+/i,
    /^the user seems to be\s+/i,
    /^the user is currently\s+/i,
    /^the screen shows\s+/i,
    /^the interface shows\s+/i
];

interface ExportMetadata {
    exportDate: string;
    dateRange: {
        startDate: string;
        endDate: string;
    };
    rangeType: string;
    screenshotCount: number;
    categories: readonly string[];
    version: string;
}

interface ExportScreenshot {
    id: string | number;
    timestamp: string;
    category: Category;
    activity: string;
    description?: string;
}

interface DailyStat {
    percentages: Record<Category, number>;
    timeInHours: Record<Category, number>;
    categoryMinutes: Record<Category, number>;
    categoryCounts: Record<Category, number>;
    totalScreenshots: number;
}

interface MonthlyStat {
    monthlyAverages: Record<Category, number>;
    monthlyTimeInHours: Record<Category, number>;
    daysWithData: number;
}

interface ExportStatistics {
    dailyStats?: Record<string, DailyStat>;
    monthlyStats?: Record<string, MonthlyStat>;
}

interface ExportJson {
    metadata: ExportMetadata;
    screenshots: ExportScreenshot[];
    statistics: ExportStatistics;
}

interface Session {
    category: Category;
    activity: string;
    start: Date;
    end: Date;
    count: number;
    descriptions: string[];
}

function roundValue(value: number, digits: number = 1): string {
    const rounded = Number(value.toFixed(digits));
    return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function splitSentences(text: string): string[] {
    return text
        .split(/(?<=[.!?])\s+/)
        .map(sentence => sentence.trim().replace(/^[\s-]+|[\s.]+$/g, ''))
        .filter(Boolean);
}

function normalizeSentence(sentence: string): string {
    let normalized = sentence.trim();

    for (const pattern of PREFIX_PATTERNS) {
        normalized = normalized.replace(pattern, '');
    }

    normalized = normalized.replace(/The user /g, '');
    normalized = normalized.replace(/\s+/g, ' ').trim();

    if (!normalized) {
        return '';
    }

    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function isRedundantSentence(sentence: string): boolean {
    const normalized = sentence.trim().toLowerCase();
    if (normalized.length < 20) {
        return true;
    }

    return REDUNDANT_SENTENCE_PATTERNS.some(pattern => pattern.test(normalized));
}

function compactDescription(text: string, maxSentences: number = 1): string {
    const kept: string[] = [];
    const seen = new Set<string>();

    for (const raw of splitSentences(text)) {
        const normalized = normalizeSentence(raw);
        const key = normalized.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

        if (!normalized || !key || seen.has(key) || isRedundantSentence(normalized)) {
            continue;
        }

        kept.push(normalized);
        seen.add(key);

        if (kept.length >= maxSentences) {
            break;
        }
    }

    if (kept.length === 0) {
        return normalizeSentence(text).slice(0, 180).replace(/[ .,;]+$/, '');
    }

    return kept.join('; ').slice(0, 180).replace(/[ .,;]+$/, '');
}

function formatTimeRange(start: Date, end: Date): string {
    const startTime = start.toISOString().slice(11, 16);
    const endTime = end.toISOString().slice(11, 16);
    return startTime === endTime ? startTime : `${startTime}-${endTime}`;
}

function formatStatsLine(values: Partial<Record<Category, number>>, unit: string): string {
    const parts: string[] = [];

    for (const category of CATEGORY_ORDER) {
        const value = values[category];
        if (!value) {
            continue;
        }

        parts.push(`${category.toLowerCase()} ${roundValue(value)}${unit}`);
    }

    return parts.join(', ');
}

function collectTopActivities(screenshots: ExportScreenshot[], limit: number = 8): string {
    const counts = new Map<string, number>();

    for (const screenshot of screenshots) {
        const activity = screenshot.activity?.trim() || 'Unknown';
        const key = `${screenshot.category}|||${activity}`;
        counts.set(key, (counts.get(key) || 0) + 1);
    }

    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([key, count]) => {
            const [category, activity] = key.split('|||');
            return `${activity} [${category.toLowerCase()}] x${count}`;
        })
        .join(', ');
}

function mergeSessions(screenshots: ExportScreenshot[], mergeGapMinutes: number = 12): Map<string, Session[]> {
    const sorted = [...screenshots].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const sessionsByDay = new Map<string, Session[]>();
    let current: Session | null = null;

    for (const screenshot of sorted) {
        const timestamp = new Date(screenshot.timestamp);
        const dayKey = timestamp.toISOString().slice(0, 10);
        const description = compactDescription(screenshot.description || '');
        const activity = screenshot.activity?.trim() || 'Unknown';

        const shouldMerge = Boolean(
            current &&
            current.category === screenshot.category &&
            current.activity === activity &&
            current.start.toISOString().slice(0, 10) === dayKey &&
            (timestamp.getTime() - current.end.getTime()) <= mergeGapMinutes * 60 * 1000
        );

        if (!shouldMerge) {
            current = {
                category: screenshot.category,
                activity,
                start: timestamp,
                end: timestamp,
                count: 1,
                descriptions: description ? [description] : []
            };

            const daySessions = sessionsByDay.get(dayKey) || [];
            daySessions.push(current);
            sessionsByDay.set(dayKey, daySessions);
            continue;
        }

        if (current) {
            current.end = timestamp;
            current.count += 1;
            if (description && !current.descriptions.includes(description)) {
                current.descriptions.push(description);
            }
        }
    }

    return sessionsByDay;
}

export function buildCompactMarkdown(exportJson: ExportJson): string {
    const sessionsByDay = mergeSessions(exportJson.screenshots);
    const lines: string[] = ['# Compact Activity Export', '', '## Overview'];

    lines.push(`- export_date: ${exportJson.metadata.exportDate}`);
    lines.push(
        `- date_range: ${exportJson.metadata.dateRange.startDate} to ${exportJson.metadata.dateRange.endDate}`
    );
    lines.push(`- screenshots: ${exportJson.metadata.screenshotCount}`);
    lines.push(`- top_activities: ${collectTopActivities(exportJson.screenshots)}`);
    lines.push('');

    const dailyStats = exportJson.statistics.dailyStats || {};
    if (sessionsByDay.size > 0) {
        lines.push('## Daily Summaries');

        for (const day of [...sessionsByDay.keys()].sort()) {
            lines.push(`### ${day}`);

            const stats = dailyStats[day];
            if (stats) {
                const counts = formatStatsLine(stats.categoryCounts, '');
                const hours = formatStatsLine(stats.timeInHours, 'h');
                const share = formatStatsLine(stats.percentages, '%');

                if (counts) {
                    lines.push(`- counts: ${counts}`);
                }
                if (hours) {
                    lines.push(`- hours: ${hours}`);
                }
                if (share) {
                    lines.push(`- share: ${share}`);
                }
            }

            for (const session of sessionsByDay.get(day) || []) {
                const summary = session.descriptions[0] || '';
                lines.push(
                    `- ${formatTimeRange(session.start, session.end)} | ${session.category} | ${session.activity} | ${session.count} shots${summary ? ` | ${summary}` : ''}`
                );
            }

            lines.push('');
        }
    }

    const monthlyStats = exportJson.statistics.monthlyStats || {};
    if (Object.keys(monthlyStats).length > 0) {
        lines.push('## Monthly Stats');

        for (const month of Object.keys(monthlyStats).sort()) {
            const stats = monthlyStats[month];
            lines.push(`### ${month}`);

            const averages = formatStatsLine(stats.monthlyAverages, '%');
            const totalHours = formatStatsLine(stats.monthlyTimeInHours, 'h');

            if (averages) {
                lines.push(`- avg_share: ${averages}`);
            }
            if (totalHours) {
                lines.push(`- total_hours: ${totalHours}`);
            }

            lines.push(`- days_with_data: ${stats.daysWithData}`);
            lines.push('');
        }
    }

    return `${lines.join('\n').trimEnd()}\n`;
}
