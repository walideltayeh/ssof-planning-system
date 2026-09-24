---
name: GitHub history from shallow clones
description: How to recognize and handle an incomplete local Git history before pushing it to GitHub.
---

Before pushing a long local history to a new or mostly empty GitHub repository, check whether the workspace is shallow and whether every object reachable from the branch exists. If the shallow boundary's parent cannot be recovered from any backup, rebuild the available lineage with the boundary represented as a root, then merge the existing GitHub branch so the push remains a fast-forward.

**Why:** A shallow boundary commit still names an omitted parent. GitHub rejects the pack with “did not receive expected object,” including with a non-thin push. Replit backup and task-agent remotes may share the same missing boundary.

**How to apply:** Inspect `.git/shallow`, verify reachable objects before pushing, and first try to unshallow from backups. If recovery is impossible, get explicit approval because rebuilding preserves commit content, authors, dates, messages, and order but changes commit hashes. Verify the final tree is identical and the current remote head is an ancestor before pushing.