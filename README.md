# el-app-ws — Real-Time AI Voice Conversation via WebSocket

A **Next.js 15** application that streams microphone audio to a backend AI service over a persistent WebSocket connection and plays back the AI-generated audio response in real time. The app features automatic speech-activity detection (VAD) to interrupt AI playback when the user starts speaking.

---

## Table of Contents

1. [Overview](#overview)
2. [Tech Stack](#tech-stack)
3. [Project Structure](#project-structure)
4. [Architecture](#architecture)
   - [WebSocket Service](#websocket-service)
   - [Audio Pipeline](#audio-pipeline)
   - [Speech Detection](#speech-detection)
5. [WebSocket Event Protocol](#websocket-event-protocol)
6. [Environment Variables](#environment-variables)
7. [Getting Started](#getting-started)
8. [Available Scripts](#available-scripts)
9. [Usage](#usage)
10. [Deployment](#deployment)

---

## Overview

`el-app-ws` connects a browser to a WebSocket server that hosts an AI conversation engine. The key flow is:

1. The browser opens a persistent WebSocket connection on startup.
2. The user initiates a conversation session (unit / lesson / activation context).
3. The user clicks **Start Recording** — the microphone stream is captured, converted to PCM-16 chunks, Base64-encoded, and sent to the server in near-real time via an [AudioWorklet](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet).
4. The server returns Base64-encoded PCM-16 audio chunks which are decoded, queued, and played back through the [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API).
5. If the user starts speaking while the AI is talking, playback is interrupted immediately and the audio queue is cleared.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | [Next.js 15](https://nextjs.org/) (App Router, Turbopack) |
| Language | TypeScript 5 |
| UI Components | [shadcn/ui](https://ui.shadcn.com/) (Radix UI primitives) |
| Styling | Tailwind CSS 4 |
| Icons | [Lucide React](https://lucide.dev/) |
| Audio Capture | Web Audio API — `AudioWorkletNode` |
| Audio Encoding | PCM-16 mono @ 16 kHz, Base64 via `js-base64` |
| Audio Playback | Web Audio API — `AudioBufferSourceNode` @ 24 kHz |
| Real-time Transport | Native browser `WebSocket` |
| Session IDs | `uuid` v4 |

---

## Project Structure

```
el-app-ws/
├── public/
│   └── worklets/
│       └── audio-processor.js     # AudioWorkletProcessor — captures & encodes PCM-16
├── src/
│   ├── app/
│   │   ├── _custom-components/
│   │   │   ├── ConnectionInd.tsx  # Core UI + all WebSocket / audio logic
│   │   │   └── HomeView.tsx       # Dynamically imports ConnectionInd (SSR disabled)
│   │   ├── globals.css
│   │   ├── layout.tsx             # Root layout with Geist fonts
│   │   └── page.tsx               # Entry point — renders HomeView
│   ├── components/
│   │   └── ui/                    # shadcn/ui primitives (Button, etc.)
│   ├── lib/
│   │   └── utils.ts               # Tailwind class merging helper (cn)
│   └── utils/
│       └── websocket-service.ts   # Singleton WebSocket client with auto-reconnect
├── components.json                # shadcn/ui configuration
├── next.config.ts
├── package.json
└── tsconfig.json
```

---

## Architecture

### WebSocket Service

`src/utils/websocket-service.ts` exports a **singleton** `WebSocketService` class that extends Node's `EventEmitter`. It is instantiated once at module load time and shared across the application.

**Key behaviours:**

- **Auto-connect on startup** — `connect()` is called in the constructor.
- **Auto-reconnect with exponential back-off** — on `close`, reconnection is retried with a delay starting at 1 s and capped at 5 s. Attempts are unlimited (`maxReconnectionAttempts = Infinity`).
- **Event routing** — every incoming JSON message is emitted both as a generic `"message"` event and, if it contains an `event` property, as a named event (e.g. `"ai-audio-response"`).
- **`webSocketId`** — a short random string (`ws_<random>`) generated on each successful connection and included in every outgoing payload so the server can correlate requests.

### Audio Pipeline

```
Microphone (getUserMedia)
        │  16 kHz mono
        ▼
AudioWorkletNode ("audio-processor")
  • Accumulates Float32 samples in a 2 048-sample ring buffer
  • Converts to PCM-16 (Int16Array, little-endian)
  • Calculates RMS amplitude level (0-100)
  • Posts { pcmData: ArrayBuffer, level: number } to main thread
        │
        ▼
Main thread (ConnectionInd)
  • Base64-encodes the ArrayBuffer (js-base64)
  • Sends "conversation-stream-audio" WebSocket event
        │  (network)
        ▼
Backend AI service
  • Returns "ai-audio-response" events containing Base64 PCM-16 @ 24 kHz
        │
        ▼
Main thread (ConnectionInd)
  • Decodes Base64 → Int16Array → Float32Array
  • Pushes chunks into audioQueue
  • AudioBufferSourceNode plays each chunk sequentially @ 24 kHz
```

### Speech Detection

A lightweight energy-based VAD runs entirely in the main thread:

- `speechDetectionThreshold = 10` (0-100 scale).
- When the amplitude level exceeds the threshold, `isUserSpeaking` is set to `true` and any ongoing AI playback is stopped immediately.
- A 1-second silence timer resets `isUserSpeaking` to `false` after the user stops talking (debounced via `setTimeout`).

---

## WebSocket Event Protocol

All messages are JSON objects with the shape `{ event: string, data: object }`.

### Outgoing (client → server)

| Event | Trigger | Key payload fields |
|---|---|---|
| `connect-stream` | WebSocket connection established | `web_socket_id`, `session_id`, `user_id`, `unit_no`, `lesson_no`, `activation_no` |
| `conversation-initiate` | User clicks **Initiate Conversation** | same as above |
| `conversation-stream-audio` | Each audio chunk from the worklet | same as above + `audio_data` (Base64 PCM-16) |

### Incoming (server → client)

| Event | Meaning | Key data fields |
|---|---|---|
| `connect-stream-done` | Session is ready for conversation | — |
| `ai-audio-response` | AI audio chunk / stream end | `ai_audio_data` (Base64 PCM-16), `stream_end` (boolean) |
| `ai-text-response` | AI transcript (after stream ends) | `ai_transcribed_text` |

---

## Environment Variables

Create a `.env.local` file in the project root:

```env
# WebSocket server URL (required)
NEXT_PUBLIC_API_URL=wss://your-backend-server/ws
```

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_API_URL` | Full WebSocket URL the client connects to (e.g. `wss://api.example.com/ws`) |

---

## Getting Started

### Prerequisites

- **Node.js** ≥ 18
- **npm** ≥ 9 (or pnpm / yarn / bun)
- A running WebSocket backend that implements the [event protocol](#websocket-event-protocol) above

### Installation

```bash
git clone https://github.com/kusalkalinga00/flash-ws-testing.git
cd flash-ws-testing
npm install
```

### Configuration

```bash
cp .env.example .env.local   # or create .env.local manually
# Set NEXT_PUBLIC_API_URL to your WebSocket server
```

### Run the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

> **Note:** Microphone access requires a **secure context** (`https://` or `localhost`). The app will not request microphone permission on plain `http://` origins.

---

## Available Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start the development server with Turbopack hot-reload |
| `npm run build` | Compile and optimise for production |
| `npm run start` | Start the production server (requires a prior build) |
| `npm run lint` | Run ESLint across the project |

---

## Usage

1. Open the app. The WebSocket connection status indicator turns **green** once connected.
2. Click **Initiate Conversation** (enabled after `connect-stream-done` is received).
3. Click the **microphone (Mic)** button to start streaming your voice to the AI.
   - The audio level bar shows real-time amplitude.
   - Status shows **User speaking**, **AI speaking**, or **Listening**.
4. Click the **muted microphone (MicOff)** button to stop recording.

---

## Deployment

The recommended deployment target is [Vercel](https://vercel.com):

```bash
npm run build
# Deploy via Vercel CLI or connect the GitHub repository in the Vercel dashboard
```

Set the `NEXT_PUBLIC_API_URL` environment variable in your Vercel project settings before deploying.

For other platforms, run:

```bash
npm run build && npm run start
```

Refer to the [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for additional options.
