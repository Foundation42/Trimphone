# 📞 Trimphone SDK - Implementation Brief

## Overview

Trimphone is a client SDK for SystemX, a WebSocket-based communication router modeled after telephone exchanges. Trimphone provides a clean, intuitive API for building agents and services that communicate over SystemX, with a focus on protocol tunneling to enable transparent transport of arbitrary protocols (HTTP, SSH, stdio, MIDI, etc.) over SystemX calls.

---

## Project Goals

1. **Simple Core API** - Clean abstractions for registration, calling, and messaging
2. **Protocol Tunneling** - Transparent bidirectional stream support for tunneling any protocol
3. **TypeScript-First** - Full type safety and excellent DX
4. **Well-Tested** - Comprehensive unit and integration tests
5. **Production-Ready** - Error handling, reconnection, proper cleanup

---

## SystemX Protocol Overview

SystemX uses a simple JSON-over-WebSocket protocol with these core message types:

### Registration & Lifecycle
```typescript
// Client → Server: Register an address
{
  "type": "REGISTER",
  "address": "agent@domain.tld",
  "metadata": {
    "capabilities": ["chat", "api"],
    "status": "available"
  },
  "concurrency": "single" | "broadcast" | "parallel"
}

// Server → Client: Confirmation
{
  "type": "REGISTERED",
  "address": "agent@domain.tld",
  "session_id": "uuid"
}

// Client → Server: Unregister
{
  "type": "UNREGISTER"
}

// Client → Server: Heartbeat
{
  "type": "HEARTBEAT"
}

// Server → Client: Heartbeat ack
{
  "type": "HEARTBEAT_ACK",
  "timestamp": 1234567890
}
```

### Calling
```typescript
// Caller → Server: Initiate call
{
  "type": "DIAL",
  "to": "recipient@domain.tld",
  "metadata": { "subject": "..." }
}

// Server → Callee: Incoming call
{
  "type": "RING",
  "from": "caller@domain.tld",
  "call_id": "uuid",
  "metadata": {...}
}

// Callee → Server: Accept call
{
  "type": "ANSWER",
  "call_id": "uuid"
}

// Server → Caller: Call connected
{
  "type": "CONNECTED",
  "call_id": "uuid",
  "to": "recipient@domain.tld"
}

// Either party: Send message
{
  "type": "MSG",
  "call_id": "uuid",
  "data": "message content or base64 binary",
  "content_type": "text" | "json" | "binary"
}

// Either party: End call
{
  "type": "HANGUP",
  "call_id": "uuid"
}

// Server → Caller: Recipient unavailable
{
  "type": "BUSY",
  "to": "recipient@domain.tld",
  "reason": "already_in_call" | "dnd" | "offline" | "no_such_address"
}
```

### Status Updates
```typescript
{
  "type": "STATUS",
  "status": "available" | "busy" | "dnd" | "away"
}
```

---

## Core API Design

### Trimphone Class

```typescript
class Trimphone {
  constructor(url: string | string[], options?: TrimphoneOptions)
  
  // Connection management
  register(address: string, options?: RegisterOptions): Promise<void>
  unregister(): Promise<void>
  
  // Calling
  dial(to: string, options?: DialOptions): Promise<Call>
  onRing(handler: (call: Call) => void): void
  
  // Status management
  setStatus(status: 'available' | 'busy' | 'dnd' | 'away'): void
  
  // Event handling
  on(event: string, handler: (...args: any[]) => void): void
  off(event: string, handler: (...args: any[]) => void): void
  
  // Cleanup
  close(): Promise<void>
}

interface TrimphoneOptions {
  autoReconnect?: boolean
  heartbeatInterval?: number
  debug?: boolean
}

interface RegisterOptions {
  metadata?: Record<string, any>
  concurrency?: 'single' | 'broadcast' | 'parallel'
  maxSessions?: number
  maxListeners?: number
}

interface DialOptions {
  metadata?: Record<string, any>
  timeout?: number
}
```

### Call Class

