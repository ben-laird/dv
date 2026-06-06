import { join } from "@std/path";
import { CHANGE_TYPES, type ChangeType } from "../domain/change-type.ts";
import { DvError } from "../domain/errors.ts";
import {
  CONFIG_DIR,
  configPath,
  loadConfig,
  recordsPath,
} from "../subtools/config/mod.ts";
import { discoverPackages } from "../subtools/discovery/mod.ts";
import { requireRepoRoot } from "../subtools/git/repo-root.ts";
import {
  generateSlug,
  type SlugRandomSource,
  serializeRecord,
} from "../subtools/records/mod.ts";
import {
  buildRenameResolver,
  loadRenameLedger,
  renamesPath,
} from "../subtools/renames/mod.ts";
import { promptForRecordInputs } from "./add-prompts.ts";
import { openEditorForRecordBody } from "./editor.ts";

// `dv add` per specs/cli.md § dv add. Creates one Record file in
// .dv/records/ from either flag inputs (CI / scripts / agents) or
// an interactive TTY flow with prompts + $EDITOR. The two paths share
// validation: known packages, allowed Change Type, non-empty body.

/**
 * Inputs to {@link runAdd}. Non-interactive fields mirror the `dv add` CLI
 * flags; any left unset in a TTY context are filled by interactive prompts,
 * while a non-TTY context requires `changeType`, `packageNames`, and
 * `message`.
 */
export interface RunAddOptions {
  /** Record Change Type (`feat`, `fix`, `feat!`, `fix!`). */
  changeType?: ChangeType;
  /** Target Package names the Record applies to. */
  packageNames?: string[];
  /** One-line Record summary; suppresses the `$EDITOR` body flow. */
  message?: string;
  /** Reference links (issues, PRs) recorded in the Record. */
  links?: string[];
  /** Free-form notes appended to the Record body. */
  notes?: string;

  /** Override `records.auto-stage` for this invocation. */
  stageOverride?: boolean;

  /**
   * Override `$EDITOR` / `$VISUAL` for this invocation. Honored only when the
   * editor template is actually launched (i.e. no `message`). Same POSIX-shell
   * parsing as the env var.
   */
  editorOverride?: string;

  /** Test seam: deterministic slug generation. */
  slugRandomSource?: SlugRandomSource;
}

/** Outcome of a successful {@link runAdd}: the Record file it wrote. */
export interface RunAddResult {
  /** Absolute path to the created Record file under `.dv/records/`. */
  recordPath: string;
  /** Absolute path to the repository root. */
  repoRootPath: string;
  /** Whether the new Record was git-staged (per `records.auto-stage`). */
  staged: boolean;
}

/**
 * Authors a single Record file under `.dv/records/` from {@link RunAddOptions},
 * via flag inputs (CI / scripts / agents) or an interactive TTY flow with
 * prompts and `$EDITOR`. Both paths share validation: known Packages, an
 * allowed Change Type, and a non-empty body.
 *
 * @param options Record inputs and per-invocation overrides.
 * @returns The written Record's path and staging state.
 */
export async function runAdd(options: RunAddOptions): Promise<RunAddResult> {
  const repoRootPath = await requireRepoRoot();
  const configFilePath = configPath(repoRootPath);
  const loadedConfig = await loadConfig(configFilePath);
  const discoveredPackages = await discoverPackages({
    config: loadedConfig,
    repoRootPath,
  });

  const renameLedger = await loadRenameLedger({
    ledgerPath: renamesPath(repoRootPath),
  });
  const renameResolver = buildRenameResolver({ ledger: renameLedger });
  const knownPackageNames = new Set(discoveredPackages.map((pkg) => pkg.name));

  const resolvedRecordInputs = await collectRecordInputs({
    options,
    knownPackageNames,
    discoveredPackages: discoveredPackages.map((pkg) => pkg.name),
    repoRootPath,
  });

  validatePackageReferences({
    packageReferences: resolvedRecordInputs.packageNames,
    knownPackageNames,
    renameResolver,
  });

  const recordsDirectory = recordsPath(repoRootPath);
  await Deno.mkdir(recordsDirectory, { recursive: true });

  const chosenRecordPath = await chooseUnusedRecordPath({
    recordsDirectory,
    slugRandomSource: options.slugRandomSource,
  });
  const fileContents = serializeRecord({
    type: resolvedRecordInputs.changeType,
    packages: resolvedRecordInputs.packageNames,
    body: resolvedRecordInputs.body,
    links: resolvedRecordInputs.links,
    notes: resolvedRecordInputs.notes,
  });
  await Deno.writeTextFile(chosenRecordPath, fileContents);

  const shouldStage = options.stageOverride ?? loadedConfig.records.autoStage;
  const staged = shouldStage
    ? await stageWithGit({ recordPath: chosenRecordPath, repoRootPath })
    : false;

  return { recordPath: chosenRecordPath, repoRootPath, staged };
}

