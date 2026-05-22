import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { listTagsMatching, tagExists } from "./tag-query.ts";

interface SetUpRepoResult {
  repoRootPath: string;
  cleanup: () => Promise<void>;
}

async function setUpRepoWithTags(tagNames: string[]): Promise<SetUpRepoResult> {
  const repoRootPath = await Deno.makeTempDir({ prefix: "dv-tag-query-" });
  await new Deno.Command("git", {
    args: ["-C", repoRootPath, "init", "-q"],
  }).output();
  await new Deno.Command("git", {
    args: [
      "-C",
      repoRootPath,
      "config",
      "user.email",
      "dv-test@example.invalid",
    ],
  }).output();
  await new Deno.Command("git", {
    args: ["-C", repoRootPath, "config", "user.name", "dv test"],
  }).output();
  await new Deno.Command("git", {
    args: ["-C", repoRootPath, "config", "commit.gpgsign", "false"],
  }).output();
  await new Deno.Command("git", {
    args: ["-C", repoRootPath, "config", "tag.gpgsign", "false"],
  }).output();
  await Deno.writeTextFile(join(repoRootPath, "seed.txt"), "x");
  await new Deno.Command("git", {
    args: ["-C", repoRootPath, "add", "seed.txt"],
  }).output();
  await new Deno.Command("git", {
    args: ["-C", repoRootPath, "commit", "-m", "seed", "--no-gpg-sign", "-q"],
  }).output();
  for (const tagName of tagNames) {
    await new Deno.Command("git", {
      args: ["-C", repoRootPath, "tag", tagName],
    }).output();
  }
  return {
    repoRootPath,
    cleanup: async () => {
      await Deno.remove(repoRootPath, { recursive: true });
    },
  };
}

Deno.test("tagExists returns true for a tag that has been minted", async () => {
  // Given a repo where `core@1.0.0` has been tagged
  const fixture = await setUpRepoWithTags(["core@1.0.0"]);

  // When tagExists is asked about that tag
  try {
    const result = await tagExists({
      repoRootPath: fixture.repoRootPath,
      tag: "core@1.0.0",
    });

    // Then it returns true
    assertEquals(result, true);
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("tagExists returns false (without throwing) when the tag does not exist", async () => {
  // Given a repo with no tags
  const fixture = await setUpRepoWithTags([]);

  // When tagExists is asked about a hypothetical tag
  try {
    const result = await tagExists({
      repoRootPath: fixture.repoRootPath,
      tag: "ghost@9.9.9",
    });

    // Then it returns false — a non-existent tag is a normal answer,
    // not a failure (Algebra §4: "released?" is a predicate, not an
    // assertion)
    assertEquals(result, false);
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("listTagsMatching returns every tag when no pattern is supplied", async () => {
  // Given a repo with three tags
  const fixture = await setUpRepoWithTags([
    "core@1.0.0",
    "core@1.1.0",
    "cli@0.1.0",
  ]);

  // When listTagsMatching runs with no pattern
  try {
    const result = await listTagsMatching({
      repoRootPath: fixture.repoRootPath,
    });

    // Then it returns all three (sort order is git's; we don't rely
    // on it here)
    assertEquals(result.length, 3);
    assertEquals(result.includes("core@1.0.0"), true);
    assertEquals(result.includes("core@1.1.0"), true);
    assertEquals(result.includes("cli@0.1.0"), true);
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("listTagsMatching filters by glob pattern (the 'has this package any prior tags?' query)", async () => {
  // Given a repo with mixed-package tags
  const fixture = await setUpRepoWithTags([
    "core@1.0.0",
    "core@1.1.0",
    "cli@0.1.0",
  ]);

  // When listTagsMatching is given the `core@*` pattern
  try {
    const result = await listTagsMatching({
      repoRootPath: fixture.repoRootPath,
      pattern: "core@*",
    });

    // Then only core's tags come back — what `dv release` uses to
    // decide if a package's incoming 1.0.0 is its first stable
    assertEquals(result.length, 2);
    assertEquals(result.includes("cli@0.1.0"), false);
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("listTagsMatching returns an empty array (without throwing) when the pattern matches nothing", async () => {
  // Given a repo with no tags
  const fixture = await setUpRepoWithTags([]);

  // When listTagsMatching is given a pattern
  try {
    const result = await listTagsMatching({
      repoRootPath: fixture.repoRootPath,
      pattern: "core@*",
    });

    // Then it returns [] — the first-stable check ("has this package
    // any prior tags?") wants this to be a normal answer
    assertEquals(result, []);
  } finally {
    await fixture.cleanup();
  }
});
