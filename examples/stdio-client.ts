import { Trimphone } from "../src/trimphone";

const URL = "wss://engram-fi-1.entrained.ai:2096";

async function main() {
  const phone = new Trimphone(URL);
  await phone.register("chris@home.local");

  console.log("📞 Connecting to remote bash...");
  const call = await phone.dial("bash@home.local");
  const stream = call.getStream();

  console.log("✅ Connected! Type commands (Ctrl+D to exit):");
  process.stdin.pipe(stream);
  stream.pipe(process.stdout);

  call.on("hangup", () => {
    console.log("\n📴 Session closed");
    process.exit(0);
  });

  process.stdin.on("end", () => {
    call.hangup();
  });
}

main().catch((error) => {
  console.error("Stdio client failed:", error);
  process.exitCode = 1;
});
