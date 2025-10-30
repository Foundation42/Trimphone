import { describe, expect, it } from "bun:test";
import { BrowserWebSocketTransport } from "../../src/web/websocketTransport";
import type { WebSocketLike } from "../../src/web/types";

class MockCloseEvent extends Event {
  constructor(public code: number, public reason?: string) {
    super("close");
  }
}

class MockMessageEvent extends Event {
  constructor(public data: any) {
    super("message");
  }
}

class MockWebSocket extends EventTarget implements WebSocketLike {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  public sent: any[] = [];

  constructor(public url: string, public protocols?: string | string[]) {
    super();
    void protocols;
  }

  send(data: any): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.readyState = MockWebSocket.CLOSED;
    this.dispatchEvent(new MockCloseEvent(code ?? 1000, reason));
  }
}

const noop = () => {};

MockWebSocket.prototype.addEventListener = EventTarget.prototype.addEventListener;
MockWebSocket.prototype.removeEventListener = EventTarget.prototype.removeEventListener;

describe("BrowserWebSocketTransport", () => {
  it("connects and resolves on open", async () => {
    let socket: MockWebSocket | null = null;
    const transport = new BrowserWebSocketTransport({
      createWebSocket: (url) => {
        socket = new MockWebSocket(url);
        return socket;
      },
    });

    const connectPromise = transport.connect({ url: "wss://example.com" });

    if (!socket) throw new Error("socket not created");
    socket.readyState = MockWebSocket.OPEN;
    socket.dispatchEvent(new Event("open"));

    await expect(connectPromise).resolves.toBeUndefined();
  });

  it("emits messages received from socket", async () => {
    let received: any = null;
    let socket: MockWebSocket | null = null;
    const transport = new BrowserWebSocketTransport({
      createWebSocket: (url) => {
        socket = new MockWebSocket(url);
        return socket;
      },
    });

    transport.on("message", (message) => {
      received = message;
    });

    const promise = transport.connect({ url: "wss://example.com" });
    if (!socket) throw new Error("socket not created");
    socket.readyState = MockWebSocket.OPEN;
    socket.dispatchEvent(new Event("open"));
    await promise;

    socket.dispatchEvent(new MockMessageEvent("hello"));
    expect(received).toBe("hello");
  });

  it("rejects connect when socket closes before opening", async () => {
    let socket: MockWebSocket | null = null;
    const transport = new BrowserWebSocketTransport({
      createWebSocket: (url) => {
        socket = new MockWebSocket(url);
        return socket;
      },
    });

    const connectPromise = transport.connect({ url: "wss://example.com" });
    if (!socket) throw new Error("socket not created");
    await Promise.resolve();
    socket.dispatchEvent(new MockCloseEvent(1006));

    await connectPromise
      .then(() => {
        throw new Error("Expected promise to reject");
      })
      .catch((error) => {
        expect(error.message).toContain("WebSocket closed before opening");
      });
  });
});
