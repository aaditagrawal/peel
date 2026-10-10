import { spawn } from "node:child_process";
const children = [
  spawn("bun", ["run", "server"], { stdio: "inherit" }),
  spawn("bun", ["run", "web"], { stdio: "inherit" }),
];
let exiting = false;
function stop(code = 0) {
  if (exiting) return;
  exiting = true;
  children.forEach((child) => child.kill("SIGTERM"));
  process.exitCode = code;
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
children.forEach((child) => child.on("exit", (code) => stop(code || 0)));
