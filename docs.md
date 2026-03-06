# Development Setup

This project is a Windows-focused Electron + TypeScript desktop app.

## Prerequisites

- Windows x64
- Node.js LTS
- npm
- A Google Gemini API key for AI analysis features

## Install

From the project root:

```powershell
npm install
```

## Run Locally

Build the app and start Electron:

```powershell
npm run start
```

What this does:

- compiles TypeScript into `dist/`
- copies renderer `.html` and `.css` files into `dist/renderer/`
- launches Electron

## Development Workflow

Current scripts in this repo:

```powershell
npm run dev
```

This starts TypeScript in watch mode only. It does not relaunch Electron for you.

Typical workflow:

1. In terminal one, run `npm run dev`
2. In terminal two, run `npm run start`
3. After TypeScript rebuilds, restart the Electron app manually if needed

## First App Setup

When the app opens:

1. Open settings
2. Paste your Gemini API key
3. Choose the screenshot interval
4. Start recording

Without an API key, tracking and AI analysis will stay disabled.

## Build Production Package

To create the Windows installer:

```powershell
npm run build
```

The packaged output is written to `release/`.

## Notes

- The project currently assumes Windows commands such as `xcopy`
- App entrypoint: `src/main/main.ts`
- Renderer files live in `src/renderer/`
- Built files go to `dist/`
