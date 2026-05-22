// Public surface of the plugin Subtool: invocation runner + per-Op
// response schemas. Every subtool that needs to talk to a plugin
// (discovery's `discover`, versioning's `read-version` / `write-version`,
// later publishing's `release`) flows through here.

export {
  type DiscoverResponse,
  discoverResponseSchema,
  parseDiscoverResponse,
  parsePluginResponse,
  parseReadVersionResponse,
  parseReleaseResponse,
  parseUpdateDependencyResponse,
  parseWriteVersionResponse,
  pluginErrorEnvelopeSchema,
  type ReadVersionResponse,
  type ReleaseResponse,
  readVersionResponseSchema,
  releaseResponseSchema,
  type UpdateDependencyResponse,
  updateDependencyResponseSchema,
  type WriteVersionResponse,
  writeVersionResponseSchema,
} from "./response.ts";
export { type InvokeOpArgs, type InvokeOpResult, invokeOp } from "./runner.ts";
