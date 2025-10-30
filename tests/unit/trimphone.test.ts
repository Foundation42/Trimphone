import { describe, expect, it, beforeEach } from "bun:test";
import { EventEmitter } from "node:events";
import { Trimphone } from "../../src/trimphone";
import type { Transport, TransportConnectOptions } from "../../src/transport";

class MockTransport extends EventEmitter implements Transport {
  public state: import("../../src/transport").TransportState = "idle";
  public sent: unknown[] = [];
  public connectCalls: TransportConnectOptions[] = [];

  async connect(options: TransportConnectOptions): Promise<void> {
    this.connectCalls.push(options);
    this.state = "connecting";
  }

  send(data: unknown): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.state = "closed";
    this.emit("close", code ?? 1000, reason);
  }

  open() {
    this.state = "open";
    this.emit("open");
  }

  receive(message: unknown) {
    this.emit("message", JSON.stringify(message));
  }

  fail(error: Error) {
    this.emit("error", error);
  }
}

function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("Trimphone core", () => {
  let transport: MockTransport;
  let phone: Trimphone;

  beforeEach(() => {
    transport = new MockTransport();
    phone = new Trimphone("wss://test", {
      transportFactory: () => transport,
    });
  });

  it("rejects invalid addresses during registration", async () => {
    await expect(phone.register("invalid-address")).rejects.toThrow("Invalid SystemX address");
    expect(transport.connectCalls).toHaveLength(0);
  });

  it("connects transport on register and sends REGISTER message", async () => {
    const registerPromise = phone.register("alice@example.com");
    transport.open();
    await nextTick();

    expect(transport.connectCalls).toHaveLength(1);
    const sent = transport.sent;
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual(
      JSON.stringify({
        type: "REGISTER",
        address: "alice@example.com",
      }),
    );

    transport.receive({
      type: "REGISTERED",
      address: "alice@example.com",
      session_id: "session-1",
    });

    await expect(registerPromise).resolves.toBeUndefined();
  });

  it("emits registered event on successful registration", async () => {
    const events: string[] = [];
    phone.on("registered", (address) => events.push(address));

    const registerPromise = phone.register("carol@example.com");
    transport.open();
    await nextTick();
    transport.receive({
      type: "REGISTERED",
      address: "carol@example.com",
      session_id: "session-3",
    });

    await registerPromise;
    expect(events).toEqual(["carol@example.com"]);
  });

  it("rejects register promise when REGISTER_FAILED arrives", async () => {
    const registerPromise = phone.register("dave@example.com");
    transport.open();
    await nextTick();
    transport.receive({
      type: "REGISTER_FAILED",
      reason: "address_in_use",
    });

    await expect(registerPromise).rejects.toThrow("Registration failed: address_in_use");
  });

  it("emits ring event and allows answering incoming calls", async () => {
    const rings: any[] = [];
    phone.on("ring", (call) => {
      rings.push(call);
    });

    const registerPromise = phone.register("bob@example.com");
    transport.open();
    await nextTick();
    transport.receive({
      type: "REGISTERED",
      address: "bob@example.com",
      session_id: "session-2",
    });
    await registerPromise;

    transport.receive({
      type: "RING",
      call_id: "call-1",
      from: "alice@example.com",
      metadata: { subject: "test" },
    });

    expect(rings).toHaveLength(1);
    const call = rings[0];
    call.answer();

    const lastMessage = transport.sent[transport.sent.length - 1];
    expect(lastMessage).toEqual(
      JSON.stringify({
        type: "ANSWER",
        call_id: "call-1",
      }),
    );
  });

  it("routes MSG payloads to the correct call", async () => {
    const callPromise = phone.dial("service@example.com");
    transport.open();
    await nextTick();
    const firstMessage = transport.sent[0];
    expect(firstMessage).toEqual(
      JSON.stringify({
        type: "DIAL",
        to: "service@example.com",
      }),
    );

    transport.receive({
      type: "CONNECTED",
      call_id: "call-99",
      to: "service@example.com",
    });

    const call = await callPromise;
    const messages: unknown[] = [];
    call.on("message", (msg) => messages.push(msg));

    transport.receive({
      type: "MSG",
      call_id: "call-99",
      data: "hello",
      content_type: "text",
    });

    expect(messages).toEqual(["hello"]);
  });

  it("sends MSG when call.send is invoked", async () => {
    const callPromise = phone.dial("service@example.com");
    transport.open();
    await nextTick();

    transport.receive({
      type: "CONNECTED",
      call_id: "call-77",
      to: "service@example.com",
    });

    const call = await callPromise;
    call.send("ping");

    const lastMessage = transport.sent[transport.sent.length - 1];

    expect(lastMessage).toEqual(
      JSON.stringify({
        type: "MSG",
        call_id: "call-77",
        data: "ping",
        content_type: "text",
      }),
    );
  });

  it("hangs up active calls and emits hangup event", async () => {
    const callPromise = phone.dial("service@example.com");
    transport.open();
    await nextTick();

    transport.receive({
      type: "CONNECTED",
      call_id: "call-55",
      to: "service@example.com",
    });

    const call = await callPromise;
    const hangupEvents: Array<string | undefined> = [];
    call.on("hangup", (reason) => hangupEvents.push(reason));

    call.hangup("done");

    const hangupMessage = transport.sent[transport.sent.length - 1];
    expect(hangupMessage).toEqual(
      JSON.stringify({
        type: "HANGUP",
        call_id: "call-55",
        reason: "done",
      }),
    );

    transport.receive({
      type: "HANGUP",
      call_id: "call-55",
      reason: "normal",
    });

    expect(hangupEvents).toEqual(["normal"]);
  });

  it("rejects dial when BUSY is received", async () => {
    const callPromise = phone.dial("service@example.com");
    transport.open();
    await nextTick();

    transport.receive({
      type: "BUSY",
      to: "service@example.com",
      reason: "offline",
    });

    await expect(callPromise).rejects.toThrow("Call failed: offline");
  });

  it("supports duplex streaming over calls", async () => {
    const callPromise = phone.dial("service@example.com");
    transport.open();
    await nextTick();

    transport.receive({
      type: "CONNECTED",
      call_id: "stream-call",
      to: "service@example.com",
    });

    const call = await callPromise;
    const stream = call.getStream();

    const receivedChunks: Buffer[] = [];
    const messageEvents: unknown[] = [];
    stream.on("data", (chunk) => receivedChunks.push(chunk as Buffer));
    call.on("message", (msg) => messageEvents.push(msg));

    stream.write(Buffer.from("hello", "utf8"));

    const last = transport.sent[transport.sent.length - 1];
    expect(last).toEqual(
      JSON.stringify({
        type: "MSG",
        call_id: "stream-call",
        data: Buffer.from("hello").toString("base64"),
        content_type: "binary",
      }),
    );

    transport.receive({
      type: "MSG",
      call_id: "stream-call",
      data: Buffer.from("world").toString("base64"),
      content_type: "binary",
    });
    await nextTick();

    expect(receivedChunks).toHaveLength(1);
    expect(receivedChunks[0].toString()).toBe("world");
    expect(messageEvents).toHaveLength(1);
    expect((messageEvents[0] as Buffer).toString()).toBe("world");

    let ended = false;
    stream.on("end", () => {
      ended = true;
    });

    transport.receive({
      type: "HANGUP",
      call_id: "stream-call",
      reason: "normal",
    });
    await nextTick();

    expect(ended).toBe(true);
  });
});
