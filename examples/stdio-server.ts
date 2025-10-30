import { Trimphone } from "../src/trimphone";
import { spawnNodeProcess } from "../src/process";

const URL = "wss://engram-fi-1.entrained.ai:2096";

async function main() {
  const phone = new Trimphone(URL);
  await phone.register("bash@trimphone.io");

  phone.on("ring", (call) => {
    console.log(`📞 Remote shell request from ${call.from}`);
    call.answer();

    const bashProcess = spawnNodeProcess("bash", ["-i"], {
      env: process.env,
    });

    call
      .tunnel(bashProcess, {
        onStderrChunk: (chunk) => {
          console.error(`[bash stderr] ${Buffer.from(chunk).toString()}`);
        },
        forwardStderr: true,
      })
      .catch((error) => {
        console.error("Tunnel error:", error);
        call.hangup();
      });

    call.on("hangup", () => {
      console.log("📴 Remote shell session ended");
      void bashProcess.stop?.("call_hangup");
    });

    console.log("🚀 Remote bash session started");
  });

  console.log("✅ Bash service ready at bash@trimphone.io");
}

main().catch((error) => {
  console.error("Stdio server failed:", error);
  process.exitCode = 1;
});
