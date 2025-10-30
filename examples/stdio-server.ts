import { Trimphone } from "../src/trimphone";
import { spawn } from "node:child_process";

const URL = "wss://engram-fi-1.entrained.ai:2096";

async function main() {
  const phone = new Trimphone(URL);
  await phone.register("bash@trimphone.io");

  phone.on("ring", (call) => {
    console.log(`📞 Remote shell request from ${call.from}`);
    call.answer();

    const bash = spawn("bash", ["-i"], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    const stream = call.getStream();
    bash.stdout.pipe(stream);
    bash.stderr.pipe(stream);
    stream.pipe(bash.stdin);

    bash.on("exit", (code) => {
      console.log(`🛑 Bash exited with code ${code ?? 0}`);
      call.hangup();
    });

    call.on("hangup", () => {
      console.log("📴 Remote shell session ended");
      bash.kill();
    });

    console.log("🚀 Remote bash session started");
  });

  console.log("✅ Bash service ready at bash@trimphone.io");
}

main().catch((error) => {
  console.error("Stdio server failed:", error);
  process.exitCode = 1;
});
