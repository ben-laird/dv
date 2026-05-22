import type { Config } from "../domain/config.ts";
import type { Package } from "../domain/package.ts";
import { configPath, loadConfig } from "../subtools/config/mod.ts";
import { discoverPackages } from "../subtools/discovery/mod.ts";
import { requireRepoRoot } from "../subtools/git/repo-root.ts";
import { type Plan, renderPlanJson } from "./plan.ts";

// `dv status` is a read-only preview of `dv version` and shares its Plan
// schema (specs/cli.md). In milestone 1 the pipeline below discovery is not
// implemented yet, so the Plan's pending and awaitingRelease arrays are
// always empty; the human output additionally lists discovered Packages —
// the only signal Milestone 1 can offer.

export interface RunStatusOptions {
  emitJson: boolean;
  colorEnabled: boolean;
}

export interface RunStatusResult {
  discoveredPackages: Package[];
  configMissing: boolean;
}

export async function runStatus(
  options: RunStatusOptions,
): Promise<RunStatusResult> {
  const repoRootPath = await requireRepoRoot();
  const configFilePath = configPath(repoRootPath);

  let loadedConfig: Config | null = null;
  try {
    loadedConfig = await loadConfig(configFilePath);
  } catch (caughtError) {
    if (isConfigNotFound(caughtError)) {
      loadedConfig = null;
    } else {
      throw caughtError;
    }
  }

  const discoveredPackages = loadedConfig
    ? await discoverPackages({ config: loadedConfig, repoRootPath })
    : [];

  if (options.emitJson) {
    const plan: Plan = {
      schema: "urn:dv:schema:v1:plan",
      command: "status",
      pending: [],
      awaitingRelease: [],
    };
    console.log(renderPlanJson({ plan, discoveredPackages }));
  } else {
    renderHumanStatus({
      discoveredPackages,
      configMissing: loadedConfig === null,
      colorEnabled: options.colorEnabled,
    });
  }

  return {
    discoveredPackages,
    configMissing: loadedConfig === null,
  };
}

function isConfigNotFound(caughtError: unknown): boolean {
  if (caughtError instanceof Deno.errors.NotFound) return true;
  if (
    caughtError instanceof Error &&
    "code" in caughtError &&
    (caughtError as { code: unknown }).code === "config-not-found"
  ) {
    return true;
  }
  return false;
}

interface RenderHumanStatusArgs {
  discoveredPackages: Package[];
  configMissing: boolean;
  colorEnabled: boolean;
}

function renderHumanStatus(args: RenderHumanStatusArgs): void {
  const { discoveredPackages, configMissing, colorEnabled } = args;
  const styler = makeStyler(colorEnabled);

  if (configMissing) {
    console.log(
      `${styler.dim("no config found")} — run ${styler.cyan(
        "`dv init`",
      )} to scaffold .changelog/config.yaml`,
    );
    return;
  }
  if (discoveredPackages.length === 0) {
    console.log(styler.dim("no packages tracked"));
    console.log(
      `  configure ${styler.cyan("discovery.plugins")} in ${styler.cyan(
        ".changelog/config.yaml",
      )} to add some.`,
    );
    return;
  }
  console.log(
    `${styler.bold("Packages")} — ${discoveredPackages.length} discovered:`,
  );
  const packageNameColumnWidth = Math.max(
    ...discoveredPackages.map((p) => p.name.length),
    7,
  );
  for (const discoveredPackage of discoveredPackages) {
    const paddedName = discoveredPackage.name.padEnd(packageNameColumnWidth);
    console.log(
      `  ${styler.bold(paddedName)}  ${discoveredPackage.path}  ${styler.dim(
        `(plugin: ${discoveredPackage.plugin})`,
      )}`,
    );
  }
}

interface Styler {
  bold(text: string): string;
  dim(text: string): string;
  cyan(text: string): string;
}

function makeStyler(colorEnabled: boolean): Styler {
  if (!colorEnabled) {
    return {
      bold: (text) => text,
      dim: (text) => text,
      cyan: (text) => text,
    };
  }
  return {
    bold: (text) => `\x1b[1m${text}\x1b[22m`,
    dim: (text) => `\x1b[2m${text}\x1b[22m`,
    cyan: (text) => `\x1b[36m${text}\x1b[39m`,
  };
}
