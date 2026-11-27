import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer as createSocket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { parseArgs, promisify } from "node:util";
import { createServer } from "vite";

const airModule = "github.com/air-verse/air@v1.67.4";

async function availablePort() {
  const socket = createSocket();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const { port } = socket.address();
  await new Promise((resolve) => socket.close(resolve));
  return port;
}

const shutdown = new AbortController();
const interrupted = new Promise((resolve) =>
  shutdown.signal.addEventListener("abort", resolve, { once: true }),
);
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => shutdown.abort());
}

let buildDir;
let backend;
let backendClosed;
let vite;
try {
  let air;
  if (!process.env.CARTQUILT_SERVICE_PORT) {
    const { values } = parseArgs({
      args: process.argv
        .slice(2)
        .map((argument) => argument.replace(/^-(project|port)(=|$)/, "--$1$2")),
      options: { project: { type: "string" }, port: { type: "string", default: "0" } },
    });
    const requestedPort = Number(values.port);
    if (!/^\d+$/.test(values.port) || !Number.isInteger(requestedPort) || requestedPort > 65535)
      throw Error("Use a Go service port from 0 to 65535.");

    buildDir = await mkdtemp(join(tmpdir(), "cartquilt-air-"));
    const executable = join(buildDir, process.platform === "win32" ? "air.exe" : "air");
    console.log("Preparing Air for Go live reload…");
    await promisify(execFile)("go", ["install", airModule], {
      env: { ...process.env, GOBIN: buildDir },
      signal: shutdown.signal,
    });

    // Use one port for all rebuilds, keeping the Vite proxy pointed at the same address.
    const port = requestedPort || (await availablePort());
    air = { executable, port, project: values.project ?? process.env.CARTQUILT_PROJECT ?? "" };
    process.env.CARTQUILT_SERVICE_PORT = String(port);
  }

  // Bind Vite before starting Air so two dev sessions cannot use the same build output.
  vite = await createServer({ root: "web", configFile: "web/vite.config.mjs" });
  shutdown.signal.throwIfAborted();
  await vite.listen();
  shutdown.signal.throwIfAborted();

  if (air) {
    backend = spawn(
      air.executable,
      ["-c", "scripts/air.toml", "-color", "never", "--", "-port", String(air.port)],
      {
        // Air assembles app arguments into a shell command. Pass the path through the environment.
        env: {
          ...process.env,
          CARTQUILT_PROJECT: air.project,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    backendClosed = new Promise((resolve) => {
      backend.once("close", (code, signal) => resolve(signal ?? code));
    });
    const ready = new Promise((resolve, reject) => {
      backend.once("error", reject);
      for (const stream of [backend.stdout, backend.stderr]) {
        createInterface({ input: stream }).on("line", (line) => {
          console.log(line);
          if (line.endsWith(`Cartquilt at http://127.0.0.1:${air.port}`)) resolve();
        });
      }
    });
    await Promise.race([
      ready,
      backendClosed.then((reason) => {
        throw Error(`Air exited during startup (${reason}).`);
      }),
      interrupted,
    ]);
    shutdown.signal.throwIfAborted();
  }

  vite.printUrls();
  if (backendClosed) {
    await Promise.race([
      interrupted,
      backendClosed.then((reason) => {
        throw Error(`Air exited (${reason}).`);
      }),
    ]);
  } else {
    await interrupted;
  }
} catch (error) {
  if (!shutdown.signal.aborted) {
    console.error(error.stderr || error.message);
    process.exitCode = 1;
  }
} finally {
  backend?.kill();
  await Promise.allSettled([backendClosed, vite?.close()]);
  if (buildDir) await rm(buildDir, { recursive: true, force: true });
}
