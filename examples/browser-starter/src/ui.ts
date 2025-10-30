import type { CallState } from "./callList";

const outputEl = document.querySelector<HTMLPreElement>("#output");
const statusEl = document.querySelector<HTMLParagraphElement>("#status");
const callsList = document.querySelector<HTMLUListElement>("#calls");

export function log(message: string) {
  if (!outputEl) return;
  outputEl.textContent += `${message}\n`;
  outputEl.scrollTop = outputEl.scrollHeight;
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
