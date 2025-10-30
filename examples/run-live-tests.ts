import { runLiveTests } from "../src/integration/runLiveTests";

const url = process.env.SYSTEMX_URL ?? "wss://engram-fi-1.entrained.ai:2096";

runLiveTests({ url }).catch((error) => {
  console.error("Live tests failed:", error);
  process.exitCode = 1;
});
