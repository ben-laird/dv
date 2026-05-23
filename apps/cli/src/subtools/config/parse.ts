import { dirname, isAbsolute, resolve } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import type { z } from "zod";
import type { Config } from "../../domain/config.ts";
import { DvError } from "../../domain/errors.ts";
import { defaults } from "./defaults.ts";
import { CONFIG_DIR } from "./locations.ts";
import { type ParsedConfigLayer, parsedConfigLayerSchema } from "./schema.ts";

// Loads `.dv/config.yaml` (or any path), follows the extends chain,
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
    throw new DvError({
      code: "extends-cycle",
      message: `extends chain has a cycle through ${configFilePath}`,
      hint: "remove the circular `extends:` entry; v1 supports local paths only",
      context: { configFilePath },
    });
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
      throw new DvError({
        code: "config-not-found",
        message: `config not found: ${configFilePath}`,
        hint: `run \`dv init\` to scaffold ${CONFIG_DIR}/config.yaml`,
        context: { configFilePath },
      });
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
    throw new DvError({
      code: "config-parse",
      message: `failed to parse ${configFilePath}: ${yamlMessage}`,
      context: { configFilePath },
      cause: caughtError,
    });
  }
  if (parsedYaml === null || parsedYaml === undefined) {
    return {} as ParsedConfigLayer;
  }

  // Preflight: detect the pre-1.0 string form of `use:` /
  // `publishing.plugin:` / `overrides[].plugin-use:` before Zod
  // rejects it as a shape error. Targeted error has a clear hint
  // pointing at the `dv migrate config` command, where the generic
  // shape error would just say "expected object."
  const legacyUseShape = detectLegacyUseShape(parsedYaml);
  if (legacyUseShape !== undefined) {
    throw new DvError({
      code: "config-legacy-use-shape",
      message: `${configFilePath}: \`${legacyUseShape.path}\` is a string ('${legacyUseShape.value}'); the pre-1.0 form was removed in favor of a tagged reference (path/builtin/command)`,
      hint: "run `dv migrate config` to rewrite the file in place",
      context: { configFilePath, legacyValue: legacyUseShape.value },
    });
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

interface LegacyUseShapeDetection {
  // Dotted breadcrumb for the location, e.g.
  //   "discovery.plugins[0].use"
  //   "publishing.plugin"
  //   "overrides[2].plugin-use"
  path: string;
  // The legacy string value the user wrote.
  value: string;
}

// Walks the parsed YAML looking for the three places the pre-1.0 form
// could appear as a bare string. Returns the first one found so the
// error message names a specific location.
function detectLegacyUseShape(
  parsedYaml: unknown,
): LegacyUseShapeDetection | undefined {
  if (typeof parsedYaml !== "object" || parsedYaml === null) return undefined;
  const root = parsedYaml as Record<string, unknown>;

  // discovery.plugins[].use
  const discovery = root.discovery;
  if (typeof discovery === "object" && discovery !== null) {
    const plugins = (discovery as Record<string, unknown>).plugins;
    if (Array.isArray(plugins)) {
      for (let index = 0; index < plugins.length; index++) {
        const assignment = plugins[index];
        if (typeof assignment !== "object" || assignment === null) continue;
        const useValue = (assignment as Record<string, unknown>).use;
        if (typeof useValue === "string") {
          return { path: `discovery.plugins[${index}].use`, value: useValue };
        }
      }
    }
  }

  // publishing.plugin
  const publishing = root.publishing;
  if (typeof publishing === "object" && publishing !== null) {
    const pluginValue = (publishing as Record<string, unknown>).plugin;
    if (typeof pluginValue === "string") {
      return { path: "publishing.plugin", value: pluginValue };
    }
  }

  // overrides[].plugin-use
  const overrides = root.overrides;
  if (Array.isArray(overrides)) {
    for (let index = 0; index < overrides.length; index++) {
      const entry = overrides[index];
      if (typeof entry !== "object" || entry === null) continue;
      const pluginUseValue = (entry as Record<string, unknown>)["plugin-use"];
      if (typeof pluginUseValue === "string") {
        return {
          path: `overrides[${index}].plugin-use`,
          value: pluginUseValue,
        };
      }
    }
  }

  return undefined;
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

function configErrorFromZod(args: ConfigErrorFromZodArgs): DvError {
  const firstIssue = args.issues[0];
  if (!firstIssue) {
    return new DvError({
      code: "config-shape",
      message: `${args.configFilePath}: invalid`,
      context: { configFilePath: args.configFilePath },
    });
  }
  const pathSegmentDescription =
    firstIssue.path.length > 0 ? firstIssue.path.join(".") : "<root>";
  const unrecognizedDetail =
    firstIssue.code === "unrecognized_keys"
      ? ` (keys: ${firstIssue.keys.join(", ")})`
      : "";
  const message = `${args.configFilePath} @ ${pathSegmentDescription}: ${firstIssue.message}${unrecognizedDetail}`;
  if (firstIssue.code === "unrecognized_keys") {
    return new DvError({
      code: "config-unknown-key",
      message,
      hint: "check the config schema at specs/schemas/config.json",
      context: { configFilePath: args.configFilePath },
    });
  }
  return new DvError({
    code: "config-shape",
    message,
    context: { configFilePath: args.configFilePath },
  });
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
  if (layer.history) {
    if (layer.history.enabled !== undefined) {
      mergedConfig.history.enabled = layer.history.enabled;
    }
    if (layer.history.location !== undefined) {
      mergedConfig.history.location = layer.history.location;
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
      history: entry.history,
      tagging: entry.tagging,
      publishing: entry.publishing,
      pluginUse: entry.pluginUse,
    }));
  }
}
