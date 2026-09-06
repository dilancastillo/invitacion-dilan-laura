import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const csvRoute = "app/api/admin/rsvps.csv/route.ts";

test("the private CSV endpoint is tracked and included in Git deployments", () => {
  const tracked = execFileSync("git", ["ls-files", "--error-unmatch", "--", csvRoute], {
    cwd: root, encoding: "utf8", windowsHide: true,
  });
  assert.equal(tracked.trim(), csvRoute);
});

test("deployment ignore rules still protect guest lists and secrets", () => {
  const privatePaths = ["private/invitados.csv", "invitados.csv", "invitados.xlsx", ".env.local"];
  const ignored = execFileSync("git", ["check-ignore", "--no-index", "--stdin"], {
    cwd: root, encoding: "utf8", windowsHide: true,
    input: [...privatePaths, csvRoute].join("\n") + "\n",
  }).trim().split(/\r?\n/);
  assert.deepEqual(ignored, privatePaths);
});
