import { ensureDir } from "@std/fs";
import { dirname, join } from "@std/path";
import { DvError } from "../domain/errors.ts";
import { CONFIG_DIR, configPath, recordsPath } from "../subtools/config/mod.ts";
import { requireRepoRoot } from "../subtools/git/repo-root.ts";

const STARTER_CONFIG = `# dv configuration. See https://dv.dev/schema/v1.yaml for the schema.
#
# Discovery defines which paths are Packages and which plugin owns each.
# Uncomment and adapt once you have a plugin (see specs/plugin-contract.md
# and the examples/ directory for copyable starting points).
#
# discovery:
#   plugins:
#     - match: "packages/*"
#       use:
#         run: deno run -A ./examples/plugins/deno/main.ts
#
# tagging:
#   format: "{package}@{version}"
`;

// A directory-local .gitignore so .dv/ stays clean even when an
// interactive editor (e.g. VSCode) crashes mid-`dv add`, leaving a
// stray temp file behind. Git honors nested .gitignores recursively
// (same as `.git/info/exclude` works for git's own internals). dv
// stays inside its own directory rather than reaching out to the
// repo's root .gitignore — keeping ownership boundaries clean.
const STARTER_CHANGELOG_GITIGNORE = `# In-progress record edit files. Normally cleaned up in dv's
# finally-block; this entry catches leftovers if the editor crashes.
.dv-record-edit-*
`;

export interface InitResult {
  repoRoot: string;
  configCreated: boolean;
  recordsDirCreated: boolean;
  gitignoreCreated: boolean;
}

export async function runInit(): Promise<InitResult> {
  const repoRoot = await requireRepoRoot();
  const cfgPath = configPath(repoRoot);
  const recPath = recordsPath(repoRoot);
  const gitignorePath = join(repoRoot, CONFIG_DIR, ".gitignore");

  await ensureDir(dirname(cfgPath));
  const configCreated = await writeIfMissing(cfgPath, STARTER_CONFIG);
  const recordsDirCreated = await ensureDirCreated(recPath);
  const gitignoreCreated = await writeIfMissing(
    gitignorePath,
    STARTER_CHANGELOG_GITIGNORE,
  );

  return { repoRoot, configCreated, recordsDirCreated, gitignoreCreated };
}

async function writeIfMissing(
  path: string,
  contents: string,
): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return false;
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
  }
  await Deno.writeTextFile(path, contents);
  return true;
}

async function ensureDirCreated(path: string): Promise<boolean> {
  try {
    const stat = await Deno.lstat(path);
    if (!stat.isDirectory) {
      throw new DvError({
        code: "init-not-a-directory",
        message: `${path} exists but is not a directory`,
        hint: "remove the conflicting file or run `dv init` in a clean directory",
        context: { path },
      });
    }
    return false;
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
  }
  await ensureDir(path);
  return true;
}
