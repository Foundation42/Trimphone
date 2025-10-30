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

const DEFAULT_OPTIONS: Required<Pick<TrimphoneOptions, "autoReconnect" | "heartbeatIntervalMs" | "heartbeatTimeoutMs" | "reconnectBackoffMs" | "maxReconnectBackoffMs" | "registerOnConnect" | "debug">> =
  {
    autoReconnect: true,
    heartbeatIntervalMs: 30_000,
    heartbeatTimeoutMs: 60_000,
    reconnectBackoffMs: 1_000,
    maxReconnectBackoffMs: 30_000,
    registerOnConnect: true,
    debug: false,
  };

export class Trimphone extends EventEmitter {
  private readonly urls: string[];
  private readonly options: TrimphoneOptions;
  private readonly transportFactory: TransportFactory;

  private transport: Transport | null = null;
  private connectionState: ConnectionState = "disconnected";
  private connectPromise: Promise<void> | null = null;
  private sessionId: string | null = null;
  private registeredAddress: string | null = null;
  private registerOptions: Omit<RegisterOptions, "address"> | null = null;
  private registerDeferred: Deferred<void> | null = null;

  private readonly pendingDials: PendingDial[] = [];
  private readonly calls: Map<string, Call> = new Map();
  private readonly streams: Map<string, TunnelStream> = new Map();

  constructor(url: string | string[], options: TrimphoneOptions = {}) {
    super();
    this.urls = Array.isArray(url) ? url : [url];
    if (this.urls.length === 0) {
      throw new Error("At least one SystemX endpoint URL is required");
    }

    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.transportFactory = options.transportFactory ?? (() => createWebSocketTransport());
  }

  async register(address: string, options: Omit<RegisterOptions, "address"> = {}): Promise<void> {
    if (!isValidAddress(address)) {
      throw new Error("Invalid SystemX address");
    }
    this.registeredAddress = address;
    this.registerOptions = options;

    await this.ensureConnected();

    if (this.registerDeferred) {
      // If a registration is already in flight, return that promise instead of creating a new one.
      return new Promise<void>((resolve, reject) => {
        const prevDeferred = this.registerDeferred!;
        const chainedResolve = prevDeferred.resolve;
        const chainedReject = prevDeferred.reject;
        prevDeferred.resolve = (value) => {
          chainedResolve(value);
          resolve(value);
        };
        prevDeferred.reject = (error) => {
          chainedReject(error);
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

    this.send({
      type: "REGISTER",
      address,
      metadata: options.metadata,
      concurrency: options.concurrency,
      max_listeners: options.maxListeners,
      max_sessions: options.maxSessions,
      pool_size: options.poolSize,
    });

    return promise;
  }

  async dial(to: string, options: DialOptions = {}): Promise<Call> {
    if (!isValidAddress(to)) {
      throw new Error("Invalid SystemX address");
    }

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

  close(code?: number, reason?: string) {
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

    const transport = this.transportFactory();
    this.transport = transport;
    this.connectionState = "connecting";

    transport.on("message", (raw) => this.handleRawMessage(raw));
    transport.on("close", (code: number, reason?: string) => this.handleTransportClose(code, reason));
    transport.on("error", (error: Error) => this.handleTransportError(error));

    this.connectPromise = new Promise<void>((resolve, reject) => {
      const handleOpen = () => {
        this.connectionState = "connected";
        this.connectPromise = null;
        this.emit("connected");
        transport.off("open", handleOpen);
        transport.off("error", handleConnectError);
        resolve();
      };

      const handleConnectError = (error: Error) => {
        if (this.connectionState === "connecting") {
          this.connectionState = "disconnected";
          this.connectPromise = null;
          transport.off("open", handleOpen);
           transport.off("error", handleConnectError);
          reject(error);
        }
      };

      transport.on("open", handleOpen);
      transport.on("error", handleConnectError);

      const url = this.urls[0];
      transport
        .connect({ url })
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

    this.connectionState = "disconnected";
    this.transport = null;
    this.connectPromise = null;

    this.registerDeferred?.reject(new Error("Disconnected"));
    this.registerDeferred = null;

    while (this.pendingDials.length > 0) {
      const dial = this.pendingDials.shift();
      dial?.deferred.reject(new Error("Disconnected"));
    }

    for (const [, call] of this.calls) {
      call.receiveHangup("disconnected");
    }
    this.calls.clear();
    for (const callId of Array.from(this.streams.keys())) {
      this.closeStream(callId);
    }

    this.emit("disconnected", { code, reason });
  }

  private handleTransportError(error: Error) {
    this.emit("error", error);
    if (this.connectionState === "connecting" && this.connectPromise) {
      // Fail the connection attempt if still pending.
      this.connectPromise = null;
    }
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

      default:
        // Ignore unsupported or informational messages for now.
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
        // If parsing fails, fall back to raw string.
      }
    } else if (message.content_type === "binary") {
      let buffer: Buffer;
      if (typeof data === "string") {
        buffer = Buffer.from(data, "base64");
      } else if (Buffer.isBuffer(data)) {
        buffer = data;
      } else if (data instanceof ArrayBuffer) {
        buffer = Buffer.from(data);
      } else if (data instanceof Uint8Array) {
        buffer = Buffer.from(data);
      } else {
        buffer = Buffer.alloc(0);
      }

      const stream = this.streams.get(message.call_id);
      if (stream) {
        stream.pushChunk(buffer);
      }
      call.receiveMessage(buffer);
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
    return {
      answer: (callId: string) => {
        this.send({ type: "ANSWER", call_id: callId });
      },
      hangup: (callId: string, reason?: string) => {
        this.closeStream(callId);
        this.send({ type: "HANGUP", call_id: callId, reason });
      },
      send: (callId: string, payload: MessagePayload) => {
        const contentType = payload.contentType ?? "text";
        let data: unknown = payload.data;

        if (contentType === "json" && typeof payload.data !== "string") {
          data = JSON.stringify(payload.data);
        } else if (contentType === "binary") {
          if (payload.data instanceof ArrayBuffer) {
            data = Buffer.from(payload.data as ArrayBuffer).toString("base64");
          } else if (payload.data instanceof Uint8Array) {
            data = Buffer.from(payload.data).toString("base64");
          } else if (Buffer.isBuffer(payload.data)) {
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
      },
      getStream: (callId: string) => {
        return this.getOrCreateStream(callId);
      },
    };
  }

  private send(message: SystemXOutboundMessage) {
    if (!this.transport || this.connectionState !== "connected") {
      throw new Error("Cannot send message while disconnected");
    }
    const payload = JSON.stringify(message);
    this.transport.send(payload);
  }

  private getOrCreateStream(callId: string): TunnelStream {
    let stream = this.streams.get(callId);
    if (stream) {
      return stream;
    }

    stream = new TunnelStream((chunk) => {
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

  private closeStream(callId: string) {
    const stream = this.streams.get(callId);
    if (!stream) {
      return;
    }
    stream.endFromRemote();
  }
}
