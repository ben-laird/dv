---
type: fix
packages:
  - '@dv-cli/dv'
---

dv release's human summary now counts only real publishes. A release op that answers published: false (for example a package marked "publish": false) shows as "N not published" instead of being counted as published, and one that answers skipped: true (already published) shows as "N skipped".
