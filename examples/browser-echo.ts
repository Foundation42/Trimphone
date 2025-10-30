import { Trimphone, BrowserWebSocketTransport } from "trimphone";

const url = (window as any).SYSTEMX_URL ?? "wss://engram-fi-1.entrained.ai:2096";

async function main() {
  const phone = new Trimphone(url, {
    transportFactory: () => new BrowserWebSocketTransport(),
  });

  await phone.register(`web-client-${Math.random().toString(16).slice(2)}@trimphone.io`);

  const status = document.querySelector("#status");
  if (status) {
    status.textContent = "Registered";
  }

  const dialForm = document.querySelector<HTMLFormElement>("#dial");
  const output = document.querySelector<HTMLPreElement>("#output");

  dialForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const to = new FormData(dialForm).get("to")?.toString() ?? "";
    const call = await phone.dial(to);
    call.send("Hello from the browser!\n");
    call.on("message", (msg) => {
      if (output) {
        output.textContent += `\n${String(msg)}`;
      }
    });
  });

  phone.on("ring", (call) => {
    call.answer();
    const { readable, writable } = call.getWebStream();
    const reader = readable.getReader();
    const writer = writable.getWriter();

    (async () => {
      while (true) {
        const { value, done } = await reader.read();
        if (done || !value) {
          break;
        }
        await writer.write(value);
      }
    })().catch((error) => {
      console.error("Echo loop failed", error);
    });
  });
}

main().catch((error) => {
  console.error(error);
});