```typescript
class Call {
  // Properties
  readonly id: string
  readonly from: string
  readonly to: string
  readonly state: 'ringing' | 'connected' | 'ended'
  readonly metadata?: Record<string, any>
  
  // Basic messaging
  send(data: string | object | Buffer): void
  onMessage(handler: (data: any) => void): void
  
  // Stream tunneling (CORE FEATURE)
  getStream(options?: StreamOptions): Duplex
  
  // Protocol-specific helpers
  asStdio(): StdioStream
  
  // Lifecycle
  answer(): void
  hangup(): void
  onHangup(handler: (reason?: string) => void): void
  
  // Events
  on(event: string, handler: (...args: any[]) => void): void
  off(event: string, handler: (...args: any[]) => void): void
}

interface StreamOptions {
  encoding?: string
  highWaterMark?: number
}

// StdioStream is just a Duplex with helper methods
interface StdioStream extends Duplex {
  // Inherits all Duplex methods: pipe, write, on('data'), etc.
}
```

---

## Stream Tunneling Architecture

The key innovation of Trimphone is transparent protocol tunneling over SystemX calls.

### Concept

When you call `getStream()` on a Call, Trimphone returns a Node.js Duplex stream that:
1. Writes to the stream → chunks into MSG messages → sends over SystemX
2. Receives MSG messages → reassembles chunks → emits on the stream

This allows ANY protocol to be tunneled transparently:
- stdio (for remote CLI tools)
- HTTP (for API proxying)
- SSH (for remote shells)
- MIDI (for music gear)
- Custom protocols

### Implementation Strategy

**Message Framing:**
```typescript
// For stream data, use MSG with binary content_type
{
  "type": "MSG",
  "call_id": "uuid",
  "data": "base64-encoded-chunk",
  "content_type": "binary"
}
```

**TunnelStream Class:**
```typescript
class TunnelStream extends Duplex {
  constructor(call: Call, options?: StreamOptions)
  
  _write(chunk: Buffer, encoding: string, callback: Function): void
  _read(size: number): void
  
  // Internal methods
  private handleIncomingData(data: Buffer): void
  private sendChunk(chunk: Buffer): void
}
```

**Flow:**
1. Application writes to stream
2. `_write()` sends chunk as MSG over SystemX call
3. Remote side receives MSG, pushes to their stream's read buffer
4. Remote application reads from stream

**Backpressure:**
- Respect Node.js stream backpressure signals
- Buffer chunks if remote side can't keep up
- Emit 'drain' when ready for more data

---

## Project Structure

```
trimphone/
├── src/
│   ├── Trimphone.ts          # Main client class
│   ├── Call.ts               # Call abstraction
│   ├── Connection.ts         # WebSocket connection management
│   ├── TunnelStream.ts       # Stream tunneling implementation
│   ├── types.ts              # TypeScript interfaces
│   ├── utils.ts              # Helpers (address validation, etc.)
│   └── constants.ts          # Default values, timeouts
├── examples/
│   ├── simple-agent.ts       # Basic agent that answers calls
│   ├── echo-server.ts        # Echo service using streams
│   ├── echo-client.ts        # Client connecting to echo server
│   ├── stdio-server.ts       # Generic stdio tunnel server
│   ├── stdio-client.ts       # Generic stdio tunnel client
│   └── README.md
├── tests/
│   ├── unit/
│   │   ├── Trimphone.test.ts
│   │   ├── Call.test.ts
│   │   ├── TunnelStream.test.ts
│   │   └── utils.test.ts
│   └── integration/
│       ├── calling.test.ts
│       ├── messaging.test.ts
│       ├── streaming.test.ts
│       └── reconnection.test.ts
├── package.json
├── tsconfig.json
├── .gitignore
└── README.md
```

---

## Implementation Requirements

### Core Functionality

1. **WebSocket Connection Management**
   - Connect to SystemX server
   - Handle connection open/close/error
   - Auto-reconnect on disconnect (if enabled)
   - Proper cleanup on close

2. **Registration Lifecycle**
   - Send REGISTER on connect
   - Handle REGISTERED/REGISTER_FAILED
   - Send UNREGISTER on close
   - Auto-reregister on reconnect

