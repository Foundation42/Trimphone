import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { Trimphone } from "../src/trimphone";

const URL = "wss://engram-fi-1.entrained.ai:2096";

function uniqueAddress(local: string): string {
  const suffix = randomUUID().slice(0, 8);
  return `${local}-${suffix}@trimphone-tests.io`;
}

async function createPhone(address: string) {
  const phone = new Trimphone(URL);
  phone.on("error", (error) => {
    console.error(`[${address}] error:`, error);
  });
  await phone.register(address);
  return phone;
}

async function runEchoTest() {
  console.log("🔁 Running echo message test");
  const serviceAddress = uniqueAddress("echo-service");
  const clientAddress = uniqueAddress("echo-client");

  const service = await createPhone(serviceAddress);
  const ready = new Promise<void>((resolve, reject) => {
    service.on("ring", (call) => {
      call.answer();
      call.on("message", (msg) => {
        call.send(`Echo: ${msg}`);
      });
      call.on("hangup", () => resolve());
      call.on("error", reject);
    });
  });

  const client = await createPhone(clientAddress);
  const call = await client.dial(serviceAddress);
  const responsePromise = new Promise<string>((resolve, reject) => {
    call.on("message", (msg) => resolve(String(msg)));
    call.on("error", reject);
  });

  call.send("Hello SystemX");

  const response = await responsePromise;
  if (response !== "Echo: Hello SystemX") {
    throw new Error(`Unexpected echo response: ${response}`);
  }

  call.hangup();
  await ready;

  service.close();
  client.close();
  console.log("✅ Echo message test passed");
}

async function runStreamEchoTest() {
  console.log("🔁 Running stream echo test");
  const serviceAddress = uniqueAddress("stream-service");
  const clientAddress = uniqueAddress("stream-client");

  const service = await createPhone(serviceAddress);
  const streamComplete = new Promise<void>((resolve, reject) => {
    service.on("ring", (call) => {
      call.answer();
      const stream = call.getStream();
      stream.on("data", (chunk) => {
        stream.write(chunk);
      });
      call.on("hangup", () => resolve());
      call.on("error", reject);
    });
  });

  const client = await createPhone(clientAddress);
  const call = await client.dial(serviceAddress);
  const stream = call.getStream();

  const echoedPromise = new Promise<string>((resolve, reject) => {
    stream.on("data", (chunk) => resolve(chunk.toString("utf8")));
    stream.on("error", reject);
    call.on("error", reject);
  });

  stream.write("Stream hello\n");
  const echoed = await echoedPromise;

  if (echoed.trim() !== "Stream hello") {
    throw new Error(`Unexpected stream echo: ${echoed}`);
  }

  call.hangup();
  await streamComplete;

  service.close();
  client.close();
  console.log("✅ Stream echo test passed");
}

async function runStdioTest() {
  console.log("🔁 Running stdio tunneling test");
  const serviceAddress = uniqueAddress("stdio-service");
  const clientAddress = uniqueAddress("stdio-client");

  const service = await createPhone(serviceAddress);
  const serviceReady = new Promise<void>((resolve, reject) => {
    service.on("ring", (call) => {
      call.answer();
      const proc = spawn("node", [
        "-e",
        "process.stdin.on('data', chunk => process.stdout.write(chunk.toString().toUpperCase()))",
      ]);
      const stream = call.getStream();
      proc.stdout.pipe(stream);
      stream.pipe(proc.stdin);
      proc.on("error", reject);
      proc.on("exit", () => call.hangup());
      call.on("hangup", () => {
        proc.kill();
        resolve();
      });
      call.on("error", (err) => {
        proc.kill();
        reject(err);
      });
    });
  });

  const client = await createPhone(clientAddress);
  const call = await client.dial(serviceAddress);
  const stream = call.getStream();

  const received = new Promise<string>((resolve, reject) => {
    stream.on("data", (chunk) => resolve(chunk.toString("utf8")));
    stream.on("error", reject);
    call.on("error", reject);
  });

  stream.write("hello shells\n");
  const output = (await received).trim();

  if (output !== "HELLO SHELLS") {
    throw new Error(`Unexpected stdio response: ${output}`);
  }

  call.hangup();
  await serviceReady;

  service.close();
  client.close();
  console.log("✅ Stdio tunneling test passed");
}

async function main() {
  await runEchoTest();
  await runStreamEchoTest();
  await runStdioTest();
  console.log("🎉 All live tests succeeded");
  await new Promise((resolve) => setTimeout(resolve, 250));
}

main().catch((error) => {
  console.error("Live tests failed:", error);
  process.exitCode = 1;
});
