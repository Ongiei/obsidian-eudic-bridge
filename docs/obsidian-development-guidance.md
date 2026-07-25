# Obsidian development guidance

Last checked: 2026-07-15

## Authority order

1. Current Obsidian Developer Docs, Developer Policies, Plugin Guidelines, and Submission Requirements.
2. Actual results from the repository's installed `eslint-plugin-obsidianmd` and the current Community scanner.
3. The official `obsidianmd/obsidian-sample-plugin` `AGENTS.md` baseline.
4. Third-party skills and checklists, including `gapmiss/obsidian-plugin-skill`.

If these sources conflict, follow the higher source. A third-party skill must never justify disabling an official rule or ignoring a scanner finding.

## Verified sources

| Source | Verified revision | Role |
| --- | --- | --- |
| `obsidianmd/obsidian-sample-plugin/AGENTS.md` | `23c165fd362d4049330cb3edad6a52914ff2007a` | Official repository baseline synced into the root `AGENTS.md`. |
| `eslint-plugin-obsidianmd` | `0.4.1`, tag commit `867ce74ed8b409269a56d293886549afbc4ca783` | Executable lint authority. The project pins this version and runs its recommended configuration. |
| `gapmiss/obsidian-plugin-skill` | `9b016a2c0914ba44eba683da5b65cf08b0a4a4aa`, skill `1.10.0` | Optional knowledge supplement installed locally as `obsidian`. |

The third-party skill was last verified against `eslint-plugin-obsidianmd` `0.4.0`. Version `0.4.1` was released afterward and fixes `prefer-create-el` handling and autofix safety. The skill is therefore close to, but not exactly synchronized with, the current official lint package.

## Why the third-party skill is useful

- It groups lifecycle cleanup, Vault APIs, popout-window compatibility, CSS, accessibility, mobile behavior, and submission checks into focused references.
- It provides review prompts that are broader than a single lint run.
- Its progressive reference files are useful during implementation without making the root project instructions excessively long.

Its boilerplate generator, Scorecard descriptions, severity tables, and version-specific scanner claims are not canonical. Do not copy generated files over an existing project without reviewing every diff.

## Refresh procedure

Before adopting version-specific guidance or preparing a Community submission:

1. Read the current official Developer Docs and submission requirements.
2. Compare the root `AGENTS.md` with the official sample plugin version.
3. Check the currently published `eslint-plugin-obsidianmd` version and update the project dependency deliberately.
4. Compare the third-party skill's metadata and scanner version stamp with the official package.
5. Run `npm ci`, `npm test`, `npm run lint`, and `npm run check:community`.
6. Treat the Community scanner's result as the final submission check and fix both errors and relevant warnings.

Reinstalling or updating the third-party skill may overwrite its local authority notice. Reapply that notice and update this provenance record after every third-party skill update.
