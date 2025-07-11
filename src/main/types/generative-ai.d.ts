declare module '@google/generative-ai' {
    interface GenerationConfig {
        temperature?: number;
        maxOutputTokens?: number;
        responseMimeType?: string;
        responseSchema?: {
            type: string;
            properties: Record<string, any>;
            required?: string[];
        };
    }

    interface GenerateContentRequest {
        model: string;
        contents: string | Array<{
            parts: Array<{
                text?: string;
                fileData?: {
                    mimeType: string;
                    fileUri: string;
                };
            }>;
        }>;
        config?: GenerationConfig;
    }

    interface GenerateContentResponse {
        text: string;
    }

    interface FileUploadResponse {
        uri: string;
        name: string;
        mimeType: string;
    }

    interface FileAPI {
        upload(options: {
            file: string;
            mimeType: string;
            displayName: string;
        }): Promise<FileUploadResponse>;
    }

    interface ModelAPI {
        generateContent(request: GenerateContentRequest): Promise<GenerateContentResponse>;
    }

    export class GoogleGenerativeAI {
        constructor(apiKey: string);
        files: FileAPI;
        models: ModelAPI;
    }
} 