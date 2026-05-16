- The default branch in this repo is `dev`.
- Local `main` ref may not exist; use `dev` or `origin/dev` for diffs.
- Prefer automation: execute requested actions without confirmation unless blocked by missing info or safety/irreversibility.

## OpenPlay Transformation

- **MUST READ** `docs/openplay/PLAN.md` before making any changes to OpenPlay-related code (world detection, agent system, roleplay tools, prompt isolation, session schema, etc.).
- **MUST UPDATE** `docs/openplay/PROGRESS.md` after completing each task — mark items as `[x]` and add a changelog entry.
- When committing OpenPlay changes, include the phase/task identifier in the commit message (e.g. `feat(openplay): P0-1 add world detection service`).