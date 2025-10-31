import { Trimphone } from "../src/trimphone";
import { MemoryProcess } from "../src/process";

const URL = process.env.SYSTEMX_URL ?? "wss://engram-fi-1.entrained.ai:2096";

async function main() {
  const phone = new Trimphone(URL);
  await phone.register("uppercase@home.local");

  phone.on("ring", (call) => {
    console.log(`📞 Uppercase request from ${call.from}`);
    call.answer();

    const process = new MemoryProcess(async (input) => input.toUpperCase());

    call.tunnel(process).catch((error) => {
      console.error("Tunnel error:", error);
    });
  });

  console.log("✅ Uppercase service ready at uppercase@home.local");
}

main().catch((error) => {
  console.error("Uppercase service failed:", error);
  process.exitCode = 1;
});
