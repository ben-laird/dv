import { dirname, isAbsolute, resolve } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import type { z } from "zod";
import type { Config } from "../../domain/config.ts";
import { ConfigError } from "../../domain/errors.ts";
import { defaults } from "./defaults.ts";
import { type ParsedConfigLayer, parsedConfigLayerSchema } from "./schema.ts";

// Loads `.changelog/config.yaml` (or any path), follows the extends chain,
// merges per-section, and applies defaults. Each layer is validated and
// kebab→camel transformed through `parsedConfigLayerSchema` from
// ./schema.ts; the merger only has to read the (already-camelCased) typed
// shape.
//
// Errors surface as ConfigError with a stable `code` so `--json` consumers
// can distinguish "config-not-found" from "config-shape" from
// "config-unknown-key", per specs/v1-scope.md § Automation surface.

export async function loadConfig(configFilePath: string): Promise<Config> {
  const absoluteConfigFilePath = isAbsolute(configFilePath)
    ? configFilePath
    : resolve(configFilePath);
  const layeredParsedConfigs = await loadExtendsChain({
    configFilePath: absoluteConfigFilePath,
    visitedPaths: new Set(),
  });
  return mergeIntoDefaults(layeredParsedConfigs);
}

interface LoadExtendsChainArgs {
  configFilePath: string;
  visitedPaths: Set<string>;
}

async function loadExtendsChain(
  args: LoadExtendsChainArgs,
): Promise<ParsedConfigLayer[]> {
  const { configFilePath, visitedPaths } = args;
  if (visitedPaths.has(configFilePath)) {
    throw new ConfigError(
      "extends-cycle",
      `extends chain has a cycle through ${configFilePath}`,
    );
  }
  visitedPaths.add(configFilePath);

  const rawText = await readFileOrConfigError(configFilePath);
  const parsedLayer = parseYamlAsLayer({ rawText, configFilePath });

  const layeredParsedConfigs: ParsedConfigLayer[] = [];
  for (const extendsRef of normalizeExtendsList(parsedLayer.extends)) {
    const resolvedExtendsPath = isAbsolute(extendsRef)
      ? extendsRef
      : resolve(dirname(configFilePath), extendsRef);
    layeredParsedConfigs.push(
      ...(await loadExtendsChain({
        configFilePath: resolvedExtendsPath,
        visitedPaths: new Set(visitedPaths),
      })),
    );
  }
  layeredParsedConfigs.push(parsedLayer);
  return layeredParsedConfigs;
}

async function readFileOrConfigError(configFilePath: string): Promise<string> {
  try {
    return await Deno.readTextFile(configFilePath);
  } catch (caughtError) {
    if (caughtError instanceof Deno.errors.NotFound) {
      throw new ConfigError(
        "config-not-found",
        `config not found: ${configFilePath}`,
      );
    }
    throw caughtError;
  }
}

interface ParseYamlAsLayerArgs {
  rawText: string;
  configFilePath: string;
}

function parseYamlAsLayer(args: ParseYamlAsLayerArgs): ParsedConfigLayer {
  const { rawText, configFilePath } = args;
  let parsedYaml: unknown;
  try {
    parsedYaml = parseYaml(rawText);
  } catch (caughtError) {
    const yamlMessage =
      caughtError instanceof Error ? caughtError.message : String(caughtError);
    throw new ConfigError(
      "config-parse",
      `failed to parse ${configFilePath}: ${yamlMessage}`,
    );
  }
  if (parsedYaml === null || parsedYaml === undefined) {
    return {} as ParsedConfigLayer;
  }

  const validationResult = parsedConfigLayerSchema.safeParse(parsedYaml);
  if (!validationResult.success) {
    throw configErrorFromZod({
      issues: validationResult.error.issues,
      configFilePath,
    });
  }
  return validationResult.data;
}

function normalizeExtendsList(
  extendsValue: ParsedConfigLayer["extends"],
): string[] {
  if (extendsValue === undefined) return [];
  return Array.isArray(extendsValue) ? extendsValue : [extendsValue];
}

