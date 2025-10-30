# Trimphone SDK

Trimphone is a TypeScript client library for connecting agents and services to the SystemX communication router. It provides a resilient connection lifecycle, call abstraction, and bidirectional stream tunnelling that makes it straightforward to move higher-level protocols over SystemX calls.

## Features

- Lightweight Trimphone client with pluggable transport interface (WebSocket by default)
- Inbound and outbound call management with typed events
- Message helpers for text, JSON, and binary payloads
- Duplex stream tunnelling for protocol forwarding (stdio, HTTP, SSH, etc.)
- Test-friendly architecture with mockable transport layer

## Quick Start

```ts
import { Trimphone } from "trimphone";

const phone = new Trimphone("wss://systemx.example.com:2096");

await phone.register("agent@example.com");

phone.on("ring", (call) => {
  console.log(`Incoming call from ${call.from}`);
  call.answer();

  call.on("message", (msg) => {
    console.log("Received:", msg);
    call.send({ echo: msg }, "json");
  });
});
```

Dial another address:

```ts
const call = await phone.dial("service@example.com");
call.send("Hello from Trimphone");

call.on("message", (msg) => {
  console.log("Reply:", msg);
  call.hangup();
});
```

### Stream Tunnelling

```ts
import { createInterface } from "node:readline";

const call = await phone.dial("shell@example.com");
const stream = call.getStream();

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

stream.pipe(process.stdout);
rl.on("line", (line) => stream.write(`${line}\n`));

call.on("hangup", () => {
  rl.close();
  console.log("Session ended");
});
```

### Custom Transport

You can swap the underlying transport (for example, to use QUIC) by providing a factory:

```ts
import { Trimphone, type Transport } from "trimphone";
import { createQuicTransport } from "./quicTransport"; // your implementation

const phone = new Trimphone(["wss://primary", "wss://backup"], {
  transportFactory: () => createQuicTransport() as Transport,
});
```

### Process Tunnelling

Trimphone can bridge calls to in-process components or OS-level processes via the universal process interface:

```ts
import { Trimphone, MemoryProcess, spawnNodeProcess } from "trimphone";

const phone = new Trimphone(url);
await phone.register("uppercase@trimphone.io");

phone.on("ring", (call) => {
  call.answer();

  // In-memory component that uppercases text
  const process = new MemoryProcess(async (input) => input.toUpperCase());
  void call.tunnel(process);
});

// Bridge to a real bash shell
phone.on("ring", (call) => {
  call.answer();
  const shell = spawnNodeProcess("bash", ["-i"]);
  void call.tunnel(shell, {
    onStderrChunk: (chunk) => {
      console.error(`[shell stderr] ${Buffer.from(chunk).toString()}`);
    },
  });
});
```

Processes expose Web Streams (`stdin`, `stdout`, optional `stderr`), making the model portable across Node, browsers, and React Native once platform adapters are supplied.

In browser environments, use `call.getWebStream()` to access `{ readable, writable }` streams instead of the Node.js `Duplex` returned by `getStream()`.

### Browser Usage (Preview)

Trimphone can run in the browser by swapping in the `BrowserWebSocketTransport`. For simple message flows:

```ts
import { Trimphone, BrowserWebSocketTransport } from "trimphone";

const phone = new Trimphone("wss://systemx.example.com", {
  transportFactory: () => new BrowserWebSocketTransport(),
});

await phone.register("web-client@example.com");

const call = await phone.dial("echo@services.io");
call.send("Hello from the browser!");

call.on("message", (msg) => {
  console.log("Reply", msg);
});
```

Web-stream tunnelling support (`BrowserTunnelStream`) is available for experimentation and will back `call.getStream()` in an upcoming release.

See `examples/browser-echo.ts` for a minimal DOM demo (suitable for bundlers like Vite/Parcel). It registers a web client, dials another Trimphone address, and exposes a local echo responder using the process catalog.

For a turnkey project, check out `examples/browser-starter` which ships with Vite configuration, UI scaffolding, and instructions.

Reusable components built on this abstraction live under `trimphone/process`. For example:

```ts
import { UppercaseProcess, EchoProcess } from "trimphone";

phone.on("ring", (call) => {
  call.answer();
  void call.tunnel(new UppercaseProcess());
});

// Dial side
const call = await phone.dial("uppercase@trimphone.io");
call.send("Trimphone rules!\n");
```

Current catalog: `EchoProcess`, `UppercaseProcess`, `PrefixProcess`, `SuffixProcess`, with more on the roadmap (HTTP proxy, AI agents, etc.).

## Development

- Install dependencies with `bun install`
- Run unit tests with `bun test`
- Run live SystemX tests with `bun run src/cli.ts test --live` (set `SYSTEMX_URL` if different)
- Build distributable output with `bun run build`

The repository includes Bun-based tests that exercise the core Trimphone behaviours, heartbeat/reconnect logic, and the tunnelling stream implementation. Mock transports in the tests demonstrate how to integrate alternate transport backends.

Trimphone also ships with a CLI entrypoint. After building (or via Bun during development) you can run:

```bash
trimphone test --live --url wss://engram-fi-1.entrained.ai:2096
```

This executes the same echo, stream, and stdio end-to-end tests against a live SystemX deployment.

## Next Steps

- Presence and status APIs
- Richer dial metadata and call progress events
- Additional examples (HTTP proxy, advanced tunnelling)
- Optional CI wiring for automated live test runs

Contributions are welcome! See the `docs/Trimphone.md` brief for the full roadmap.

## Licensing

This project uses a **dual licensing model**:

- **MIT License** - Free for individuals, education, and community projects
- **Commercial License** - For proprietary or revenue-generating use

If your organization uses SystemX in a product, service, or platform, please reach out: **license@foundation42.org**

See [LICENSE](LICENSE) and [LICENSE-MIT](LICENSE-MIT) for details.
