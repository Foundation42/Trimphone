import { Trimphone } from "../src/trimphone";

const URL = "wss://engram-fi-1.entrained.ai:2096";

async function main() {
  const phone = new Trimphone(URL);
  await phone.register("stream-echo@home.local");

  phone.on("ring", (call) => {
    console.log(`📞 Stream call from ${call.from}`);
    call.answer();

    const stream = call.getStream();
    stream.on("data", (chunk) => {
      stream.write(chunk);
    });

    call.on("hangup", () => {
      console.log("📴 Stream caller hung up");
    });

    console.log("🌊 Stream echo active");
  });

  console.log("✅ Stream echo service ready!");
}

main().catch((error) => {
  console.error("Stream echo service failed:", error);
  process.exitCode = 1;
});
