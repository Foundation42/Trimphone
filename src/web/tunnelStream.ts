export class BrowserTunnelStream {
  private readonly sendChunk: (chunk: Uint8Array) => void;
  private readonly controllers = new Set<ReadableStreamDefaultController<Uint8Array>>();
  private closed = false;

  constructor(sendChunk: (chunk: Uint8Array) => void) {
    this.sendChunk = sendChunk;
  }

  createView(): { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> } {
    let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;

    const readable = new ReadableStream<Uint8Array>({
      start: (controller) => {
        controllerRef = controller;
        if (this.closed) {
          controller.close();
          controllerRef = null;
        } else {
          this.controllers.add(controller);
        }
      },
      cancel: () => {
        if (controllerRef) {
          this.controllers.delete(controllerRef);
          controllerRef = null;
        }
      },
    });

    const writable = new WritableStream<Uint8Array>({
      write: (chunk) => {
        if (this.closed) {
          return;
        }
        this.sendChunk(chunk);
      },
      close: () => {
        // closing view does not close tunnel
      },
      abort: () => {
        // ignore abort from view
      },
    });

    return { readable, writable };
  }

  pushChunk(chunk: Uint8Array) {
    if (this.closed) {
      return;
    }
    for (const controller of this.controllers) {
      controller.enqueue(chunk);
    }
  }

  end() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const controller of this.controllers) {
      controller.close();
    }
    this.controllers.clear();
  }
}
