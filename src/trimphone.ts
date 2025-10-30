import { EventEmitter } from "node:events";
import type {
  TrimphoneOptions,
  RegisterOptions,
  DialOptions,
  TrimphoneEvents,
  SystemXInboundMessage,
  SystemXOutboundMessage,
  MessagePayload,
} from "./types";
import type { Transport, TransportFactory } from "./transport";
import { Call, type CallController } from "./call";
import { isValidAddress } from "./utils";
import { createWebSocketTransport } from "./transports/websocketTransport";
import { BrowserTunnelStream } from "./web/tunnelStream";
import { TunnelStream } from "./tunnelStream";

type EventKeys = keyof TrimphoneEvents;

type ConnectionState = "disconnected" | "connecting" | "connected";

interface Deferred<T> {
  resolve(value: T): void;
  reject(error: Error): void;
}

interface PendingDial {
  to: string;
  metadata?: Record<string, unknown>;
  deferred: Deferred<Call>;
}

const DEFAULTS = {
  autoReconnect: true,
  heartbeatIntervalMs: 30_000,
  heartbeatTimeoutMs: 60_000,
  reconnectBackoffMs: 1_000,
  maxReconnectBackoffMs: 30_000,
  registerOnConnect: true,
  debug: false,
} as const;

function encodeBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

function decodeBase64(data: unknown): Uint8Array {
  if (typeof data === "string") {
    if (typeof Buffer !== "undefined") {
      return new Uint8Array(Buffer.from(data, "base64"));
    }
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(data)) {
    return new Uint8Array(data);
  }
  return new Uint8Array();
}

function toNodeBuffer(bytes: Uint8Array): Buffer {
  if (typeof Buffer === "undefined") {
    throw new Error("Buffer is not available in this environment");
  }
  return Buffer.from(bytes);
}

export class Trimphone extends EventEmitter {
  private readonly urls: string[];
  private readonly transportFactory: TransportFactory;

  private readonly autoReconnect: boolean;
  private readonly heartbeatIntervalMs: number;
  private readonly heartbeatTimeoutMs: number;
  private readonly registerOnConnect: boolean;
  private readonly maxReconnectBackoffMs: number;
  private readonly debugEnabled: boolean;
  private readonly baseReconnectBackoffMs: number;

  private transport: Transport | null = null;
  private connectionState: ConnectionState = "disconnected";
  private connectPromise: Promise<void> | null = null;
  private sessionId: string | null = null;
  private registeredAddress: string | null = null;
  private registerOptions: Omit<RegisterOptions, "address"> | null = null;
  private registerDeferred: Deferred<void> | null = null;

  private readonly pendingDials: PendingDial[] = [];
  private readonly calls: Map<string, Call> = new Map();
  private readonly streams: Map<string, TunnelStream | BrowserTunnelStream> = new Map();
  private useWebStreams = false;

  private heartbeatTimer: NodeJS.Timeout | null = null;
  private heartbeatTimeoutTimer: NodeJS.Timeout | null = null;
  private lastHeartbeatAck = Date.now();

  private reconnectTimer: NodeJS.Timeout | null = null;
  private currentReconnectDelay: number;
  private shouldAttemptReconnect = true;
  private manualCloseRequested = false;

  constructor(url: string | string[], options: TrimphoneOptions = {}) {
    super();

    this.urls = Array.isArray(url) ? url : [url];
    if (this.urls.length === 0) {
      throw new Error("At least one SystemX endpoint URL is required");
    }

    const merged = { ...DEFAULTS, ...options };

    this.transportFactory = options.transportFactory ?? (() => createWebSocketTransport());
    this.autoReconnect = merged.autoReconnect;
    this.heartbeatIntervalMs = merged.heartbeatIntervalMs;
    this.heartbeatTimeoutMs = merged.heartbeatTimeoutMs;
    this.registerOnConnect = merged.registerOnConnect;
    this.maxReconnectBackoffMs = merged.maxReconnectBackoffMs;
    this.baseReconnectBackoffMs = merged.reconnectBackoffMs;
    this.currentReconnectDelay = merged.reconnectBackoffMs;
    this.debugEnabled = merged.debug;
  }

