import { assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

// Regression for the deno.lock finalize/staging bug (ROADMAP §
// Post-first-release follow-ups). The finalize op must report
// deno.lock whenever it is out of sync with HEAD — including drift
// caused by earlier tooling that this op's own `deno install` did NOT
// produce. The old implementation diffed the lockfile before/after its
// own install and missed that pre-existing drift, so dv never staged
// it and the version commit silently shipped incomplete.

const pluginEntryPath = fromFileUrl(import.meta.resolve("./main.ts"));

interface FixtureResult {
  repoRootPath: string;
  cleanup: () => Promise<void>;
}

async function setUpRepoWithCommittedLockfile(): Promise<FixtureResult> {
  const repoRootPath = await Deno.makeTempDir({ prefix: "dv-finalize-op-" });
  const git = (args: string[]) =>
    new Deno.Command("git", { args: ["-C", repoRootPath, ...args] }).output();
  await git(["init", "-q"]);
  await git(["config", "user.email", "dv-test@example.invalid"]);
  await git(["config", "user.name", "dv test"]);
  // A workspace with one real jsr dependency, plus a *stale* (empty)
  // committed lockfile. `deno install` will populate the lock to match
  // the manifest, producing genuine drift from HEAD — a faithful stand-in
  // for the warm-cache scenario where the lock is out of sync with the
  // commit by the time finalize runs.
  await Deno.writeTextFile(
    join(repoRootPath, "deno.json"),
    `${
      JSON.stringify(
        {
          name: "@fixture/root",
          version: "0.1.0",
          imports: { "@std/path": "jsr:@std/path@^1" },
        },
        null,
        2,
      )
    }\n`,
  );
  await Deno.writeTextFile(
    join(repoRootPath, "deno.lock"),
    `${JSON.stringify({ version: "5", specifiers: {} }, null, 2)}\n`,
  );
  await git(["add", "."]);
  await git(["commit", "-m", "initial", "--no-gpg-sign"]);
  return {
    repoRootPath,
    cleanup: () => Deno.remove(repoRootPath, { recursive: true }),
  };
}

async function runFinalizeOp(
  repoRootPath: string,
): Promise<{ ok: boolean; additionalChangedFiles?: string[] }> {
  const output = await new Deno.Command("deno", {
    args: ["run", "-A", pluginEntryPath, "finalize"],
    env: {
      DV_REPO_ROOT: repoRootPath,
      DV_FINALIZE_TRIGGER: "version",
      DV_BUMPED_PACKAGES: JSON.stringify([
        { name: "@fixture/root", path: ".", new_version: "0.2.0" },
      ]),
    },
    stdout: "piped",
    stderr: "piped",
  }).output();
  return JSON.parse(new TextDecoder().decode(output.stdout));
}

Deno.test("finalize reports deno.lock when it is out of sync with HEAD", async () => {
  // Given a repo whose committed lockfile is stale relative to its
  // manifest (the warm-cache scenario: the lock drifts before finalize)
  const fixture = await setUpRepoWithCommittedLockfile();

  // When the finalize op runs — its `deno install` brings the lock in
  // line with the manifest, leaving it different from the committed HEAD
  const response = await runFinalizeOp(fixture.repoRootPath);

  // Then it reports deno.lock, because it diffs against HEAD (not just
  // its own before/after delta), so dv will stage it into the commit
  try {
    assertEquals(response.ok, true);
    assertEquals(response.additionalChangedFiles, ["deno.lock"]);
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("finalize reports no additional files when deno.lock already matches HEAD", async () => {
  // Given a repo where the lockfile has already been refreshed and
  // committed, so it is in sync with HEAD before finalize runs
  const fixture = await setUpRepoWithCommittedLockfile();
  await runFinalizeOp(fixture.repoRootPath); // populate the lock
  await new Deno.Command("git", {
    args: [
      "-C",
      fixture.repoRootPath,
      "commit",
      "-am",
      "refresh lock",
      "--no-gpg-sign",
    ],
  }).output();

  // When the finalize op runs again with nothing drifted
  const response = await runFinalizeOp(fixture.repoRootPath);

  // Then it reports an empty list — no churn for an in-sync lockfile
  try {
    assertEquals(response.ok, true);
    assertEquals(response.additionalChangedFiles, []);
  } finally {
    await fixture.cleanup();
  }
});
