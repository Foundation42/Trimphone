export class BrowserTunnelStream {
  public readonly readable: ReadableStream<Uint8Array>;
  public readonly writable: WritableStream<Uint8Array>;
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  private readonly sendChunk: (chunk: Uint8Array) => void;
  private closed = false;

  constructor(sendChunk: (chunk: Uint8Array) => void) {
    this.sendChunk = sendChunk;

    this.readable = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.controller = controller;
      },
      cancel: () => {
        this.closed = true;
      },
    });

    this.writable = new WritableStream<Uint8Array>({
      write: (chunk) => {
        if (this.closed) {
          return;
        }
        this.sendChunk(chunk);
      },
      close: () => {
        this.closed = true;
      },
      abort: () => {
        this.closed = true;
      },
    });
  }

  pushChunk(chunk: Uint8Array) {
    if (this.closed) {
      return;
    }
    this.controller?.enqueue(chunk);
  }

  end() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.controller?.close();
  }
}
