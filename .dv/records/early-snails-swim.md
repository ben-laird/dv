---
type: feat
packages:
  - '@dv-cli/dv'
---

dv migrate config now moves the config schema pointers (the `# yaml-language-server` modeline and the `$schema` key) forward to the running dv release when they name an older one, and leaves any other URL alone.
