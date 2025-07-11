const { screen } = require('electron');
const screenshot = require('screenshot-desktop');
const { windowManager } = require('node-window-manager');
const sharp = require('sharp');

class ScreenshotCapture {
    constructor(logger) {
        this.logger = logger;
    }

    /**
     * Find the display that has the most overlap with the active window
     * @param {Object} windowBounds - Bounds of the active window
     * @param {Array} displays - Array of available displays
     * @param {Array} availableDisplays - Available displays from screenshot-desktop
     * @returns {string|null} - Display ID or null if not found
     */
    findBestDisplay(windowBounds, displays, availableDisplays) {
        let maxOverlap = 0;
        let targetDisplayId = null;

        displays.forEach((display, index) => {
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
    async captureScreenshot() {
        try {
            this.logger.info('Starting screenshot capture...');
            
            // Get active window and display information
            const activeWindow = windowManager.getActiveWindow();
            const displays = screen.getAllDisplays();
            let imgBuffer;
            
            if (activeWindow) {
                const windowBounds = activeWindow.getBounds();
                
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
            if (!imgBuffer) {
                const displays = await screenshot.listDisplays();
                imgBuffer = await screenshot({ screen: displays[0].id });
                this.logger.info('Screenshot captured from primary display (fallback)');
            }

            return imgBuffer;
        } catch (error) {
            this.logger.error('Error capturing screenshot:', error.message);
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
    async createThumbnail(imgBuffer, width = 200, height = 150) {
        try {
            this.logger.info('Creating thumbnail...');
            
            const thumbnailBuffer = await sharp(imgBuffer)
                .resize(width, height, { fit: 'inside' })
                .toBuffer();
            
            this.logger.info('Thumbnail created successfully');
            return thumbnailBuffer;
        } catch (error) {
            this.logger.error('Error creating thumbnail:', error.message);
            throw error;
        }
    }

    /**
     * Capture screenshot and create thumbnail in one operation
     * @param {number} thumbnailWidth - Thumbnail width (default: 200)
     * @param {number} thumbnailHeight - Thumbnail height (default: 150)
     * @returns {Promise<{imgBuffer: Buffer, thumbnailBuffer: Buffer}>}
     */
    async captureWithThumbnail(thumbnailWidth = 200, thumbnailHeight = 150) {
        try {
            const imgBuffer = await this.captureScreenshot();
            const thumbnailBuffer = await this.createThumbnail(imgBuffer, thumbnailWidth, thumbnailHeight);
            
            return {
                imgBuffer,
                thumbnailBuffer
            };
        } catch (error) {
            this.logger.error('Error in captureWithThumbnail:', error.message);
            throw error;
        }
    }
}

module.exports = ScreenshotCapture; 