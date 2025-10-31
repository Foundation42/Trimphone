import {
  BrowserWebSocketTransport,
  Trimphone,
  browserProcesses,
} from "trimphone";
import { CallRegistry } from "./callList";
import { log, setStatus, renderCalls, initTerminal, getTerminal } from "./ui";

const defaultUrl = "wss://engram-fi-1.entrained.ai:2096";
const SYSTEMX_URL = (import.meta as any).env?.VITE_SYSTEMX_URL ?? defaultUrl;

const dialForm = document.querySelector<HTMLFormElement>("#dial-form");
const sendForm = document.querySelector<HTMLFormElement>("#send-form");
const sendInput = sendForm?.querySelector<HTMLInputElement>("input[name=message]");
const localCallButton = document.querySelector<HTMLButtonElement>("#call-local");

async function bootstrap() {
  initTerminal();

  const phone = new Trimphone(SYSTEMX_URL, {
    transportFactory: () => new BrowserWebSocketTransport(),
  });

  const calls = new CallRegistry();
  calls.subscribe(renderCalls);

  const address = `web-client-${crypto.randomUUID().slice(0, 8)}@trimphone.io`;
  await phone.register(address);
  setStatus(`Registered as ${address}`);

  const localEchoAddress = `local-echo-${crypto.randomUUID().slice(0, 8)}@trimphone.io`;
  const localEcho = new Trimphone(SYSTEMX_URL, {
    transportFactory: () => new BrowserWebSocketTransport(),
  });
  try {
    await localEcho.register(localEchoAddress);
    localEcho.on("ring", (call) => {
      call.answer();
      void call.tunnel(new browserProcesses.components.EchoProcess());
    });
    localEcho.on("error", (err) => {
      log(`Local echo error: ${(err as Error).message}`);
    });
    if (localCallButton) {
      localCallButton.style.display = "inline-flex";
      localCallButton.textContent = `Dial ${localEchoAddress}`;
      localCallButton.addEventListener("click", () => {
        void startLocalCall(phone, calls, localEchoAddress);
      });
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    log(`Failed to register local echo service: ${reason}`);
  }

  phone.on("error", (err) => {
    log(`Error: ${(err as Error).message}`);
  });

  phone.on("ring", (call) => {
    call.answer();
    calls.upsert({
      id: call.id,
      from: call.from,
      status: "incoming",
    });
    calls.update(call.id, { status: "active" });
    void call.tunnel(new browserProcesses.components.EchoProcess());
    setupCall(call, calls);
  });

  dialForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(dialForm);
    const to = formData.get("to")?.toString().trim();
    if (!to) return;
    const placeholderId = crypto.randomUUID();
    calls.upsert({ id: placeholderId, to, status: "dialling" });
    try {
      const call = await phone.dial(to);
      calls.remove(placeholderId);
      calls.upsert({ id: call.id, to, status: "active" });
      setupCall(call, calls);
      log(`Dialled ${to}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      calls.update(placeholderId, { status: "failed", reason });
      log(`Dial failed: ${reason}`);
    }
  });

  sendForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = sendInput?.value ?? "";
    if (!text.trim()) {
      return;
    }
    const active = calls.snapshot().filter((c) => c.status === "active");
    if (active.length === 0) {
      log("No active calls to send to");
      return;
    }
    for (const call of active) {
      const payload = text.endsWith("\n") ? text : `${text}\n`;
      const writer = activeCallWriters.get(call.id);
      writer?.write(payload);
    }
  });
}

const activeCallWriters = new Map<string, { write: (payload: string) => void }>();

async function startLocalCall(phone: Trimphone, calls: CallRegistry, address: string) {
  const placeholderId = crypto.randomUUID();
  calls.upsert({ id: placeholderId, to: address, status: "dialling" });
  try {
    const call = await phone.dial(address);
    calls.remove(placeholderId);
    calls.upsert({ id: call.id, to: address, status: "active" });
    setupCall(call, calls);
    log(`Dialled ${address}`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    calls.update(placeholderId, { status: "failed", reason });
    log(`Dial failed: ${reason}`);
  }
}

function setupCall(call: import("trimphone").Call, registry: CallRegistry) {
  const stream = call.getWebStream();
  const reader = stream.readable.getReader();
  const writer = stream.writable.getWriter();
  const terminal = getTerminal();
  const textEncoder = new TextEncoder();

  let closed = false;

  log(`\x1b[1;34m[Call ${call.id.slice(0, 6)}]\x1b[0m Connected`);

  // Pipe stream data to terminal
  (async () => {
    while (!closed) {
      const { value, done } = await reader.read();
      if (done || !value) {
        break;
      }
      // Write binary data directly to terminal (preserves ANSI codes)
      if (terminal) {
        terminal.write(value);
      }
    }
  })().catch((error) => log(`\x1b[1;31mStream error:\x1b[0m ${(error as Error).message}`));

  // Handle terminal input
  if (terminal) {
    const onDataDisposable = terminal.onData((data) => {
      if (closed) return;
      writer.write(textEncoder.encode(data)).catch((error) => {
        log(`\x1b[1;31mWrite failed:\x1b[0m ${(error as Error).message}`);
      });
    });

    // Clean up on hangup
    call.on("hangup", () => {
      closed = true;
      onDataDisposable.dispose();
      reader.cancel().catch(() => {});
      writer.close().catch(() => {});
      registry.update(call.id, { status: "ended" });
      activeCallWriters.delete(call.id);
      log(`\x1b[1;33m[Call ${call.id.slice(0, 6)}]\x1b[0m Ended`);
    });
  } else {
    call.on("hangup", () => {
      closed = true;
      reader.cancel().catch(() => {});
      writer.close().catch(() => {});
      registry.update(call.id, { status: "ended" });
      activeCallWriters.delete(call.id);
      log(`Call ${call.id.slice(0, 6)} ended`);
    });
  }

  activeCallWriters.set(call.id, {
    write: (text: string) => {
      if (closed) {
        log(`\x1b[1;31mCall ${call.id.slice(0, 6)} already closed\x1b[0m`);
        return;
      }
      writer.write(textEncoder.encode(text)).catch((error) => {
        log(`\x1b[1;31mWrite failed:\x1b[0m ${(error as Error).message}`);
      });
    },
  });
}

bootstrap().catch((error) => {
  console.error(error);
  setStatus(`Failed: ${(error as Error).message}`);
});
