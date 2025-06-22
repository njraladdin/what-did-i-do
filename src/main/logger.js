// logger.js
const winston = require('winston');
const { format } = winston;
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

// Debug flag
const DEBUG = true;

let logger;

function createLogger() {
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
    console.log = (...args) => logger.info(args.join(' '));
    console.error = (...args) => logger.error(args.join(' '));

    return logger;
}

function getLogPath() {
    return path.join(app.getPath('userData'), 'logs', 'combined.log');
}

async function getRecentLogs(lines = 1000) {
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
            logger.error('Error reading logs:', error);
        }
        return [];
    }
}

module.exports = {
    createLogger,
    getLogPath,
    getRecentLogs
}; 