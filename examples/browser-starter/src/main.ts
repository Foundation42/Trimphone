import {
  BrowserWebSocketTransport,
  Trimphone,
  createMemoryProcess,
} from "trimphone";

const defaultUrl = "wss://engram-fi-1.entrained.ai:2096";
const SYSTEMX_URL = (import.meta as any).env?.VITE_SYSTEMX_URL ?? defaultUrl;

const statusEl = document.querySelector<HTMLParagraphElement>("#status");
const outputEl = document.querySelector<HTMLPreElement>("#output");
const dialForm = document.querySelector<HTMLFormElement>("#dial-form");
const sendForm = document.querySelector<HTMLFormElement>("#send-form");
const sendInput = sendForm?.querySelector<HTMLInputElement>("input[name=message]");

function log(message: string) {
  if (!outputEl) return;
  outputEl.textContent += `${message}\n`;
  outputEl.scrollTop = outputEl.scrollHeight;
}

async function bootstrap() {
  const phone = new Trimphone(SYSTEMX_URL, {
    transportFactory: () => new BrowserWebSocketTransport(),
  });

  const address = `web-client-${crypto.randomUUID().slice(0, 8)}@trimphone.io`;
  await phone.register(address);
  statusEl!.textContent = `Registered as ${address}`;

  phone.on("error", (err) => {
    log(`Error: ${(err as Error).message}`);
  });

  const activeCalls = new Map<string, ReturnType<typeof setupCall>>();

  phone.on("ring", (call) => {
    call.answer();
    const handle = setupCall(call, activeCalls);
    // in-memory echo using MemoryProcess
    void call.tunnel(
      createMemoryProcess(async (input) => input),
      {
        forwardStderr: false,
      },
    );
    activeCalls.set(call.id, handle);
  });

  dialForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(dialForm);
    const to = formData.get("to")?.toString().trim();
    if (!to) return;
    try {
      const call = await phone.dial(to);
      const handle = setupCall(call, activeCalls);
      activeCalls.set(call.id, handle);
      log(`Dialled ${to}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`Dial failed: ${message}`);
    }
  });

  sendForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = sendInput?.value ?? "";
    if (!text.trim()) {
      return;
    }
    for (const handle of activeCalls.values()) {
      handle.send(text);
    }
    sendInput!.value = "";
  });
}

function setupCall(call: import("trimphone").Call, active: Map<string, ReturnType<typeof setupCall>>) {
  const stream = call.getWebStream();
  const reader = stream.readable.getReader();
  const writer = stream.writable.getWriter();
  const textDecoder = new TextDecoder();
  const textEncoder = new TextEncoder();

  let closed = false;

  (async () => {
    while (!closed) {
      const { value, done } = await reader.read();
      if (done || !value) {
        break;
      }
      log(`[${call.id.slice(0, 6)}] ${textDecoder.decode(value)}`);
    }
  })().catch((error) => log(`Stream error: ${(error as Error).message}`));

  call.on("hangup", () => {
    closed = true;
    reader.cancel().catch(() => {});
    writer.close().catch(() => {});
    log(`Call ${call.id.slice(0, 6)} ended`);
    active.delete(call.id);
  });

  call.on("message", (msg) => {
    if (typeof msg === "string") {
      log(`[${call.id.slice(0, 6)}] ${msg}`);
    }
  });

  return {
    send: (text: string) => {
      if (closed) {
        log(`Call ${call.id.slice(0, 6)} already closed`);
        return;
      }
      const payload = text.endsWith("\n") ? text : `${text}\n`;
      writer.write(textEncoder.encode(payload)).catch((error) => {
        log(`Write failed: ${(error as Error).message}`);
      });
    },
  };
}

bootstrap().catch((error) => {
  console.error(error);
  statusEl!.textContent = `Failed: ${(error as Error).message}`;
});
