import { Trimphone } from "../src/trimphone";

const URL = "wss://engram-fi-1.entrained.ai:2096";

async function main() {
  const phone = new Trimphone(URL);
  await phone.register("client@trimphone.io");

  console.log("📞 Dialing echo-test@trimphone.io...");
  const call = await phone.dial("echo-test@trimphone.io");
  console.log("✅ Connected to echo service");
  call.send("Hello, Trimphone!");

  call.on("message", (response) => {
    console.log("Response:", response);
    call.hangup();
  });

  call.on("hangup", () => {
    console.log("📴 Echo call ended");
  });

  console.log("📞 Dialing stream-echo@trimphone.io...");
  const streamCall = await phone.dial("stream-echo@trimphone.io");
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
