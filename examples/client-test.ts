import { Trimphone } from "../src/trimphone";

const URL = "wss://engram-fi-1.entrained.ai:2096";

async function main() {
  const phone = new Trimphone(URL);
  await phone.register("client@home.local");

  console.log("📞 Dialing echo-test@home.local...");
  const call = await phone.dial("echo-test@home.local");
  console.log("✅ Connected to echo service");
  call.send("Hello, Trimphone!");

  call.on("message", (response) => {
    console.log("Response:", response);
    call.hangup();
  });

  call.on("hangup", () => {
    console.log("📴 Echo call ended");
  });

  console.log("📞 Dialing stream-echo@home.local...");
  const streamCall = await phone.dial("stream-echo@home.local");
  const stream = streamCall.getStream();

  stream.write("Stream test data!\n");

  stream.on("data", (chunk) => {
    console.log("Stream echo:", chunk.toString());
    streamCall.hangup();
  });

  streamCall.on("hangup", () => {
    console.log("📴 Stream call ended");
  });
}

main().catch((error) => {
  console.error("Client test failed:", error);
  process.exitCode = 1;
});
