---
type: fix
packages:
  - '@seshat/cli'
notes: >-
  The continuation line under sub-routers now uses `↳ name1  name2` with the arrow + names bolded
  when color is on. The previous comma-separated dimmed line was indistinguishable from description
  text; now the line reads as a real list of subcommands.
---

Make sub-router children visually distinct in help
