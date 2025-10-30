import WebSocket, { type ClientOptions } from "ws";
import { BaseTransport, type TransportConnectOptions, type TransportOptions } from "../transport";

export interface WebSocketTransportOptions extends TransportOptions {
  client?: ClientOptions;
}

export class WebSocketTransport extends BaseTransport {
  private socket: WebSocket | null = null;
  private readonly url?: string;
  private readonly options: WebSocketTransportOptions;
  public readonly platform = "node" as const;

  constructor(options: WebSocketTransportOptions = {}) {
    super();
    this.options = options;
  }

  async connect({ url, protocols }: TransportConnectOptions): Promise<void> {
    if (this.socket) {
      return;
    }

    this.transition("connecting");

    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(url, protocols, this.options.client);
      this.socket = socket;

      let settled = false;

      const handleOpen = () => {
        this.transition("open");
        this.emit("open");
        if (!settled) {
          settled = true;
          resolve();
        }
      };

      const handleError = (error: Error) => {
        this.emit("error", error);
        if (!settled && this.state === "connecting") {
          settled = true;
          this.transition("closed");
          this.socket = null;
          reject(error);
        }
      };

      const handleClose = (code: number, reason: Buffer) => {
        this.transition("closed");
        this.socket = null;
        const decodedReason = reason.toString("utf8") || undefined;
        this.emit("close", code, decodedReason);
        if (!settled && this.state === "connecting") {
          settled = true;
          reject(new Error(`WebSocket closed before opening (code ${code})`));
        }
      };

      socket.once("open", handleOpen);
      socket.on("error", handleError);
      socket.on("close", handleClose);
      socket.on("message", (data: WebSocket.RawData) => {
        this.emit("message", data);
      });
    });
  }

  send(data: unknown): void {
    if (!this.socket || this.state !== "open") {
      throw new Error("WebSocketTransport is not open");
    }
    if (
      typeof data === "string" ||
      (typeof Buffer !== "undefined" && Buffer.isBuffer(data)) ||
      data instanceof ArrayBuffer ||
      ArrayBuffer.isView(data)
    ) {
      this.socket.send(data as any);
    } else {
      this.socket.send(JSON.stringify(data));
    }
  }

  close(code?: number, reason?: string): void {
    if (!this.socket) {
      return;
    }
    const socket = this.socket;
    this.transition("closing");
    socket.close(code, reason);
    this.socket = null;
  }
}

export function createWebSocketTransport(options?: WebSocketTransportOptions) {
  return new WebSocketTransport(options);
}
