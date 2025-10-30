import { EventEmitter } from "node:events";

export type TransportState = "idle" | "connecting" | "open" | "closing" | "closed";

export interface TransportEvents {
  open: () => void;
  close: (code: number, reason?: string) => void;
  message: (data: unknown) => void;
  error: (error: Error) => void;
}

export interface TransportOptions {
  /** Milliseconds to wait before considering the connection attempt failed. */
  connectTimeoutMs?: number;
}

export interface TransportConnectOptions {
  url: string;
  protocols?: string | string[];
}

export interface Transport extends EventEmitter {
  readonly state: TransportState;
  connect(options: TransportConnectOptions): Promise<void>;
  send(data: unknown): void;
  close(code?: number, reason?: string): void;
}

export type TransportFactory = (options?: TransportOptions) => Transport;

/**
 * Utility EventEmitter to reduce boilerplate when implementing transports.
 */
export abstract class BaseTransport extends EventEmitter implements Transport {
  public state: TransportState = "idle";

  abstract connect(options: TransportConnectOptions): Promise<void>;

  abstract send(data: unknown): void;

  abstract close(code?: number, reason?: string): void;

  protected transition(next: TransportState) {
    this.state = next;
  }
}
