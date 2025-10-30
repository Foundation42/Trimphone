import { EventEmitter } from "node:events";
import type { Duplex } from "node:stream";
import { Readable, Writable } from "node:stream";
import type { CallEvents, MessagePayload } from "./types";
import type { ProcessTunnelHandle, ProcessTunnelOptions, TrimphoneProcess } from "./process/types";

type EventKeys = keyof CallEvents;

export type CallDirection = "inbound" | "outbound";

export interface CallController {
  answer(callId: string): void;
  hangup(callId: string, reason?: string): void;
  send(callId: string, payload: MessagePayload): void;
  getStream?(callId: string): Duplex;
  getWebStream?(callId: string): {
    readable: ReadableStream<Uint8Array>;
    writable: WritableStream<Uint8Array>;
  };
}

export interface CallParams {
  id: string;
  from?: string;
  to?: string;
  metadata?: Record<string, unknown>;
  direction: CallDirection;
  controller: CallController;
}

type CallState = "pending" | "ringing" | "active" | "ended";

function inferContentType(message: unknown): MessagePayload["contentType"] {
  if (Buffer.isBuffer(message) || message instanceof Uint8Array || message instanceof ArrayBuffer) {
    return "binary";
  }
  if (typeof message === "object" && message !== null) {
    return "json";
  }
  return "text";
}

export class Call extends EventEmitter {
  readonly id: string;
  readonly from?: string;
  readonly to?: string;
  readonly metadata?: Record<string, unknown>;
  readonly direction: CallDirection;
  private state: CallState;
  private readonly controller: CallController;
  private readonly activeTunnels = new Set<ProcessTunnelHandle>();

  constructor(params: CallParams) {
    super();
    this.id = params.id;
    this.from = params.from;
    this.to = params.to;
    this.metadata = params.metadata;
    this.direction = params.direction;
    this.controller = params.controller;
    this.state = params.direction === "inbound" ? "ringing" : "pending";
  }

  get isActive(): boolean {
    return this.state === "active";
  }

  answer(): void {
    if (this.direction !== "inbound") {
      throw new Error("Only inbound calls can be answered");
    }
    if (this.state !== "ringing") {
      throw new Error("Call is not ringing");
    }
    this.controller.answer(this.id);
    this.state = "active";
  }

  hangup(reason?: string): void {
    if (this.state === "ended") {
      return;
    }
    this.controller.hangup(this.id, reason);
  }

  send(message: unknown, contentType?: MessagePayload["contentType"]): void {
    if (this.state !== "active") {
      throw new Error("Cannot send message on inactive call");
    }
    const payloadType = contentType ?? inferContentType(message);
    this.controller.send(this.id, { data: message, contentType: payloadType });
  }

  getStream(): Duplex {
    if (!this.controller.getStream) {
      throw new Error("Node.js streams are not available; use getWebStream() instead");
    }
    return this.controller.getStream(this.id);
  }

  getWebStream(): { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> } {
    if (!this.controller.getWebStream) {
      throw new Error("Web streams are not available for this call");
    }
    return this.controller.getWebStream(this.id);
  }

  async tunnel(process: TrimphoneProcess, options: ProcessTunnelOptions = {}): Promise<ProcessTunnelHandle> {
    if (this.state !== "active") {
      throw new Error("Cannot tunnel on inactive call");
    }

    if (!this.controller.getStream) {
      throw new Error("Process tunnelling is only supported in Node.js environments at this time");
    }

    await process.start?.();

    const stream = this.getStream();
    const processStdout = Readable.fromWeb(process.stdout);
    const processStdin = Writable.fromWeb(process.stdin);
    const processStderr = process.stderr ? Readable.fromWeb(process.stderr) : null;
    const forwardStderr = options.forwardStderr !== false;

    const stderrListener = options.onStderrChunk
      ? (chunk: Buffer) => {
          const data = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
          options.onStderrChunk?.(data);
        }
      : null;

    if (processStderr) {
      if (forwardStderr) {
        processStderr.pipe(stream, { end: false });
      }
      if (stderrListener) {
        processStderr.on("data", stderrListener as (chunk: Buffer) => void);
      }
    }

    processStdout.pipe(stream, { end: false });
    stream.pipe(processStdin, { end: false });

    let closed = false;

    const handle: ProcessTunnelHandle = {
      process,
      close: async (reason?: string) => {
        if (closed) {
          return;
        }
        closed = true;
        this.activeTunnels.delete(handle);

        processStdout.unpipe(stream);
        stream.unpipe(processStdin);
        processStdin.end();
        processStdout.destroy?.();
        if (processStderr) {
          if (forwardStderr) {
            processStderr.unpipe(stream);
          }
          if (stderrListener) {
            processStderr.removeListener("data", stderrListener as (chunk: Buffer) => void);
          }
          processStderr.destroy?.();
        }

        await process.stop?.(reason);
      },
    };

    this.activeTunnels.add(handle);

    if (options.closeOnHangup !== false) {
      const onHangup = () => {
        void handle.close("call_hangup");
      };
      this.once("hangup", onHangup);
      const originalClose = handle.close.bind(handle);
      handle.close = async (reason?: string) => {
        this.removeListener("hangup", onHangup);
        await originalClose(reason);
      };
    }

    return handle;
  }

  /** @internal */
  setConnected(): void {
    this.state = "active";
    this.emit("connected");
  }

  /** @internal */
  receiveMessage(message: unknown): void {
    this.emit("message", message);
  }

  /** @internal */
  receiveHangup(reason?: string): void {
    if (this.state === "ended") {
      return;
    }
    this.state = "ended";
    this.emit("hangup", reason);
  }

  on<Event extends EventKeys>(event: Event, listener: CallEvents[Event]): this {
    return super.on(event, listener);
  }

  once<Event extends EventKeys>(event: Event, listener: CallEvents[Event]): this {
    return super.once(event, listener);
  }
}
