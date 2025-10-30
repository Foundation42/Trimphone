export interface TrimphoneProcess {
  readonly stdin: WritableStream<Uint8Array>;
  readonly stdout: ReadableStream<Uint8Array>;
  readonly stderr?: ReadableStream<Uint8Array>;
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
