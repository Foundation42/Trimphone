import { Trimphone } from "../src/trimphone";

const URL = "wss://engram-fi-1.entrained.ai:2096";

async function main() {
  const phone = new Trimphone(URL);
  await phone.register("echo-test@trimphone.io");

  phone.on("ring", (call) => {
    console.log(`📞 Call from ${call.from}`);
    call.answer();

    call.on("message", (msg) => {
      console.log("Received:", msg);
      call.send(`Echo: ${msg}`);
    });

    call.on("hangup", () => {
      console.log("📴 Caller hung up");
    });
  });

  console.log("✅ Echo service ready!");
}

main().catch((error) => {
  console.error("Echo service failed:", error);
  process.exitCode = 1;
});
