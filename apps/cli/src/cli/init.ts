import { ensureDir } from "@std/fs";
import { dirname } from "@std/path";
import { configPath, recordsPath } from "../subtools/config/mod.ts";
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
#       use: ./examples/plugins/deno
#
# tagging:
#   format: "{package}@{version}"
`;

export interface InitResult {
  repoRoot: string;
  configCreated: boolean;
  recordsDirCreated: boolean;
}

export async function runInit(): Promise<InitResult> {
  const repoRoot = await requireRepoRoot();
  const cfgPath = configPath(repoRoot);
  const recPath = recordsPath(repoRoot);

  await ensureDir(dirname(cfgPath));
  const configCreated = await writeIfMissing(cfgPath, STARTER_CONFIG);
  const recordsDirCreated = await ensureDirCreated(recPath);

  return { repoRoot, configCreated, recordsDirCreated };
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
      throw new Error(`${path} exists but is not a directory`);
    }
    return false;
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
  }
  await ensureDir(path);
  return true;
}
