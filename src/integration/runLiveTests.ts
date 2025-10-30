import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import type { Trimphone } from "../trimphone";
import { Trimphone as TrimphoneClient } from "../trimphone";

type LiveTestOptions = {
  url: string;
  logger?: (message: string) => void;
};

type CleanupFn = () => void | Promise<void>;

function uniqueAddress(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}@trimphone-tests.io`;
}

async function createPhone(url: string, address: string, cleanup: CleanupFn[], logger: (msg: string) => void): Promise<Trimphone> {
  const phone = new TrimphoneClient(url);
  phone.on("error", (error) => logger(`[${address}] error: ${error.message}`));
  await phone.register(address);
  cleanup.push(() => phone.close());
  return phone;
}

async function waitForEvent<T>(attach: (resolve: (value: T) => void, reject: (err: Error) => void) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    attach(resolve, reject);
  });
}

async function runEchoTest(url: string, logger: (msg: string) => void) {
  logger("🔁 Running echo message test");
  const cleanup: CleanupFn[] = [];
  const serviceAddress = uniqueAddress("echo-service");
  const clientAddress = uniqueAddress("echo-client");

  try {
    const service = await createPhone(url, serviceAddress, cleanup, logger);

    const serviceReady = waitForEvent<void>((resolve, reject) => {
      service.on("ring", (call) => {
        call.answer();
        call.on("message", (msg) => {
          call.send(`Echo: ${msg}`);
        });
        call.on("hangup", () => resolve());
        call.on("error", (err) => reject(err as Error));
      });
    });

    const client = await createPhone(url, clientAddress, cleanup, logger);
    const call = await client.dial(serviceAddress);
    call.send("Hello SystemX");

    const response = await waitForEvent<string>((resolve, reject) => {
      call.on("message", (msg) => resolve(String(msg)));
      call.on("error", (err) => reject(err as Error));
    });

    if (response !== "Echo: Hello SystemX") {
      throw new Error(`Unexpected echo response: ${response}`);
    }

    call.hangup();
    await serviceReady;
    logger("✅ Echo message test passed");
  } finally {
    for (const fn of cleanup.reverse()) {
      await fn();
    }
  }
}

async function runStreamEchoTest(url: string, logger: (msg: string) => void) {
  logger("🔁 Running stream echo test");
  const cleanup: CleanupFn[] = [];
  const serviceAddress = uniqueAddress("stream-service");
  const clientAddress = uniqueAddress("stream-client");

  try {
    const service = await createPhone(url, serviceAddress, cleanup, logger);

    const serviceReady = waitForEvent<void>((resolve, reject) => {
      service.on("ring", (call) => {
        call.answer();
        const stream = call.getStream();
        stream.on("data", (chunk) => {
          stream.write(chunk);
        });
        call.on("hangup", () => resolve());
        call.on("error", (err) => reject(err as Error));
      });
    });

    const client = await createPhone(url, clientAddress, cleanup, logger);
    const call = await client.dial(serviceAddress);
    const stream = call.getStream();

    const echoed = waitForEvent<string>((resolve, reject) => {
      stream.on("data", (chunk) => resolve(chunk.toString("utf8")));
      stream.on("error", (err) => reject(err as Error));
      call.on("error", (err) => reject(err as Error));
    });

    stream.write("Stream hello\n");
    const result = (await echoed).trim();
    if (result !== "Stream hello") {
      throw new Error(`Unexpected stream echo: ${result}`);
    }

    call.hangup();
    await serviceReady;
    logger("✅ Stream echo test passed");
  } finally {
    for (const fn of cleanup.reverse()) {
      await fn();
    }
  }
}

async function runStdioTest(url: string, logger: (msg: string) => void) {
  logger("🔁 Running stdio tunneling test");
  const cleanup: CleanupFn[] = [];
  const serviceAddress = uniqueAddress("stdio-service");
  const clientAddress = uniqueAddress("stdio-client");

  try {
    const service = await createPhone(url, serviceAddress, cleanup, logger);

    const serviceReady = waitForEvent<void>((resolve, reject) => {
      service.on("ring", (call) => {
        call.answer();

        const proc = spawn("node", [
          "-e",
          "process.stdin.on('data', chunk => process.stdout.write(chunk.toString().toUpperCase()))",
        ]);

        const stream = call.getStream();
        proc.stdout.pipe(stream);
        stream.pipe(proc.stdin);

        proc.on("error", (err) => {
          proc.kill();
          reject(err);
        });
        proc.on("exit", () => {
          call.hangup();
        });

        call.on("hangup", () => {
          proc.kill();
          resolve();
        });
        call.on("error", (err) => {
          proc.kill();
          reject(err as Error);
        });
      });
    });

    const client = await createPhone(url, clientAddress, cleanup, logger);
    const call = await client.dial(serviceAddress);
    const stream = call.getStream();

    const received = waitForEvent<string>((resolve, reject) => {
      stream.on("data", (chunk) => resolve(chunk.toString("utf8")));
      stream.on("error", (err) => reject(err as Error));
      call.on("error", (err) => reject(err as Error));
    });

    stream.write("hello shells\n");
    const output = (await received).trim();

    if (output !== "HELLO SHELLS") {
      throw new Error(`Unexpected stdio response: ${output}`);
    }

    call.hangup();
    await serviceReady;
    logger("✅ Stdio tunneling test passed");
  } finally {
    for (const fn of cleanup.reverse()) {
      await fn();
    }
  }
}

export async function runLiveTests(options: LiveTestOptions) {
  const logger = options.logger ?? console.log;
  await runEchoTest(options.url, logger);
  await runStreamEchoTest(options.url, logger);
  await runStdioTest(options.url, logger);
  logger("🎉 All live tests succeeded");
}
