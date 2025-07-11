declare module 'screenshot-desktop' {
    interface DisplayInfo {
        id: string;
        name?: string;
        [key: string]: any;
    }

    interface ScreenshotOptions {
        screen?: string;
        [key: string]: any;
    }

    function screenshot(options?: ScreenshotOptions): Promise<Buffer>;
    namespace screenshot {
        function listDisplays(): Promise<DisplayInfo[]>;
    }

    export = screenshot;
} 