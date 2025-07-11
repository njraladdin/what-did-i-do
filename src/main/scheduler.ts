import { powerMonitor } from 'electron';
import { Logger } from './logger';

interface SchedulerOptions {
    intervalMinutes?: number;
    maxRetries?: number;
    idleThresholdMinutes?: number;
}

type TaskFunction = () => Promise<void>;

class SimpleRobustScheduler {
    private readonly logger: Logger;
    private intervalMinutes: number;
    private readonly maxRetries: number;
    private readonly idleThresholdMinutes: number;
    
    private isRunning: boolean;
    private currentTimer: NodeJS.Timeout | null;
    private taskFunction: TaskFunction | null;
    private wasRunningBeforeSuspend: boolean;

    constructor(logger: Logger, options: SchedulerOptions = {}) {
        this.logger = logger;
        this.intervalMinutes = options.intervalMinutes || 1;
        this.maxRetries = options.maxRetries || 2;
        this.idleThresholdMinutes = options.idleThresholdMinutes || 5;
        
        // Essential state only
        this.isRunning = false;
        this.currentTimer = null;
        this.taskFunction = null;
        this.wasRunningBeforeSuspend = false;
        
        this.setupPowerMonitoring();
    }

    /**
     * Setup power monitoring for system integration
     */
    private setupPowerMonitoring(): void {
        powerMonitor.on('suspend', () => {
            this.logger.info('System suspended, pausing scheduler');
            this.pause();
        });

        powerMonitor.on('resume', () => {
            this.logger.info('System resumed, resuming scheduler');
            if (this.wasRunningBeforeSuspend) {
                this.start(this.taskFunction!);
            }
        });
    }

    /**
     * Start the scheduler
     */
    start(taskFunction: TaskFunction): void {
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
    stop(): void {
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
    pause(): void {
        if (this.isRunning) {
            this.wasRunningBeforeSuspend = true;
            this.stop();
        }
    }

    /**
     * Update the interval and restart if running
     */
    updateInterval(newIntervalMinutes: number): void {
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
    private scheduleNext(): void {
        if (!this.isRunning) {
            return;
        }

        const intervalMs = this.intervalMinutes * 60 * 1000;
        
        this.currentTimer = setTimeout(() => {
            void this.executeTask();
        }, intervalMs);
    }

    /**
     * Execute the scheduled task with basic retry logic
     */
    private async executeTask(): Promise<void> {
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
            this.logger.error('Task execution failed:', (error as Error).message);
        }

        // Always schedule next execution
        this.scheduleNext();
    }

    /**
     * Execute task with basic retry logic
     */
    private async executeWithRetry(): Promise<void> {
        let lastError: Error | null = null;
        
        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                await this.taskFunction!();
                return; // Success
            } catch (error) {
                lastError = error as Error;
                this.logger.warn(`Task attempt ${attempt} failed: ${(error as Error).message}`);
                
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
    async executeNow(): Promise<void> {
        if (!this.taskFunction) {
            throw new Error('No task function configured');
        }

        this.logger.info('Executing task immediately (manual trigger)');
        await this.executeTask();
    }

    /**
     * Get basic scheduler status
     */
    getStatus(): { isRunning: boolean; intervalMinutes: number } {
        return {
            isRunning: this.isRunning,
            intervalMinutes: this.intervalMinutes
        };
    }

    /**
     * Utility sleep function
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

export default SimpleRobustScheduler; 