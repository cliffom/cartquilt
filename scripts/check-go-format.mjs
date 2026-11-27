import { execFileSync } from "node:child_process";

// gofmt -l lists files that need formatting but still exits successfully.
const files = execFileSync("gofmt", ["-l", "cmd"], { encoding: "utf8" }).trim();
if (files) {
  console.error(`Run npm run format to format these Go files:\n${files}`);
  process.exitCode = 1;
}
