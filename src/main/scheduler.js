const { powerMonitor } = require('electron');

class SimpleRobustScheduler {
    constructor(logger, options = {}) {
        this.logger = logger;
        this.intervalMinutes = options.intervalMinutes || 1;
        this.maxRetries = options.maxRetries || 2;
        this.idleThresholdMinutes = options.idleThresholdMinutes || 5;
        
        // Essential state only
        this.isRunning = false;
        this.currentTimer = null;
        this.taskFunction = null;
        
        this.setupPowerMonitoring();
    }

    /**
     * Setup power monitoring for system integration
     */
    setupPowerMonitoring() {
        powerMonitor.on('suspend', () => {
            this.logger.info('System suspended, pausing scheduler');
            this.pause();
        });

        powerMonitor.on('resume', () => {
            this.logger.info('System resumed, resuming scheduler');
            if (this.wasRunningBeforeSuspend) {
                this.start(this.taskFunction);
            }
        });
    }

    /**
     * Start the scheduler
     */
    start(taskFunction) {
        if (this.isRunning) {
            this.logger.warn('Scheduler already running');
            return;
        }

        if (typeof taskFunction !== 'function') {
            throw new Error('Task function is required');
        }

        this.taskFunction = taskFunction;
        this.isRunning = true;
        
        this.logger.info(`Starting scheduler with ${this.intervalMinutes} minute interval`);
        this.scheduleNext();
    }

    /**
     * Stop the scheduler
     */
    stop() {
        if (!this.isRunning) {
            return;
        }

        this.isRunning = false;
        if (this.currentTimer) {
            clearTimeout(this.currentTimer);
            this.currentTimer = null;
        }

        this.logger.info('Scheduler stopped');
    }

    /**
     * Pause the scheduler (can be resumed)
     */
    pause() {
        if (this.isRunning) {
            this.wasRunningBeforeSuspend = true;
            this.stop();
        }
    }

    /**
     * Update the interval and restart if running
     */
    updateInterval(newIntervalMinutes) {
        const wasRunning = this.isRunning;
        const taskFunction = this.taskFunction;
        
        if (wasRunning) {
            this.stop();
        }
        
        this.intervalMinutes = newIntervalMinutes;
        this.logger.info(`Interval updated to ${newIntervalMinutes} minutes`);
        
        if (wasRunning && taskFunction) {
            this.start(taskFunction);
        }
    }

    /**
     * Schedule the next execution
     */
    scheduleNext() {
        if (!this.isRunning) {
            return;
        }

        const intervalMs = this.intervalMinutes * 60 * 1000;
        
        this.currentTimer = setTimeout(() => {
            this.executeTask();
        }, intervalMs);
    }

    /**
     * Execute the scheduled task with basic retry logic
     */
    async executeTask() {
        if (!this.isRunning) {
            return;
        }

        try {
            // Check if user is idle
            const idleTime = powerMonitor.getSystemIdleTime();
            const idleMinutes = idleTime / 60;

            if (idleMinutes >= this.idleThresholdMinutes) {
                this.logger.debug(`User idle for ${idleMinutes.toFixed(1)} minutes, skipping execution`);
                this.scheduleNext();
                return;
            }

            // Execute the task with simple retry
            await this.executeWithRetry();
            this.logger.debug('Task executed successfully');

        } catch (error) {
            this.logger.error('Task execution failed:', error.message);
        }

        // Always schedule next execution
        this.scheduleNext();
    }

    /**
     * Execute task with basic retry logic
     */
    async executeWithRetry() {
        let lastError;
        
        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                await this.taskFunction();
                return; // Success
            } catch (error) {
                lastError = error;
                this.logger.warn(`Task attempt ${attempt} failed: ${error.message}`);
                
                if (attempt < this.maxRetries) {
                    await this.sleep(2000); // 2 second retry delay
                }
            }
        }
        
        throw lastError;
    }

    /**
     * Force immediate execution (for testing)
     */
    async executeNow() {
        if (!this.taskFunction) {
            throw new Error('No task function configured');
        }

        this.logger.info('Executing task immediately (manual trigger)');
        await this.executeTask();
    }

    /**
     * Get basic scheduler status
     */
    getStatus() {
        return {
            isRunning: this.isRunning,
            intervalMinutes: this.intervalMinutes
        };
    }

    /**
     * Utility sleep function
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = SimpleRobustScheduler; 