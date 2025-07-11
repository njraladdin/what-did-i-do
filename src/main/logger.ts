import winston from 'winston';
import { format } from 'winston';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';

// Debug flag
const DEBUG = true;

export type Logger = winston.Logger;

let logger: Logger;

function createLogger(): Logger {
    const logPath = path.join(app.getPath('userData'), 'logs');
    if (!fs.existsSync(logPath)) {
        fs.mkdirSync(logPath, { recursive: true });
    }

    logger = winston.createLogger({
        format: format.combine(
            format.timestamp(),
            format.printf(({ level, message, timestamp }) => {
                return `${timestamp} [${level.toUpperCase()}]: ${message}`;
            })
        ),
        transports: [
            new winston.transports.File({ 
                filename: path.join(logPath, 'error.log'), 
                level: 'error' 
            }),
            new winston.transports.File({ 
                filename: path.join(logPath, 'combined.log'),
                maxsize: 5242880, // 5MB
                maxFiles: 5,
                tailable: true
            })
        ]
    });

    // Also log to console in development
    if (DEBUG) {
        logger.add(new winston.transports.Console({
            format: format.simple()
        }));
    }

    // Replace console.log and console.error with logger
    console.log = (...args: any[]) => logger.info(args.join(' '));
    console.error = (...args: any[]) => logger.error(args.join(' '));

    return logger;
}

function getLogPath(): string {
    return path.join(app.getPath('userData'), 'logs', 'combined.log');
}

async function getRecentLogs(lines = 1000): Promise<string[]> {
    try {
        const logPath = getLogPath();
        if (!fs.existsSync(logPath)) {
            return [];
        }

        // Read last specified number of lines of logs
        const logs = fs.readFileSync(logPath, 'utf8')
            .split('\n')
            .filter(Boolean)
            .slice(-lines);
        
        return logs;
    } catch (error) {
        if (logger) {
            logger.error('Error reading logs:', (error as Error).message);
        }
        return [];
    }
}

export {
    createLogger,
    getLogPath,
    getRecentLogs
}; 