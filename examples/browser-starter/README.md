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
npm run dev -- --host
```

Then open the printed local URL (default `http://localhost:5173`). Use `--host` if you want to test from other devices.

### Bun Dev Server

You can also use Bun’s built-in dev server:

```bash
bun install
bun run index.html
```

This automatically polyfills Node globals for the browser build.

### Environment Variables

Override the SystemX endpoint via environment variable or `.env` file:

```bash
VITE_SYSTEMX_URL=wss://your-systemx.example.com npm run dev -- --host
```

## What It Shows

- Registers a browser handset using `BrowserWebSocketTransport`
- Dials another Trimphone address and sends messages via Web Streams
- Answers inbound calls with the catalog `EchoProcess`
- Displays multi-call status (dialling, active, ended, failed) in real time

Swap the echo handler with other catalog processes or your own logic to expand the behaviour.

## Building & Deploying

```bash
npm run build
npx vite preview
```

For Bun users:

```bash
bun run build
bun run preview
```

The produced `dist/` directory is ready to serve via any static host or edge platform.
