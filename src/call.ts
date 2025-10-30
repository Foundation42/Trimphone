import { EventEmitter } from "node:events";
import type { Duplex } from "node:stream";
import type { CallEvents, MessagePayload } from "./types";

type EventKeys = keyof CallEvents;

export type CallDirection = "inbound" | "outbound";

export interface CallController {
  answer(callId: string): void;
  hangup(callId: string, reason?: string): void;
  send(callId: string, payload: MessagePayload): void;
  getStream(callId: string): Duplex;
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
    return this.controller.getStream(this.id);
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
