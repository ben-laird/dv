// Public surface of the publishing Subtool: invokes the `release`
// plugin Op for each Package whose tag was just minted. Phase two
// of the release pipeline (specs/design.md § Capability decomposition;
// specs/cli.md § dv release).

export {
  type InvokeGetDependenciesArgs,
  type InvokeGetDependenciesResult,
  invokeGetDependencies,
} from "./get-dependencies.ts";
export {
  type InvokeReleaseArgs,
  invokeRelease,
} from "./release.ts";
