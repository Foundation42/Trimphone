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

## Development

- Install dependencies with `bun install`
- Run unit tests with `bun test`
- Build distributable output with `bun run build`

The repository includes Bun-based tests that exercise the core Trimphone behaviours and the tunnelling stream implementation. Mock transports in the tests demonstrate how to integrate alternate transport backends.

## Next Steps

- Auto-reconnect with backoff and state restoration
- Presence and status APIs
- Richer dial metadata and call progress events
- Additional examples (echo server, stdio bridge)

Contributions are welcome! See the `docs/Trimphone.md` brief for the full roadmap.
