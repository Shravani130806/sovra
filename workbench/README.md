# Sovereign AI Workbench (MRPL — SIH 2026, PS #26117)

This directory holds the MRPL Sovereign On-Premise Agentic AI Workbench,
built as a set of Cordis plugins on top of the DeepSeek Harness runtime in
this repository.

- **Start here:** [`DESIGN.md`](./DESIGN.md) — the frozen architecture and
  cross-plugin contract. Read this before writing or reviewing any code here.
- **Building a plugin?** [`AGENTS.md`](./AGENTS.md) — step-by-step
  instructions, written so a single agent can build one plugin correctly
  having read only a task prompt plus these two files.
- `packages/` — one npm workspace package per plugin (`wb-types` is the
  frozen shared contract; do not edit it outside the `DESIGN.md` §12 process).
- `cordis/workbench.cordis.yml` — the bundle that stacks every `wb-*` plugin
  over the harness's own `dsh-base`.
- `cordis/presets/` — the five agent personas (Document Analyst, Engineering/
  Vision, Code & Analysis, Research, Artifact), each a plain `cordis.yml`
  composition, no new code.

Nothing in this directory modifies `packages/`, `apps/`, or any other
top-level directory of the harness itself — the workbench mounts beside the
harness's existing plugins, it does not fork them.
