import { BrowserWindow, Tray } from 'electron';
import { Logger } from 'winston';
import SimpleRobustScheduler from '../scheduler';
import ScreenshotCapture from '../screenshot';
import { GoogleGenAI } from '@google/genai';

export interface AppState {
  mainWindow: BrowserWindow | null;
  isTracking: boolean;
  ai: GoogleGenAI | null;
  scheduler: SimpleRobustScheduler | null;
  dayAnalysisScheduler: SimpleRobustScheduler | null;
  currentDate: Date;
  tray: Tray | null;
  isQuitting: boolean;
  hasShownMinimizeNotification: boolean;
  appLogger: Logger;
  screenshotCapture: ScreenshotCapture | null;
  lastAnalysisError: AnalysisError | null;
  lastActiveTime: number;
}

export interface AnalysisError {
  timestamp: string;
  message: string;
  type: string;
}

export interface AnalysisResponse {
  category: string;
  activity: string;
  description: string;
}

export interface GeminiApiResponse {
  success: boolean;
  error?: string;
}

export interface DayAnalysisData {
  screenshots: Array<{
    timestamp: string;
    category: string;
    activity: string;
    description: string;
  }>;
  notes: Array<{
    timestamp: string;
    content: string;
  }>;
  historicalData: {
    notes: Array<{
      timestamp: string;
      content: string;
    }>;
    analyses: Array<{
      timestamp: string;
      content: string;
    }>;
  };
} 