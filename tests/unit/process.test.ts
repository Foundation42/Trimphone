import { describe, expect, it } from "bun:test";
import { spawnNodeProcess } from "../../src/process/nodeProcess";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

describe("spawnNodeProcess", () => {
  it("bridges stdin/stdout via web streams", async () => {
    const process = spawnNodeProcess("node", [
      "-e",
      "process.stdin.on('data', chunk => process.stdout.write(chunk.toString().toUpperCase()))",
    ]);

    const writer = process.stdin.getWriter();
    await writer.write(encoder.encode("trimphone\n"));
    await writer.close();

    const reader = process.stdout.getReader();
    const { value } = await reader.read();
    expect(decoder.decode(value ?? new Uint8Array())).toBe("TRIMPHONE\n");
    await reader.cancel();

    await process.stop?.("test_complete");
  });
});
