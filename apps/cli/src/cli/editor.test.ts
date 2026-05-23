import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { resolveRecordEditDirectory } from "./editor.ts";

// Editor-launching itself is integration-tested by hand (it spawns a
// real editor and waits on user input). The path-resolution piece —
// where dv writes the in-progress edit file — is testable in
// isolation, and it's load-bearing for the VSCode "untrusted file"
// warning: a path inside the repo inherits workspace trust; a path in
// $TMPDIR does not.

Deno.test("resolveRecordEditDirectory writes inside <repoRoot>/.dv", () => {
  // Given any repo root
  const repoRootPath = "/some/repo";

  // When the helper resolves the edit directory
  const editDirectory = resolveRecordEditDirectory({ repoRootPath });

  // Then the path is rooted at the repo and sits under .dv (so
  // VSCode treats it as part of the trusted workspace, matching git's
  // pattern of writing to .git/COMMIT_EDITMSG)
  assertEquals(editDirectory, join("/some/repo", ".dv"));
});

Deno.test("resolveRecordEditDirectory threads the supplied repo root verbatim", () => {
  // Given a different repo root with spaces
  const repoRootPath = "/Users/example/Path With Spaces/my-repo";

  // When the helper resolves the edit directory
  const editDirectory = resolveRecordEditDirectory({ repoRootPath });

  // Then the result preserves the supplied root and joins .dv
  // with the platform separator (assertEquals via join below normalizes)
  assertEquals(
    editDirectory,
    join("/Users/example/Path With Spaces/my-repo", ".dv"),
  );
});
