import { Duplex, type DuplexOptions } from "node:stream";

type ChunkSender = (chunk: Buffer) => void;

export class TunnelStream extends Duplex {
  private readonly sendChunk: ChunkSender;
  private remoteEnded = false;

  constructor(sendChunk: ChunkSender, options?: DuplexOptions) {
    super(options);
    this.sendChunk = sendChunk;
  }

  _read(_size: number): void {
    // Reading is driven by remote messages; nothing to do here.
  }

  _write(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    try {
      const buffer = this.normalizeChunk(chunk, encoding);
      this.sendChunk(buffer);
      callback();
    } catch (error) {
      callback(error as Error);
    }
  }

  /** Pushes a chunk from the remote peer into the stream. */
  pushChunk(chunk: Buffer) {
    if (!this.push(chunk)) {
      // Backpressure is handled by Node.js streams; we simply stop pushing until _read is called again.
    }
  }

  /** Marks the remote side as closed and ends the readable side. */
  endFromRemote() {
    if (this.remoteEnded) {
      return;
    }
    this.remoteEnded = true;
    this.push(null);
  }

  override destroy(error?: Error | null): this {
    this.remoteEnded = true;
    return super.destroy(error ?? undefined);
  }

  private normalizeChunk(chunk: Buffer | string, encoding: BufferEncoding): Buffer {
    if (Buffer.isBuffer(chunk)) {
      return chunk;
    }
    return Buffer.from(chunk, encoding);
  }
}
