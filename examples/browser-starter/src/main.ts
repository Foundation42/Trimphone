import {
  BrowserWebSocketTransport,
  Trimphone,
  browserProcesses,
} from "trimphone";
import { CallRegistry } from "./callList";
import { log, setStatus, renderCalls } from "./ui";

const defaultUrl = "wss://engram-fi-1.entrained.ai:2096";
const SYSTEMX_URL = (import.meta as any).env?.VITE_SYSTEMX_URL ?? defaultUrl;

const dialForm = document.querySelector<HTMLFormElement>('#dial-form');
const sendForm = document.querySelector<HTMLFormElement>('#send-form');
const sendInput = sendForm?.querySelector<HTMLInputElement>('input[name=message]');
const localCallButton = document.querySelector<HTMLButtonElement>('#call-local');

async function bootstrap() {
  const phone = new Trimphone(SYSTEMX_URL, {
    transportFactory: () => new BrowserWebSocketTransport(),
  });

  const calls = new CallRegistry();
  calls.subscribe(renderCalls);

  const address = `web-client-${crypto.randomUUID().slice(0, 8)}@trimphone.io`;
  await phone.register(address);
  setStatus(`Registered as ${address}`);

  if (localCallButton) {
    localCallButton.style.display = 'inline-flex';
    localCallButton.textContent = `Dial ${address}`;
    localCallButton.addEventListener('click', () => {
      void startLocalCall(phone, calls, address);
    });
  }

  phone.on('error', (err) => {
    log(`Error: ${(err as Error).message}`);
  });

  phone.on('ring', (call) => {
    call.answer();
    calls.upsert({
      id: call.id,
      from: call.from,
      status: 'incoming',
    });
    calls.update(call.id, { status: 'active' });
    void call.tunnel(new browserProcesses.components.EchoProcess());
    setupCall(call, calls);
  });

  dialForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(dialForm);
    const to = formData.get('to')?.toString().trim();
    if (!to) return;
    const placeholderId = crypto.randomUUID();
    calls.upsert({ id: placeholderId, to, status: 'dialling' });
    try {
      const call = await phone.dial(to);
      calls.remove(placeholderId);
      calls.upsert({ id: call.id, to, status: 'active' });
      setupCall(call, calls);
      log(`Dialled ${to}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      calls.update(placeholderId, { status: 'failed', reason });
      log(`Dial failed: ${reason}`);
    }
  });

  sendForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = sendInput?.value ?? '';
    if (!text.trim()) {
      return;
    }
    const active = calls.snapshot().filter((c) => c.status === 'active');
    if (active.length === 0) {
      log('No active calls to send to');
      return;
    }
    for (const call of active) {
      const payload = text.endsWith('\n') ? text : `${text}\n`;
      const writer = activeCallWriters.get(call.id);
      writer?.write(payload);
    }
    sendInput!.value = '';
  });
}

const activeCallWriters = new Map<string, { write: (payload: string) => void }>();

async function startLocalCall(phone: Trimphone, calls: CallRegistry, address: string) {
  const placeholderId = crypto.randomUUID();
  calls.upsert({ id: placeholderId, to: address, status: 'dialling' });
  try {
    const call = await phone.dial(address);
    calls.remove(placeholderId);
    calls.upsert({ id: call.id, to: address, status: 'active' });
    setupCall(call, calls);
    log(`Dialled ${address}`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    calls.update(placeholderId, { status: 'failed', reason });
    log(`Dial failed: ${reason}`);
  }
}

function setupCall(call: import('trimphone').Call, registry: CallRegistry) {
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

  call.on('hangup', () => {
    closed = true;
    reader.cancel().catch(() => {});
    writer.close().catch(() => {});
    registry.update(call.id, { status: 'ended' });
    activeCallWriters.delete(call.id);
    log(`Call ${call.id.slice(0, 6)} ended`);
  });

  call.on('message', (msg) => {
    if (typeof msg === 'string') {
      log(`[${call.id.slice(0, 6)}] ${msg}`);
    }
  });

  activeCallWriters.set(call.id, {
    write: (text: string) => {
      if (closed) {
        log(`Call ${call.id.slice(0, 6)} already closed`);
        return;
      }
      writer.write(textEncoder.encode(text)).catch((error) => {
        log(`Write failed: ${(error as Error).message}`);
      });
    },
  });
}

bootstrap().catch((error) => {
  console.error(error);
  setStatus(`Failed: ${(error as Error).message}`);
});
