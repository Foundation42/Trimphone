import { BaseTransport, type TransportConnectOptions } from "../transport";
import type { WebSocketLike } from "./types";

export type WebSocketFactory = (url: string, protocols?: string | string[]) => WebSocketLike;

export interface BrowserWebSocketOptions {
  createWebSocket?: WebSocketFactory;
}

export class BrowserWebSocketTransport extends BaseTransport {
  private socket: WebSocketLike | null = null;
  private readonly factory: WebSocketFactory;

  constructor(options: BrowserWebSocketOptions = {}) {
    super();
    this.factory = options.createWebSocket ?? ((url, protocols) => new WebSocket(url, protocols));
  }

  async connect({ url, protocols }: TransportConnectOptions): Promise<void> {
    if (this.socket) {
      return;
    }

    this.transition("connecting");

    await new Promise<void>((resolve, reject) => {
      const ws = this.factory(url, protocols);
      this.socket = ws;

      const handleMessage = (event: MessageEvent) => {
        this.emit("message", event.data);
      };

      const handleClose = (event: CloseEvent | { code: number; reason?: string }) => {
        const wasConnecting = this.state === "connecting";
        removePersistent();
        removeConnect();
        this.transition("closed");
        this.socket = null;
        this.emit("close", event.code, (event as CloseEvent).reason || undefined);
        if (wasConnecting) {
          reject(new Error(`WebSocket closed before opening (code ${event.code})`));
        }
      };

      const handleError = (event: Event) => {
        const error = (event as ErrorEvent).error ?? new Error("WebSocket error");
        this.emit("error", error);
        if (this.state === "connecting") {
          removePersistent();
          removeConnect();
          this.transition("closed");
          this.socket = null;
          reject(error);
        }
      };

      const handleOpen = () => {
        removeConnect();
        this.transition("open");
        this.emit("open");
        resolve();
      };

      const removeConnect = () => {
        ws.removeEventListener("open", handleOpen);
        ws.removeEventListener("error", handleError);
      };

      const removePersistent = () => {
        ws.removeEventListener("message", handleMessage);
        ws.removeEventListener("close", handleClose);
      };

      ws.addEventListener("open", handleOpen);
      ws.addEventListener("message", handleMessage);
      ws.addEventListener("close", handleClose);
      ws.addEventListener("error", handleError);
    });
  }

  send(data: unknown): void {
    if (!this.socket || this.state !== "open") {
      throw new Error("WebSocketTransport is not open");
    }
    if (typeof data === "string" || data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
      this.socket.send(data as any);
    } else {
      this.socket.send(JSON.stringify(data));
    }
  }

  close(code?: number, reason?: string): void {
    if (!this.socket) {
      return;
    }
    const ws = this.socket;
    this.transition("closing");
    ws.close(code, reason);
    this.socket = null;
  }
}