interface ConfigErrorFromZodArgs {
  issues: z.core.$ZodIssue[];
  configFilePath: string;
}

function configErrorFromZod(args: ConfigErrorFromZodArgs): ConfigError {
  const firstIssue = args.issues[0];
  if (!firstIssue) {
    return new ConfigError("config-shape", `${args.configFilePath}: invalid`);
  }
  const pathSegmentDescription =
    firstIssue.path.length > 0 ? firstIssue.path.join(".") : "<root>";
  const issueCode =
    firstIssue.code === "unrecognized_keys"
      ? "config-unknown-key"
      : "config-shape";
  const unrecognizedDetail =
    firstIssue.code === "unrecognized_keys"
      ? ` (keys: ${firstIssue.keys.join(", ")})`
      : "";
  return new ConfigError(
    issueCode,
    `${args.configFilePath} @ ${pathSegmentDescription}: ${firstIssue.message}${unrecognizedDetail}`,
  );
}

function mergeIntoDefaults(layeredParsedConfigs: ParsedConfigLayer[]): Config {
  const mergedConfig = defaults();
  for (const layer of layeredParsedConfigs) {
    applyLayerOntoConfig({ layer, mergedConfig });
  }
  return mergedConfig;
}

interface ApplyLayerOntoConfigArgs {
  layer: ParsedConfigLayer;
  mergedConfig: Config;
}

function applyLayerOntoConfig(args: ApplyLayerOntoConfigArgs): void {
  const { layer, mergedConfig } = args;
  if (layer.discovery) {
    if (layer.discovery.plugins !== undefined) {
      mergedConfig.discovery.plugins = layer.discovery.plugins;
    }
    if (layer.discovery.useGitignore !== undefined) {
      mergedConfig.discovery.useGitignore = layer.discovery.useGitignore;
    }
  }
  if (layer.records) {
    if (layer.records.autoStage !== undefined) {
      mergedConfig.records.autoStage = layer.records.autoStage;
    }
  }
  if (layer.changelog) {
    if (layer.changelog.format !== undefined) {
      mergedConfig.changelog.format = layer.changelog.format;
    }
    if (layer.changelog.location !== undefined) {
      mergedConfig.changelog.location = layer.changelog.location;
    }
  }
  if (layer.tagging) {
    if (layer.tagging.format !== undefined) {
      mergedConfig.tagging.format = layer.tagging.format;
    }
  }
  if (layer.publishing) {
    if (layer.publishing.plugin !== undefined) {
      mergedConfig.publishing.plugin = layer.publishing.plugin;
    }
    if (layer.publishing.timeout !== undefined) {
      mergedConfig.publishing.timeout = layer.publishing.timeout;
    }
  }
  if (layer.git) {
    if (layer.git.requireCleanTree !== undefined) {
      mergedConfig.git.requireCleanTree = layer.git.requireCleanTree;
    }
    if (layer.git.sign !== undefined) {
      mergedConfig.git.sign = layer.git.sign;
    }
    if (layer.git.autoCommit !== undefined) {
      mergedConfig.git.autoCommit = layer.git.autoCommit;
    }
    if (layer.git.commitMessageTemplate !== undefined) {
      mergedConfig.git.commitMessageTemplate = layer.git.commitMessageTemplate;
    }
    if (layer.git.autoPush !== undefined) {
      mergedConfig.git.autoPush = layer.git.autoPush;
    }
    if (layer.git.pushSequence !== undefined) {
      mergedConfig.git.pushSequence = layer.git.pushSequence;
    }
  }
  if (layer.safety) {
    if (layer.safety.dryRunByDefault !== undefined) {
      mergedConfig.safety.dryRunByDefault = layer.safety.dryRunByDefault;
    }
  }
  if (layer.overrides !== undefined) {
    mergedConfig.overrides = layer.overrides.map((entry) => ({
      match: entry.match,
      changelog: entry.changelog,
      tagging: entry.tagging,
      publishing: entry.publishing,
      pluginUse: entry.pluginUse,
    }));
  }
}
