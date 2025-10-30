# Trimphone Browser Starter

A minimal Vite setup that demonstrates how to use the Trimphone SDK directly from the browser with the `BrowserWebSocketTransport` and Web Streams.

## Prerequisites

- Node.js 18+
- pnpm/npm/yarn (any package manager)
- Access to a SystemX endpoint (defaults to `wss://engram-fi-1.entrained.ai:2096`)

## Getting Started

```bash
cd trimphone/examples/browser-starter
npm install
npm run dev
```

Then open the printed local URL (default `http://localhost:5173`).

### Environment Variables

You can override the SystemX URL by creating a `.env` file or setting the `VITE_SYSTEMX_URL` variable when running Vite:

```bash
VITE_SYSTEMX_URL=wss://your-systemx.example.com npm run dev
```

## What It Shows

- Registers a browser handset using `BrowserWebSocketTransport`
- Dials another Trimphone address and sends messages via Web Streams
- Answers inbound calls with an in-memory `MemoryProcess` echo handler

Feel free to swap the echo handler with other catalog processes or your own logic.
