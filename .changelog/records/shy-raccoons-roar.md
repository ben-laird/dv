---
type: feat
packages:
  - '@seshat/dv'
---

Implement M1: `dv init`, config parsing, discovery, and `dv status` scaffolding

Scaffolds the v1 implementation per specs/v1-scope.md § M1:

- `dv init` writes `.changelog/config.yaml` and creates `.changelog/records/`.
- Config loader uses Zod with the pure-shape / parser-shape split: a
  `rawConfigLayerSchema` (no transforms, fed to `z.toJSONSchema()`) and a
  parser-shaped schema piped through a kebab→camel transform for runtime.
- Discovery subtool runs configured discover plugins via JSON-over-stdio,
  matches packages against glob `match` rules, and reports first-claim wins.
- `dv status` is a read-only preview — the same plan-building code path that
  `dv version` will later execute, gated to print-only.
- Tooling: Biome 2.4.15 owns formatting; `deno lint` runs alongside for
  Deno-specific rules. JSON Schemas under `specs/schemas/` are generated from
  the Zod source; `deno task schemas:check` is the drift gate.
- Engineering grain captured in CONVENTIONS.md (test naming, Given/When/Then,
  function-param objects, descriptive variable names).
