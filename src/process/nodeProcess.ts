import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from "node:child_process";
import { Readable, Writable } from "node:stream";
import type { TrimphoneProcess } from "./types";

export interface SpawnProcessOptions extends SpawnOptionsWithoutStdio {
  killSignal?: NodeJS.Signals | number;
}

export function spawnNodeProcess(
  command: string,
  args: string[] = [],
  options: SpawnProcessOptions = {},
): TrimphoneProcess {
  const child: ChildProcessWithoutNullStreams = spawn(command, args, {
    stdio: ["pipe", "pipe", "pipe"],
    ...options,
  });

  const stdin = Writable.toWeb(child.stdin);
  const stdout = Readable.toWeb(child.stdout);
  const stderr = Readable.toWeb(child.stderr);

  return {
    stdin,
    stdout,
    stderr,
    stop(reason?: string) {
      if (child.killed) {
        return;
      }
      const signal = options.killSignal ?? "SIGTERM";
      child.kill(signal);
      void reason;
    },
  };
}
