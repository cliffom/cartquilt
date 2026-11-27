import { spawn } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test as base } from "@playwright/test";

const root = fileURLToPath(new URL("../../", import.meta.url));
const binary = join(root, ".local", "cartquilt-e2e.exe");

export const test = base.extend({
  workspace: async ({ request }, use) => {
    const folder = await mkdtemp(join(tmpdir(), "cartquilt-e2e-"));
    const child = spawn(binary, ["-port", "0", "-project", ""], {
      cwd: root,
      stdio: ["ignore", "ignore", "pipe"],
    });
    const closed = new Promise((resolve) => child.once("close", resolve));
    let logs = "";
    try {
      const origin = await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code, signal) => {
          reject(Error(`Cartquilt exited (${code ?? signal}).\n${logs}`));
        });
        child.stderr.on("data", (chunk) => {
          logs += chunk;
          const address = logs.match(/Cartquilt at (http:\/\/127\.0\.0\.1:\d+)\r?\n/);
          if (address) resolve(address[1]);
        });
      });
      await use({ origin, folder, request });
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await closed;
      await rm(folder, { recursive: true, force: true });
    }
  },
});

export { expect };

export async function openExample(page, { origin, folder, request }) {
  const path = join(folder, "threadvale");
  await cp(join(root, "examples", "threadvale"), path, { recursive: true });
  const response = await request.post(`${origin}/api/project-open`, { data: { path } });
  await expect(response).toBeOK();
  await page.goto(new URL(response.headers().location, origin).href);
  await expect(page.getByRole("heading", { name: "World map" })).toBeVisible();
}
