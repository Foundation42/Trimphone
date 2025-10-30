import { describe, expect, it, beforeEach } from "bun:test";
import { EventEmitter } from "node:events";
import { Trimphone } from "../../src/trimphone";
import { MemoryProcess } from "../../src/process/memoryProcess";
import type { Transport, TransportConnectOptions } from "../../src/transport";

class MockTransport extends EventEmitter implements Transport {
  public state: import("../../src/transport").TransportState = "idle";
  public sent: unknown[] = [];
  public connectCalls: TransportConnectOptions[] = [];
  public closed: { code?: number; reason?: string } | null = null;

  async connect(options: TransportConnectOptions): Promise<void> {
    this.connectCalls.push(options);
    this.state = "connecting";
  }

  send(data: unknown): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.state = "closed";
    this.closed = { code, reason };
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

  getMessagesOfType(type: string) {
    return this.sent
      .map((raw) => {
        if (typeof raw === "string") {
          try {
            return JSON.parse(raw);
          } catch {
            return null;
          }
        }
        return raw as Record<string, unknown>;
      })
      .filter((message): message is Record<string, unknown> => Boolean(message && message.type === type));
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
    const registerMessages = transport.getMessagesOfType("REGISTER");
    expect(registerMessages.length).toBeGreaterThanOrEqual(1);
    expect(registerMessages[registerMessages.length - 1]).toMatchObject({ address: "alice@example.com" });

    const heartbeatMessages = transport.getMessagesOfType("HEARTBEAT");
    expect(heartbeatMessages.length).toBeGreaterThanOrEqual(1);

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

    const answerMessages = transport.getMessagesOfType("ANSWER");
    expect(answerMessages[answerMessages.length - 1]).toMatchObject({ call_id: "call-1" });
  });

  it("routes MSG payloads to the correct call", async () => {
    const callPromise = phone.dial("service@example.com");
    transport.open();
    await nextTick();
    const dialMessages = transport.getMessagesOfType("DIAL");
    expect(dialMessages).toHaveLength(1);
    expect(dialMessages[0]).toMatchObject({ to: "service@example.com" });

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

    const messagePackets = transport.getMessagesOfType("MSG");
    const msg = messagePackets[messagePackets.length - 1];
    expect(msg).toMatchObject({
      call_id: "call-77",
      data: "ping",
      content_type: "text",
    });
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

    const hangupPackets = transport.getMessagesOfType("HANGUP");
    const hangupMessage = hangupPackets[hangupPackets.length - 1];
    expect(hangupMessage).toMatchObject({
      call_id: "call-55",
      reason: "done",
    });

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

    const outgoingChunks = transport.getMessagesOfType("MSG");
    const last = outgoingChunks[outgoingChunks.length - 1];
    expect(last).toMatchObject({
      call_id: "stream-call",
      data: Buffer.from("hello").toString("base64"),
      content_type: "binary",
    });

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

  it("tunnels processes using call.tunnel", async () => {
    const registerPromise = phone.register("service@example.com");
    transport.open();
    await nextTick();
    transport.receive({
      type: "REGISTERED",
      address: "service@example.com",
      session_id: "session-process",
    });
    await registerPromise;

    phone.on("ring", (call) => {
      call.answer();
      void call.tunnel(
        new MemoryProcess(async (input) => {
          return input.toUpperCase();
        }),
      );
    });

    transport.receive({
      type: "RING",
      call_id: "call-process",
      from: "client@example.com",
    });

    await nextTick();

    transport.receive({
      type: "CONNECTED",
      call_id: "call-process",
      from: "client@example.com",
    });

    const payload = Buffer.from("hello world\n").toString("base64");
    transport.receive({
      type: "MSG",
      call_id: "call-process",
      data: payload,
      content_type: "binary",
    });

    await nextTick();

    const outbound = transport.getMessagesOfType("MSG");
    const last = outbound[outbound.length - 1];
    expect(Buffer.from(last.data as string, "base64").toString()).toBe("HELLO WORLD\n");

    transport.receive({
      type: "HANGUP",
      call_id: "call-process",
      reason: "normal",
    });
  });

  it("emits heartbeatAck when heartbeat acknowledgements arrive", async () => {
    const timestamps: number[] = [];
    phone.on("heartbeatAck", (timestamp) => timestamps.push(timestamp));

    const registerPromise = phone.register("heartbeat@example.com");
    transport.open();
    await nextTick();

    transport.receive({
      type: "HEARTBEAT_ACK",
      timestamp: 123,
    });

    transport.receive({
      type: "REGISTERED",
      address: "heartbeat@example.com",
      session_id: "session-hb",
    });
    await registerPromise;

    expect(timestamps).toEqual([123]);
  });

  it("closes the transport when heartbeat acknowledgements are missed", async () => {
    transport = new MockTransport();
    phone = new Trimphone("wss://test", {
      transportFactory: () => transport,
      heartbeatIntervalMs: 5,
      heartbeatTimeoutMs: 10,
      autoReconnect: false,
    });

    const registerPromise = phone.register("timeout@example.com");
    const disconnected = new Promise<void>((resolve) => {
      phone.once("disconnected", () => resolve());
    });
    transport.open();
    await nextTick();

    transport.receive({
      type: "REGISTERED",
      address: "timeout@example.com",
      session_id: "session-timeout",
    });
    await registerPromise;

    await disconnected;

    expect(transport.closed?.reason).toBe("heartbeat_timeout");
  });

  it("reconnects automatically after disconnect and re-registers", async () => {
    const first = new MockTransport();
    const second = new MockTransport();
    let connectIndex = 0;
    const transports = [first, second];

    transport = transports[0];
    phone = new Trimphone("wss://test", {
      transportFactory: () => transports[Math.min(connectIndex++, transports.length - 1)],
      heartbeatIntervalMs: 0,
      autoReconnect: true,
      reconnectBackoffMs: 5,
      maxReconnectBackoffMs: 10,
    });

    const registrations: string[] = [];
    phone.on("registered", (address) => registrations.push(address));

    let currentTransport = transports[0];
    const registerPromise = phone.register("reconnect@example.com");
    currentTransport.open();
    await nextTick();
    currentTransport.receive({
      type: "REGISTERED",
      address: "reconnect@example.com",
      session_id: "session-1",
    });
    await registerPromise;

    currentTransport.emit("close", 1006, "network");

    await new Promise((resolve) => setTimeout(resolve, 20));

    currentTransport = transports[1];
    expect(currentTransport.connectCalls).toHaveLength(1);

    currentTransport.open();
    await nextTick();

    const registerMessages = currentTransport.getMessagesOfType("REGISTER");
    expect(registerMessages[registerMessages.length - 1]).toMatchObject({
      address: "reconnect@example.com",
    });

    currentTransport.receive({
      type: "REGISTERED",
      address: "reconnect@example.com",
      session_id: "session-2",
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(registrations).toEqual([
      "reconnect@example.com",
      "reconnect@example.com",
    ]);
  });
});