  async register(address: string, options: Omit<RegisterOptions, "address"> = {}): Promise<void> {
    if (!isValidAddress(address)) {
      throw new Error("Invalid SystemX address");
    }

    this.registeredAddress = address;
    this.registerOptions = options;
    this.shouldAttemptReconnect = true;
    this.manualCloseRequested = false;

    await this.ensureConnected();

    if (this.registerDeferred) {
      // Already inflight; let the existing promise resolve.
      return new Promise<void>((resolve, reject) => {
        const prev = this.registerDeferred!;
        const originalResolve = prev.resolve;
        const originalReject = prev.reject;
        prev.resolve = (value) => {
          originalResolve(value);
          resolve(value);
        };
        prev.reject = (error) => {
          originalReject(error);
          reject(error);
        };
      });
    }

    const deferred: Deferred<void> = {
      resolve: () => {},
      reject: () => {},
    };

    const promise = new Promise<void>((resolve, reject) => {
      deferred.resolve = resolve;
      deferred.reject = reject;
    });

    this.registerDeferred = deferred;
    this.sendRegisterMessage();
    return promise;
  }

  async dial(to: string, options: DialOptions = {}): Promise<Call> {
    if (!isValidAddress(to)) {
      throw new Error("Invalid SystemX address");
    }

    this.shouldAttemptReconnect = true;
    this.manualCloseRequested = false;

    await this.ensureConnected();

    const deferred: Deferred<Call> = {
      resolve: () => {},
      reject: () => {},
    };

    const promise = new Promise<Call>((resolve, reject) => {
      deferred.resolve = resolve;
      deferred.reject = reject;
    });

    this.pendingDials.push({ to, metadata: options.metadata, deferred });

    this.send({
      type: "DIAL",
      to,
      metadata: options.metadata,
    });

    return promise;
  }

  heartbeat(): void {
    if (this.connectionState !== "connected") {
      return;
    }
    this.send({ type: "HEARTBEAT" });
    this.scheduleHeartbeatTimeout();
  }

  async reconnect(): Promise<void> {
    this.shouldAttemptReconnect = true;
    this.manualCloseRequested = false;
    this.clearReconnectTimer();
    return this.ensureConnected();
  }

  close(code?: number, reason?: string) {
    this.shouldAttemptReconnect = false;
    this.manualCloseRequested = true;
    this.clearHeartbeatTimers();
    this.clearReconnectTimer();

    if (this.transport) {
      this.transport.close(code, reason);
    }
  }

  override on<Event extends EventKeys>(event: Event, listener: TrimphoneEvents[Event]): this {
    return super.on(event, listener);
  }

  override once<Event extends EventKeys>(event: Event, listener: TrimphoneEvents[Event]): this {
    return super.once(event, listener);
  }