3. **Heartbeat Management**
   - Send HEARTBEAT at regular intervals
   - Handle HEARTBEAT_ACK
   - Detect connection loss if no ack received

4. **Call Management**
   - Outbound calls: DIAL → wait for CONNECTED/BUSY
   - Inbound calls: RING → emit event → ANSWER
   - Track active calls by call_id
   - Handle HANGUP from either side
   - Proper cleanup when call ends

5. **Message Routing**
   - Route MSG to correct Call instance by call_id
   - Support text, JSON, and binary content types
   - Handle message serialization/deserialization

6. **Stream Tunneling** ⭐
   - TunnelStream as Node.js Duplex
   - Chunk outgoing data into MSG
   - Reassemble incoming MSG into stream
   - Handle backpressure correctly
   - Support binary data (base64 encoding)
   - Proper stream cleanup on call end

7. **Error Handling**
   - Invalid messages (log, don't crash)
   - Connection errors (reconnect if enabled)
   - Call failures (BUSY, timeout)
   - Stream errors (cleanup, emit error events)

8. **Event System**
   - Standard EventEmitter pattern
   - Events: 'connected', 'disconnected', 'registered', 'ring', 'error', etc.
   - Call events: 'message', 'hangup', 'error'

---

## Testing Requirements

### Unit Tests

**Trimphone:**
- Constructor with various options
- register() success and failure
- dial() success and BUSY responses
- onRing() handler registration
- setStatus() updates
- Event emission (connected, disconnected, etc.)
- Auto-reconnect logic
- Proper cleanup on close()

**Call:**
- send() with different data types (string, object, Buffer)
- onMessage() handler registration
- answer() sends ANSWER message
- hangup() sends HANGUP and cleans up
- getStream() returns Duplex
- Event emission (message, hangup, error)

**TunnelStream:**
- write() chunks data into MSG
- read() returns data from received MSG
- Backpressure handling
- Binary data support (base64)
- Proper cleanup on stream end
- Error handling

**Utils:**
- Address validation (must be email-style: agent@domain.tld)
- Message serialization/deserialization
- Helper functions

### Integration Tests

**Calling Flow:**
- Two Trimphone instances connect to SystemX
- Instance A dials instance B
- Instance B receives RING, answers
- Both get CONNECTED
- Exchange messages
- Either side hangs up
- Both get HANGUP notification

**Streaming Flow:**
- Two Trimphone instances connect
- Instance A dials instance B
- Both get streams via getStream()
- Pipe data bidirectionally
- Verify data integrity (send bytes, receive same bytes)
- Test large data transfers (multiple chunks)
- Test backpressure (fast sender, slow receiver)
- Hangup and verify streams end properly

**Stdio Tunneling:**
- Server exposes a process's stdio via asStdio()
- Client connects and gets stdio stream
- Send commands via stream
- Receive output via stream
- Verify interactive behavior works

**Error Scenarios:**
- Dial non-existent address → BUSY
- Dial busy address → BUSY
- Connection loss during call → proper cleanup
- Invalid messages → logged, not crashed
- Stream errors → proper error events

**Reconnection:**
- Disconnect from server
- Auto-reconnect (if enabled)
- Re-register after reconnect
- Resume functionality

---

## Example Usage

### Simple Agent

```typescript
import { Trimphone } from 'trimphone';

const phone = new Trimphone('wss://systemx.domain.tld:[port]');

await phone.register('helper@ai.bot');

phone.onRing((call) => {
  console.log(`Call from ${call.from}`);
  call.answer();
  
  call.onMessage((msg) => {
    console.log('Received:', msg);
    call.send(`Echo: ${msg}`);
  });
  
  call.onHangup(() => {
    console.log('Call ended');
  });
});

console.log('Waiting for calls...');
```

### Dialing Another Agent

```typescript
import { Trimphone } from 'trimphone';

const phone = new Trimphone('wss://systemx.domain.tld:[port]');

await phone.register('caller@example.com');

const call = await phone.dial('helper@ai.bot');

call.send('Hello!');

call.onMessage((response) => {
  console.log('Response:', response);
  call.hangup();
});
```

### Stream Tunneling (Echo Server)

```typescript
import { Trimphone } from 'trimphone';

const phone = new Trimphone('wss://systemx.domain.tld:[port]');

await phone.register('echo@services.io');

phone.onRing((call) => {
  call.answer();
  
  const stream = call.getStream();
  
  // Echo everything back
  stream.pipe(stream);
  
  console.log('Echo session started');
});
```

### Stream Tunneling (Client)

```typescript
import { Trimphone } from 'trimphone';

const phone = new Trimphone('wss://systemx.domain.tld:[port]');

await phone.register('client@example.com');

const call = await phone.dial('echo@services.io');
const stream = call.getStream();

// Send data
stream.write('Hello, world!\n');

// Receive echoed data
stream.on('data', (chunk) => {
  console.log('Echoed:', chunk.toString());
});

// Or pipe to stdout
stream.pipe(process.stdout);
```

### Stdio Tunneling

```typescript
import { Trimphone } from 'trimphone';
import { spawn } from 'child_process';

const phone = new Trimphone('wss://systemx.domain.tld:[port]');

await phone.register('service@backend.io');

phone.onRing((call) => {
  call.answer();
  
  // Spawn a process
  const proc = spawn('node', ['worker.js']);
  
  // Get stdio stream
  const stdio = call.asStdio();
  
  // Pipe bidirectionally
  proc.stdout.pipe(stdio);
  stdio.pipe(proc.stdin);
  
  proc.on('exit', () => {
    call.hangup();
  });
  
  call.onHangup(() => {
    proc.kill();
  });
});
```

---

## Technical Notes

### Address Validation

SystemX requires email-style addresses: `agent@domain.tld`

Trimphone should validate addresses before sending REGISTER or DIAL:
- Must contain exactly one `@`
- Local part (before `@`) must be non-empty
- Domain part (after `@`) must be non-empty and contain at least one `.`

### Binary Data Handling

SystemX MSG can carry binary data as base64-encoded strings with `content_type: "binary"`.

When using streams:
- Outgoing: Buffer → base64 → MSG
- Incoming: MSG → base64 decode → Buffer → push to stream

### Heartbeat Timing

Default heartbeat interval: 30 seconds  
Missing 2 consecutive heartbeats = connection considered dead

### Concurrency Modes

- **single**: Only one call at a time (default)
- **broadcast**: Multiple listeners, all hear same messages
- **parallel**: Multiple independent sessions

Trimphone should support registering with these modes, but core functionality works with all modes.

### Reconnection Strategy

If `autoReconnect: true`:
1. On disconnect, wait 1 second
2. Attempt reconnect
3. On success, re-register with same address
4. On failure, exponential backoff (2s, 4s, 8s, max 30s)

### Error Events

Trimphone and Call should emit 'error' events rather than throwing:
```typescript
phone.on('error', (err) => {
  console.error('Trimphone error:', err);
});

call.on('error', (err) => {
  console.error('Call error:', err);
});
```

---

## Success Criteria

**Phase 1 Complete When:**
- ✅ Two Trimphone instances can register and dial each other
- ✅ Messages flow bidirectionally
- ✅ Calls can be hung up cleanly
- ✅ Streams work for echo test (send bytes, receive same bytes)
- ✅ Stdio tunneling example works (process interaction via stream)
- ✅ All unit tests pass
- ✅ All integration tests pass
- ✅ README has clear setup and usage instructions
- ✅ Examples demonstrate core functionality

---

## References

- SystemX server: `wss://systemx.domain.tld:[port]`
- SystemX protocol docs: See SystemX repository
- Node.js Duplex streams: https://nodejs.org/api/stream.html#class-streamduplex

---

## Notes for Implementation

- Use Bun or Node.js (both should work)
- TypeScript with strict mode
- Use `ws` package for WebSocket (or Bun's built-in WebSocket)
- Use `EventEmitter` for event handling
- Use Node.js `stream.Duplex` for TunnelStream
- Focus on correctness first, optimization later
- Comprehensive error handling (don't crash on bad messages)
- Clean abstractions (Trimphone, Call, TunnelStream are independent)

---
