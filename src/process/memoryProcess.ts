import { TrimphoneProcess } from "./types";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export type MemoryProcessHandler = (input: string) => string | Promise<string>;

export class MemoryProcess implements TrimphoneProcess {
  public readonly stdout: ReadableStream<Uint8Array>;
  public readonly stdin: WritableStream<Uint8Array>;
  public readonly stderr?: ReadableStream<Uint8Array>;
  private readonly handler: MemoryProcessHandler;
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  private closed = false;

  constructor(handler: MemoryProcessHandler) {
    this.handler = handler;

    this.stdout = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.controller = controller;
      },
      cancel: () => {
        this.closed = true;
      },
    });

    this.stdin = new WritableStream<Uint8Array>({
      write: async (chunk) => {
        if (this.closed) {
          return;
        }
        const input = textDecoder.decode(chunk);
        const result = await this.handler(input);
        if (this.closed || !this.controller) {
          return;
        }
        this.controller.enqueue(textEncoder.encode(result));
      },
      close: () => {
        if (this.controller && !this.closed) {
          this.controller.close();
        }
        this.closed = true;
      },
      abort: () => {
        if (this.controller && !this.closed) {
          this.controller.error(new Error("MemoryProcess aborted"));
        }
        this.closed = true;
      },
    });
  }

  async stop(): Promise<void> {
    if (!this.closed && this.controller) {
      this.controller.close();
      this.closed = true;
    }
  }
}
