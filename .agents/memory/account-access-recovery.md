---
name: Account access recovery
description: Recovery constraints for reversible account suspension
---

Account pauses are temporary access blocks, not account deletion or removal of country/role assignments. Keep owner accounts available to resume other users.

**Why:** Pausing must be reversible without rebuilding permissions. The existing user-management model permits only owners to manage accounts, so allowing owner suspension could strand paused users without an in-app recovery path.

**How to apply:** Maintain an accessible recovery account when extending account-status controls. Do not implement pause by clearing country assignments, changing roles, or deleting user history.
