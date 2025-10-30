import { describe, expect, it } from "bun:test";
import { BrowserTunnelStream } from "../../src/web/tunnelStream";

const decoder = new TextDecoder();
const encoder = new TextEncoder();

describe("BrowserTunnelStream", () => {
  it("forwards written chunks to sender callback", async () => {
    const chunks: Uint8Array[] = [];
    const stream = new BrowserTunnelStream((chunk) => {
      chunks.push(chunk);
    });

    const view = stream.createView();
    const writer = view.writable.getWriter();
    await writer.write(encoder.encode("hello"));
    await writer.close();

    expect(decoder.decode(chunks[0])).toBe("hello");
  });

  it("emits data pushed from remote", async () => {
    const stream = new BrowserTunnelStream(() => {});
    const view = stream.createView();
    const reader = view.readable.getReader();

    stream.pushChunk(encoder.encode("world"));

    const { value } = await reader.read();
    expect(decoder.decode(value!)).toBe("world");
  });
});
