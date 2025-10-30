import { describe, expect, it } from "bun:test";
import { TunnelStream } from "../../src/tunnelStream";

function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("TunnelStream", () => {
  it("forwards written chunks to sender callback", () => {
    const chunks: Buffer[] = [];
    const stream = new TunnelStream((chunk) => {
      chunks.push(chunk);
    });

    stream.write("hello");

    expect(Buffer.concat(chunks).toString()).toBe("hello");
  });

  it("emits data when pushChunk is called", async () => {
    const received: Buffer[] = [];
    const stream = new TunnelStream(() => {});

    stream.on("data", (chunk) => {
      received.push(chunk);
    });

    stream.pushChunk(Buffer.from("world"));
    await nextTick();

    expect(received).toHaveLength(1);
    expect(received[0].toString()).toBe("world");
  });

  it("ends readable side when endFromRemote is invoked", async () => {
    const stream = new TunnelStream(() => {});
    stream.resume();
    stream.endFromRemote();
    await nextTick();

    expect(stream.readableEnded).toBe(true);
  });
});
