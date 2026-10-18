// npm run app:dev [-- <port>]: the Android app on the phone plugged in over
// USB, showing the debug dev server (README "Android app"). Edits reload in the
// app like in a browser tab, and the debug panel's perf log lands in perf-logs/.
// Ctrl+C stops both, and the app goes back to its bundled build on the next
// app:run.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const port = process.argv[2] ?? "5173";
if (!/^\d+$/.test(port)) {
  console.error(`[app:dev] not a port: ${port}`);
  process.exit(1);
}

// cap run copies dist/ into the app before it builds, even though the app
// will show the dev server: a fresh checkout has no dist/ yet.
if (!existsSync("dist/index.html")) {
  const build = spawnSync("npm", ["run", "build:debug"], { stdio: "inherit" });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const children = [
  // Localhost only: the phone reaches it through adb reverse (--forwardPorts),
  // and http://localhost counts as secure, so the camera works.
  spawn("npm", ["run", "dev:debug", "--", "--host", "127.0.0.1", "--port", port, "--strictPort"], { stdio: "inherit" }),
  spawn(
    "npx",
    ["cap", "run", "android", "--live-reload", "--host", "localhost", "--port", port, "--forwardPorts", `${port}:${port}`],
    { stdio: "inherit" },
  ),
];

// When one stops (Ctrl+C, a failed Gradle build, a port in use), stop the other.
// SIGINT lets cap run take its live-reload URL back out of the app's config.
for (const child of children) {
  child.on("exit", (code) => {
    if (code) process.exitCode ||= code;
    for (const other of children) if (other !== child && other.exitCode === null) other.kill("SIGINT");
  });
}
// Ctrl+C reaches the children directly; this process just waits for them.
process.on("SIGINT", () => { });
