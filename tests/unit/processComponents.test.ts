import { describe, expect, it } from "bun:test";
import { EchoProcess, PrefixProcess, UppercaseProcess } from "../../src/process";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function runProcess(process: { stdin: WritableStream<Uint8Array>; stdout: ReadableStream<Uint8Array> }, input: string) {
  const writer = process.stdin.getWriter();
  await writer.write(encoder.encode(input));
  await writer.close();

  const reader = process.stdout.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done || !value) {
      break;
    }
    chunks.push(value);
  }
  const buffer = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  return decoder.decode(buffer);
}

describe("Process catalog components", () => {
  it("EchoProcess returns identical output", async () => {
    const process = new EchoProcess();
    const result = await runProcess(process, "hello world\n");
    expect(result).toBe("hello world\n");
  });

  it("UppercaseProcess uppercases input", async () => {
    const process = new UppercaseProcess();
    const result = await runProcess(process, "Hello There\n");
    expect(result).toBe("HELLO THERE\n");
  });

  it("PrefixProcess prefixes each message", async () => {
    const process = new PrefixProcess("[bot] ");
    const result = await runProcess(process, "ready\n");
    expect(result).toBe("[bot] ready\n");
  });
});
