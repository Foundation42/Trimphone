import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { CallState } from "./callList";

const statusEl = document.querySelector<HTMLParagraphElement>("#status");
const callsList = document.querySelector<HTMLUListElement>("#calls");
const terminalEl = document.querySelector<HTMLDivElement>("#terminal");

let terminal: Terminal | null = null;
let fitAddon: FitAddon | null = null;

export function initTerminal() {
  if (!terminalEl || terminal) return terminal;

  terminal = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    convertEol: true,
    theme: {
      background: "#000000",
      foreground: "#ffffff",
    },
  });

  fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(terminalEl);
  fitAddon.fit();

  window.addEventListener("resize", () => {
    fitAddon?.fit();
  });

  terminal.writeln("\x1b[1;32mTrimphone Terminal Ready\x1b[0m");
  terminal.writeln("Connected to SystemX");
  terminal.writeln("");

  return terminal;
}

export function getTerminal(): Terminal | null {
  return terminal;
}

export function log(message: string) {
  if (!terminal) {
    console.log(message);
    return;
  }
  terminal.writeln(message);
}

export function setStatus(status: string) {
  if (statusEl) {
    statusEl.textContent = status;
  }
}

export function renderCalls(calls: CallState[]) {
  if (!callsList) return;
  callsList.innerHTML = "";
  if (calls.length === 0) {
    const li = document.createElement("li");
    li.textContent = "No active calls";
    callsList.appendChild(li);
    return;
  }
  for (const call of calls) {
    const li = document.createElement("li");
    const title = call.to ?? call.from ?? call.id.slice(0, 8);
    li.textContent = `${title} — ${call.status}${call.reason ? ` (${call.reason})` : ""}`;
    callsList.appendChild(li);
  }
}
