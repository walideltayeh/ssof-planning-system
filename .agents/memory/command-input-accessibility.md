---
name: Command input accessible names
description: Generated command-input labels can override input-level aria-labels; keep role-based tests.
---
For searchable command-based pickers, set the command primitive's root-level label and verify the search input by its accessible combobox role and name.

**Why:** cmdk generates an `aria-labelledby` reference which takes precedence over an input's `aria-label`. An apparently labelled input can therefore have an empty accessible name. Switching tests to placeholders would hide the accessibility defect.

**How to apply:** When adding or changing a command-based picker, check generated accessible names and keyboard focus rather than relying only on visible placeholder text. JSDOM needs a local scrollIntoView stub to exercise cmdk; do not alter production scrolling to satisfy that test environment.
