import { screen, Screen, Display } from 'electron';
import screenshot from 'screenshot-desktop';
import { windowManager, Window } from 'node-window-manager';
import sharp from 'sharp';
import { Logger } from './logger';

interface WindowBounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

interface DisplayInfo {
    id: string;
    [key: string]: any;
}

class ScreenshotCapture {
    private readonly logger: Logger;

    constructor(logger: Logger) {
        this.logger = logger;
    }

    /**
     * Find the display that has the most overlap with the active window
     * @param {WindowBounds} windowBounds - Bounds of the active window
     * @param {Display[]} displays - Array of available displays
     * @param {DisplayInfo[]} availableDisplays - Available displays from screenshot-desktop
     * @returns {string|null} - Display ID or null if not found
     */
    findBestDisplay(windowBounds: WindowBounds, displays: Display[], availableDisplays: DisplayInfo[]): string | null {
        let maxOverlap = 0;
        let targetDisplayId: string | null = null;

        displays.forEach((display: Display, index: number) => {
            const dBounds = display.bounds;
            const xOverlap = Math.max(0, 
                Math.min(windowBounds.x + windowBounds.width, dBounds.x + dBounds.width) - 
                Math.max(windowBounds.x, dBounds.x)
            );
            
            const yOverlap = Math.max(0,
                Math.min(windowBounds.y + windowBounds.height, dBounds.y + dBounds.height) - 
                Math.max(windowBounds.y, dBounds.y)
            );
            
            const overlapArea = xOverlap * yOverlap;

            if (overlapArea > maxOverlap) {
                maxOverlap = overlapArea;
                targetDisplayId = availableDisplays[index].id;
            }
        });

        return targetDisplayId;
    }

    /**
     * Capture screenshot from the best available display
     * @returns {Promise<Buffer>} - Screenshot image buffer
     */
    async captureScreenshot(): Promise<Buffer> {
        try {
            this.logger.info('Starting screenshot capture...');
            
            // Get active window and display information
            const activeWindow = windowManager.getActiveWindow();
            const displays = screen.getAllDisplays();
            let imgBuffer: Buffer;
            
            if (activeWindow) {
                const rawBounds = activeWindow.getBounds();
                // Ensure all properties are numbers with fallbacks
                const windowBounds: WindowBounds = {
                    x: rawBounds.x ?? 0,
                    y: rawBounds.y ?? 0,
                    width: rawBounds.width ?? 0,
                    height: rawBounds.height ?? 0
                };
                
                // Get all available displays from screenshot-desktop
                const availableDisplays = await screenshot.listDisplays();

                // Find the display with the most overlap
                const targetDisplayId = this.findBestDisplay(windowBounds, displays, availableDisplays);

                if (targetDisplayId) {
                    imgBuffer = await screenshot({ screen: targetDisplayId });
                    this.logger.info('Screenshot captured from active window display');
                }
            }

            // Fallback to primary display if needed
            if (!imgBuffer!) {
                const displays = await screenshot.listDisplays();
                imgBuffer = await screenshot({ screen: displays[0].id });
                this.logger.info('Screenshot captured from primary display (fallback)');
            }

            return imgBuffer!;
        } catch (error) {
            this.logger.error('Error capturing screenshot:', (error as Error).message);
            throw error;
        }
    }

    /**
     * Create a thumbnail from an image buffer
     * @param {Buffer} imgBuffer - Original image buffer
     * @param {number} width - Thumbnail width (default: 200)
     * @param {number} height - Thumbnail height (default: 150)
     * @returns {Promise<Buffer>} - Thumbnail image buffer
     */
    async createThumbnail(imgBuffer: Buffer, width = 200, height = 150): Promise<Buffer> {
        try {
            this.logger.info('Creating thumbnail...');
            
            const thumbnailBuffer = await sharp(imgBuffer)
                .resize(width, height, { fit: 'inside' })
                .toBuffer();
            
            this.logger.info('Thumbnail created successfully');
            return thumbnailBuffer;
        } catch (error) {
            this.logger.error('Error creating thumbnail:', (error as Error).message);
            throw error;
        }
    }

    /**
     * Capture screenshot and create thumbnail in one operation
     * @param {number} thumbnailWidth - Thumbnail width (default: 200)
     * @param {number} thumbnailHeight - Thumbnail height (default: 150)
     * @returns {Promise<{imgBuffer: Buffer, thumbnailBuffer: Buffer}>}
     */
    async captureWithThumbnail(thumbnailWidth = 200, thumbnailHeight = 150): Promise<{imgBuffer: Buffer, thumbnailBuffer: Buffer}> {
        try {
            const imgBuffer = await this.captureScreenshot();
            const thumbnailBuffer = await this.createThumbnail(imgBuffer, thumbnailWidth, thumbnailHeight);
            
            return {
                imgBuffer,
                thumbnailBuffer
            };
        } catch (error) {
            this.logger.error('Error in captureWithThumbnail:', (error as Error).message);
            throw error;
        }
    }
}

export default ScreenshotCapture; 