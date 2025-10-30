import type { Duplex } from "node:stream";
import type { EventEmitter } from "node:events";
import type { TransportFactory } from "./transport";

export type PresenceStatus = "available" | "busy" | "dnd" | "away";
export type ConcurrencyMode = "single" | "broadcast" | "parallel";

export interface RegisterOptions {
  address: string;
  metadata?: Record<string, unknown>;
  concurrency?: ConcurrencyMode;
  maxListeners?: number;
  maxSessions?: number;
  poolSize?: number;
}

export interface TrimphoneOptions {
  transportFactory?: TransportFactory;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  autoReconnect?: boolean;
  reconnectBackoffMs?: number;
  maxReconnectBackoffMs?: number;
  registerOnConnect?: boolean;
  debug?: boolean;
}

export interface DialOptions {
  metadata?: Record<string, unknown>;
  timeoutMs?: number;
}

export interface MessagePayload {
  contentType?: "text" | "json" | "binary";
  data: unknown;
}

export interface CallStreamFactory {
  (call: Call): Duplex;
}

export interface CallEvents {
  message: (message: unknown) => void;
  hangup: (reason?: string) => void;
  error: (error: Error) => void;
  connected: () => void;
}

export interface TrimphoneEvents {
  connected: () => void;
  disconnected: (details?: { code?: number; reason?: string }) => void;
  error: (error: Error) => void;
  ring: (call: Call) => void;
  registered: (address: string) => void;
  registrationFailed: (reason: string) => void;
}

export type SystemXOutboundMessage =
  | {
      type: "REGISTER";
      address: string;
      metadata?: Record<string, unknown>;
      concurrency?: ConcurrencyMode;
      max_listeners?: number;
      max_sessions?: number;
      pool_size?: number;
    }
  | {
      type: "UNREGISTER";
    }
  | {
      type: "HEARTBEAT";
    }
  | {
      type: "DIAL";
      to: string;
      metadata?: Record<string, unknown>;
    }
  | {
      type: "ANSWER";
      call_id: string;
    }
  | {
      type: "HANGUP";
      call_id: string;
      reason?: string;
    }
  | {
      type: "MSG";
      call_id: string;
      data: unknown;
      content_type?: "text" | "json" | "binary";
    };

export type SystemXInboundMessage =
  | {
      type: "CONNECTED";
      call_id: string;
      to?: string;
      from?: string;
      metadata?: Record<string, unknown>;
    }
  | {
      type: "RING";
      call_id: string;
      from: string;
      metadata?: Record<string, unknown>;
    }
  | {
      type: "REGISTERED";
      address: string;
      session_id: string;
    }
  | {
      type: "REGISTER_FAILED";
      reason: string;
    }
  | {
      type: "MSG";
      call_id: string;
      data: unknown;
      content_type?: "text" | "json" | "binary";
    }
  | {
      type: "HANGUP";
      call_id: string;
      reason?: string;
    }
  | {
      type: "BUSY";
      to: string;
      reason: string;
    }
  | {
      type: "HEARTBEAT_ACK";
      timestamp: number;
    }
  | Record<string, unknown>;

// Forward declarations to avoid circular imports.
// Implementations will augment these types later.
export interface Call extends EventEmitter {
  readonly id: string;
  readonly from?: string;
  readonly to?: string;
  readonly metadata?: Record<string, unknown>;
  answer(): Promise<void> | void;
  hangup(reason?: string): Promise<void> | void;
  send(message: unknown, contentType?: MessagePayload["contentType"]): void;
  getStream(): Duplex;
}
