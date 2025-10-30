import type { ReadableStream as ReadableStreamWeb, WritableStream as WritableStreamWeb } from "node:stream/web";

export interface TrimphoneProcess {
  readonly stdin: WritableStreamWeb<Uint8Array>;
  readonly stdout: ReadableStreamWeb<Uint8Array>;
  readonly stderr?: ReadableStreamWeb<Uint8Array>;
  start?(): Promise<void> | void;
  stop?(reason?: string): Promise<void> | void;
}

export interface ProcessTunnelOptions {
  closeOnHangup?: boolean;
  onStderrChunk?: (chunk: Uint8Array) => void;
  forwardStderr?: boolean;
}

export interface ProcessTunnelHandle {
  readonly process: TrimphoneProcess;
  close(reason?: string): Promise<void>;
}
