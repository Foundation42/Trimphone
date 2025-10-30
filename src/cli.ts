#!/usr/bin/env node
import { runLiveTests } from "./integration/runLiveTests";

function printUsage() {
  console.log(`Trimphone CLI

Usage:
  trimphone test --live [--url <wss://...>]

Options:
  --url    SystemX WebSocket endpoint (default: env SYSTEMX_URL or wss://engram-fi-1.entrained.ai:2096)
  --help   Show this message
`);
}

async function handleTestCommand(args: string[]) {
  if (!args.includes("--live")) {
    console.error("Only --live tests are currently supported.");
    printUsage();
    process.exitCode = 1;
    return;
  }

  let url = process.env.SYSTEMX_URL ?? "wss://engram-fi-1.entrained.ai:2096";

  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--url") {
      const value = args[i + 1];
      if (!value) {
        console.error("Missing value for --url option.");
        process.exitCode = 1;
        return;
      }
      url = value;
    }
  }

  await runLiveTests({ url, logger: console.log });
}

async function main() {
  const [, , ...args] = process.argv;

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    printUsage();
    return;
  }

  const command = args.shift();

  try {
    switch (command) {
      case "test":
        await handleTestCommand(args);
        break;
      default:
        console.error(`Unknown command: ${command}`);
        printUsage();
        process.exitCode = 1;
    }
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
}

void main();