interface CollectRecordInputsArgs {
  options: RunAddOptions;
  knownPackageNames: Set<string>;
  discoveredPackages: string[];
  repoRootPath: string;
}

interface ResolvedRecordInputs {
  changeType: ChangeType;
  packageNames: string[];
  body: string;
  links?: string[];
  notes?: string;
}

async function collectRecordInputs(
  args: CollectRecordInputsArgs,
): Promise<ResolvedRecordInputs> {
  const flagInputsComplete =
    args.options.changeType !== undefined &&
    args.options.packageNames !== undefined &&
    args.options.message !== undefined;

  if (flagInputsComplete) {
    return {
      changeType: args.options.changeType as ChangeType,
      packageNames: args.options.packageNames as string[],
      body: args.options.message as string,
      links: args.options.links,
      notes: args.options.notes,
    };
  }

  if (!Deno.stdout.isTerminal()) {
    throw new DvError({
      code: "add-flags-required",
      message: "non-TTY mode requires --type, --packages, and --message",
      hint: "pass --type, --packages, and --message (or pipe stdin with --message=-)",
    });
  }

  if (args.discoveredPackages.length === 0) {
    throw new DvError({
      code: "add-no-packages",
      message: "no packages discovered — configure `discovery.plugins` first",
      hint: `add a discovery plugin assignment in ${CONFIG_DIR}/config.yaml`,
    });
  }

  const interactiveAnswers = promptForRecordInputs({
    discoveredPackages: args.discoveredPackages,
    presetChangeType: args.options.changeType,
    presetPackageNames: args.options.packageNames,
  });

  const recordBody =
    args.options.message ??
    (await openEditorForRecordBody({
      changeType: interactiveAnswers.changeType,
      packageNames: interactiveAnswers.packageNames,
      repoRootPath: args.repoRootPath,
      editorOverride: args.options.editorOverride,
    }));

  if (recordBody.trim().length === 0) {
    throw new DvError({
      code: "add-empty-body",
      message: "empty body — no record file written",
    });
  }

  return {
    changeType: interactiveAnswers.changeType,
    packageNames: interactiveAnswers.packageNames,
    body: recordBody,
    links: args.options.links,
    notes: args.options.notes,
  };
}

interface ValidatePackageReferencesArgs {
  packageReferences: string[];
  knownPackageNames: Set<string>;
  renameResolver: { resolve(packageReference: string): string | undefined };
}

function validatePackageReferences(args: ValidatePackageReferencesArgs): void {
  const unknownReferences: string[] = [];
  for (const packageReference of args.packageReferences) {
    const resolvedName =
      args.renameResolver.resolve(packageReference) ?? packageReference;
    if (!args.knownPackageNames.has(resolvedName)) {
      unknownReferences.push(packageReference);
    }
  }
  if (unknownReferences.length > 0) {
    throw new DvError({
      code: "add-unknown-package",
      message: `unknown package(s): ${unknownReferences.join(", ")}`,
      hint: "check package names against `dv status`; add a rename via `dv rename` if a package was renamed",
      context: { unknownPackages: unknownReferences },
    });
  }
}

interface ChooseUnusedRecordPathArgs {
  recordsDirectory: string;
  slugRandomSource?: SlugRandomSource;
}

const MAX_SLUG_RETRIES = 32;

async function chooseUnusedRecordPath(
  args: ChooseUnusedRecordPathArgs,
): Promise<string> {
  for (let attempt = 0; attempt < MAX_SLUG_RETRIES; attempt++) {
    const slug = generateSlug({ randomSource: args.slugRandomSource });
    const candidatePath = join(args.recordsDirectory, `${slug}.md`);
    try {
      await Deno.lstat(candidatePath);
    } catch (caughtError) {
      if (caughtError instanceof Deno.errors.NotFound) return candidatePath;
      throw caughtError;
    }
  }
  throw new DvError({
    code: "add-slug-exhausted",
    message: `could not find an unused slug after ${MAX_SLUG_RETRIES} attempts`,
    context: { attempts: MAX_SLUG_RETRIES },
  });
}

interface StageWithGitArgs {
  recordPath: string;
  repoRootPath: string;
}

async function stageWithGit(args: StageWithGitArgs): Promise<boolean> {
  const gitAddResult = await new Deno.Command("git", {
    args: ["add", args.recordPath],
    cwd: args.repoRootPath,
    stdout: "piped",
    stderr: "piped",
  }).output();
  return gitAddResult.success;
}

export const ADD_TYPE_CHOICES: ReadonlyArray<ChangeType> = CHANGE_TYPES;
