---
type: feat
packages:
  - '@dv-cli/dv'
---

Publish dv's JSON Schemas with each release at `https://jsr.io/@dv-cli/dv/<version>/schemas/<name>.json`, and have dv init point the new config at the config schema for the running version (a yaml-language-server modeline plus a `$schema` key).
