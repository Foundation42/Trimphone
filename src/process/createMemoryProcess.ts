import { MemoryProcess, type MemoryProcessHandler } from "./memoryProcess";
import { TrimphoneProcess } from "./types";

export interface MemoryProcessOptions {
  /** Optional stderr stream for logging/diagnostics */
  stderr?: ReadableStream<Uint8Array>;
}

export function createMemoryProcess(handler: MemoryProcessHandler, _options: MemoryProcessOptions = {}): TrimphoneProcess {
  return new MemoryProcess(handler) as TrimphoneProcess;
}