  private async ensureConnected(): Promise<void> {
    if (this.connectionState === "connected") {
      return;
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectionState = "connecting";

    const transport = this.transportFactory();
    this.transport = transport;
    this.useWebStreams = transport.constructor?.name === "BrowserWebSocketTransport";

    transport.on("message", (raw) => this.handleRawMessage(raw));
    transport.on("close", (code: number, reason?: string) => this.handleTransportClose(code, reason));
    transport.on("error", (error: Error) => this.handleTransportError(error));

    this.connectPromise = new Promise<void>((resolve, reject) => {
      const handleOpen = () => {
        transport.off("open", handleOpen);
        transport.off("error", handleConnectError);

        this.connectionState = "connected";
        this.connectPromise = null;
        this.currentReconnectDelay = this.baseReconnectBackoffMs;
        this.emit("connected");
        this.startHeartbeat();

        if (this.registeredAddress && this.registerOnConnect) {
          this.sendRegisterMessage();
        }

        resolve();
      };

      const handleConnectError = (error: Error) => {
        transport.off("open", handleOpen);
        transport.off("error", handleConnectError);

        if (this.connectionState === "connecting") {
          this.connectionState = "disconnected";
          this.connectPromise = null;
          reject(error);
        }
      };

      transport.on("open", handleOpen);
      transport.on("error", handleConnectError);

      const targetUrl = this.urls[0];
      transport
        .connect({ url: targetUrl })
        .catch((error) => {
          handleConnectError(error as Error);
        });
    });

    return this.connectPromise;
  }

  private handleTransportClose(code: number, reason?: string) {
    if (this.connectionState === "disconnected") {
      return;
    }

    if (this.debugEnabled) {
      console.debug("Trimphone transport closed", { code, reason });
    }

    this.connectionState = "disconnected";
    this.transport = null;
    this.connectPromise = null;

    this.clearHeartbeatTimers();

    this.registerDeferred?.reject(new Error("Disconnected"));
    this.registerDeferred = null;

    while (this.pendingDials.length > 0) {
      const pending = this.pendingDials.shift();
      pending?.deferred.reject(new Error("Disconnected"));
    }

    for (const [, call] of this.calls) {
      call.receiveHangup("disconnected");
    }
    this.calls.clear();

    for (const callId of Array.from(this.streams.keys())) {
      this.closeStream(callId);
    }

    this.emit("disconnected", { code, reason });

    if (this.autoReconnect && this.shouldAttemptReconnect && !this.manualCloseRequested) {
      this.scheduleReconnect();
    }
  }

  private handleTransportError(error: Error) {
    if (this.debugEnabled) {
      console.debug("Trimphone transport error", error);
    }
    this.emit("error", error);
  }

  private handleRawMessage(raw: unknown) {
    let json: string | null = null;

    if (typeof raw === "string") {
      json = raw;
    } else if (Buffer.isBuffer(raw)) {
      json = raw.toString("utf8");
    } else if (raw instanceof ArrayBuffer) {
      json = Buffer.from(raw).toString("utf8");
    }

    if (!json) {
      return;
    }

    let payload: SystemXInboundMessage;
    try {
      payload = JSON.parse(json);
    } catch (error) {
      this.emit("error", new Error(`Failed to parse incoming message: ${(error as Error).message}`));
      return;
    }

    this.handleMessage(payload);
  }

  private handleMessage(message: SystemXInboundMessage) {
    switch (message.type) {
      case "REGISTERED":
        this.sessionId = message.session_id;
        this.registerDeferred?.resolve();
        if (this.registeredAddress) {
          this.emit("registered", this.registeredAddress);
        }
        this.registerDeferred = null;
        break;

      case "REGISTER_FAILED":
        this.registerDeferred?.reject(new Error(`Registration failed: ${message.reason}`));
        this.emit("registrationFailed", message.reason);
        this.registerDeferred = null;
        break;

      case "RING":
        this.handleIncomingRing(message);
        break;

      case "CONNECTED":
        this.handleConnected(message);
        break;

      case "BUSY":
        this.handleBusy(message);
        break;

      case "MSG":
        this.handleCallMessage(message);
        break;

      case "HANGUP":
        this.handleHangup(message);
        break;

      case "HEARTBEAT_ACK":
        this.lastHeartbeatAck = Date.now();
        this.emit("heartbeatAck", message.timestamp);
        if (this.heartbeatTimeoutTimer) {
          clearTimeout(this.heartbeatTimeoutTimer);
          this.heartbeatTimeoutTimer = null;
        }
        break;

      default:
        break;
    }
  }

  private handleIncomingRing(message: Extract<SystemXInboundMessage, { type: "RING" }>) {
    const controller = this.createCallController();
    const call = new Call({
      id: message.call_id,
      from: message.from,
      metadata: message.metadata,
      direction: "inbound",
      controller,
    });

    this.calls.set(message.call_id, call);
    this.emit("ring", call);
  }

  private handleConnected(message: Extract<SystemXInboundMessage, { type: "CONNECTED" }>) {
    let call = this.calls.get(message.call_id);
    if (!call) {
      const pending = this.dequeuePendingDial(message.to);
      if (!pending) {
        return;
      }
      call = new Call({
        id: message.call_id,
        to: message.to,
        from: message.from,
        metadata: message.metadata,
        direction: "outbound",
        controller: this.createCallController(),
      });
      this.calls.set(message.call_id, call);
      pending.deferred.resolve(call);
    }
    call.setConnected();
  }

  private handleBusy(message: Extract<SystemXInboundMessage, { type: "BUSY" }>) {
    const pending = this.dequeuePendingDial(message.to);
    if (pending) {
      pending.deferred.reject(new Error(`Call failed: ${message.reason}`));
    }
  }

  private handleCallMessage(message: Extract<SystemXInboundMessage, { type: "MSG" }>) {
    const call = this.calls.get(message.call_id);
    if (!call) {
      return;
    }

    let data = message.data;
    if (message.content_type === "json" && typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch {
        // Ignore parse failures and fall back to raw string.
      }
    } else if (message.content_type === "binary") {
      const bytes = decodeBase64(data);
      const stream = this.streams.get(message.call_id);
      if (stream instanceof BrowserTunnelStream) {
        stream.pushChunk(bytes);
      } else if (stream instanceof TunnelStream) {
        stream.pushChunk(toNodeBuffer(bytes));
      }
      call.receiveMessage(this.useWebStreams ? bytes : toNodeBuffer(bytes));
      return;
    }

    call.receiveMessage(data);
  }

  private handleHangup(message: Extract<SystemXInboundMessage, { type: "HANGUP" }>) {
    const call = this.calls.get(message.call_id);
    if (!call) {
      return;
    }
    call.receiveHangup(message.reason);
    this.calls.delete(message.call_id);
    this.closeStream(message.call_id);
  }

  private dequeuePendingDial(to?: string): PendingDial | undefined {
    if (!to) {
      return this.pendingDials.shift();
    }
    const index = this.pendingDials.findIndex((dial) => dial.to === to);
    if (index === -1) {
      return this.pendingDials.shift();
    }
    return this.pendingDials.splice(index, 1)[0];
  }

  private createCallController(): CallController {
    const sendMessage = (callId: string, payload: MessagePayload) => {
      const contentType = payload.contentType ?? "text";
      let data: unknown = payload.data;

      if (contentType === "json" && typeof payload.data !== "string") {
        data = JSON.stringify(payload.data);
      } else if (contentType === "binary") {
        if (payload.data instanceof ArrayBuffer) {
          data = encodeBase64(new Uint8Array(payload.data));
        } else if (payload.data instanceof Uint8Array) {
          data = encodeBase64(payload.data);
        } else if (typeof Buffer !== "undefined" && Buffer.isBuffer(payload.data)) {
          data = payload.data.toString("base64");
        } else {
          throw new Error("Binary payload must be Buffer, Uint8Array, or ArrayBuffer");
        }
      }

      this.send({
        type: "MSG",
        call_id: callId,
        data,
        content_type: contentType,
      });
    };

    if (this.useWebStreams) {
      return {
        answer: (callId: string) => {
          this.send({ type: "ANSWER", call_id: callId });
        },
        hangup: (callId: string, reason?: string) => {
          this.closeStream(callId);
          this.send({ type: "HANGUP", call_id: callId, reason });
        },
        send: (callId: string, payload: MessagePayload) => {
          sendMessage(callId, payload);
        },
        getWebStream: (callId: string) => {
          return this.getOrCreateBrowserStream(callId);
        },
      };
    }

    return {
      answer: (callId: string) => {
        this.send({ type: "ANSWER", call_id: callId });
      },
      hangup: (callId: string, reason?: string) => {
        this.closeStream(callId);
        this.send({ type: "HANGUP", call_id: callId, reason });
      },
      send: (callId: string, payload: MessagePayload) => {
        sendMessage(callId, payload);
      },
      getStream: (callId: string) => {
        return this.getOrCreateNodeStream(callId);
      },
    };
  }

  private sendRegisterMessage(): void {
    if (!this.registeredAddress) {
      return;
    }
    const options = this.registerOptions ?? {};
    this.send({
      type: "REGISTER",
      address: this.registeredAddress,
      metadata: options.metadata,
      concurrency: options.concurrency,
      max_listeners: options.maxListeners,
      max_sessions: options.maxSessions,
      pool_size: options.poolSize,
    });
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) {
      return;
    }

    const delay = this.currentReconnectDelay;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.ensureConnected()
        .then(() => {
          this.currentReconnectDelay = this.baseReconnectBackoffMs;
        })
        .catch(() => {
          this.currentReconnectDelay = Math.min(
            this.currentReconnectDelay * 2,
            this.maxReconnectBackoffMs,
          );
          this.scheduleReconnect();
        });
    }, delay);
  }

  private startHeartbeat() {
    this.clearHeartbeatTimers();
    this.lastHeartbeatAck = Date.now();

    if (this.heartbeatIntervalMs <= 0) {
      return;
    }

    this.send({ type: "HEARTBEAT" });
    this.scheduleHeartbeatTimeout();

    this.heartbeatTimer = setInterval(() => {
      if (this.connectionState !== "connected") {
        return;
      }
      this.send({ type: "HEARTBEAT" });
      this.scheduleHeartbeatTimeout();
    }, this.heartbeatIntervalMs);
  }

  private scheduleHeartbeatTimeout() {
    if (this.heartbeatTimeoutMs <= 0) {
      return;
    }
    if (this.heartbeatTimeoutTimer) {
      return;
    }
    this.heartbeatTimeoutTimer = setTimeout(() => {
      const sinceAck = Date.now() - this.lastHeartbeatAck;
      if (sinceAck >= this.heartbeatTimeoutMs && this.transport) {
        this.transport.close(4000, "heartbeat_timeout");
      }
      this.heartbeatTimeoutTimer = null;
      }, this.heartbeatTimeoutMs);
  }

  private clearHeartbeatTimers() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.heartbeatTimeoutTimer) {
      clearTimeout(this.heartbeatTimeoutTimer);
      this.heartbeatTimeoutTimer = null;
    }
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private send(message: SystemXOutboundMessage) {
    if (!this.transport || this.connectionState !== "connected") {
      throw new Error("Cannot send message while disconnected");
    }
    this.transport.send(JSON.stringify(message));
  }

  private getOrCreateNodeStream(callId: string): TunnelStream {
    const existing = this.streams.get(callId);
    if (existing instanceof TunnelStream) {
      return existing;
    }

    const stream = new TunnelStream((chunk) => {
      this.send({
        type: "MSG",
        call_id: callId,
        data: chunk.toString("base64"),
        content_type: "binary",
      });
    });

    stream.on("error", (error) => {
      this.emit("error", error);
    });

    const cleanup = () => {
      stream.off("close", cleanup);
      stream.off("end", cleanup);
      this.streams.delete(callId);
    };

    stream.on("close", cleanup);
    stream.on("end", cleanup);

    this.streams.set(callId, stream);
    return stream;
  }

  private getOrCreateBrowserStream(callId: string): BrowserTunnelStream {
    const existing = this.streams.get(callId);
    if (existing instanceof BrowserTunnelStream) {
      return existing;
    }

    const stream = new BrowserTunnelStream((chunk) => {
      this.send({
        type: "MSG",
        call_id: callId,
        data: encodeBase64(chunk),
        content_type: "binary",
      });
    });

    this.streams.set(callId, stream);
    return stream;
  }

  private closeStream(callId: string) {
    const stream = this.streams.get(callId);
    if (!stream) {
      return;
    }
    if (stream instanceof BrowserTunnelStream) {
      stream.end();
    } else {
      stream.endFromRemote();
    }
    this.streams.delete(callId);
  }
}
