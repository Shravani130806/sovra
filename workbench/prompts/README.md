# Workbench build prompts

One prompt per plugin, each meant to be pasted whole into opencode's **plan**
agent (any LLM). The plan agent should read the referenced files, produce a
plan, and only then be allowed into build mode — do not skip the plan step,
since these plugins are only safe to parallelize if the plan genuinely commits
to the frozen contract before touching code.

## How to run these

1. Open a **separate** opencode session per plugin (these are meant to be
   built by independent agents that never see each other's work-in-progress).
2. Paste the corresponding prompt file's contents as the task.
3. Let the plan agent read `DESIGN.md`, `AGENTS.md`, and `wb-types` and
   produce a plan. Check the plan mentions: which `ctx.wb*` interfaces it
   fakes for tests, which exact frozen names it uses, and a test list before
   any implementation.
4. Only then move to build mode.
5. Run the verification commands yourself (or have the agent run them) before
   accepting: `pnpm run typecheck && pnpm run lint && pnpm run test && pnpm run build`.

## Suggested order (not required — every prompt is self-sufficient)

Every plugin fakes its dependencies for unit tests (see each prompt's "Faking
your dependencies" section), so these can genuinely run in any order or in
parallel. If you'd rather stage them for easier real (non-faked) integration
review as they land, this order minimizes the number of plugins any one
reviewer has to hold in their head at once:

1. `wb-identity`, `wb-audit`, `wb-model-gateway`, `wb-tool-gateway` — no
   workbench-plugin dependencies beyond `wb-types`.
2. `wb-policy` — depends on `wb-identity`'s contract (faked in its own tests).
3. `wb-vision` — depends on `wb-model-gateway`'s contract.
4. `wb-rag`, `wb-ingestion` — depend on `wb-policy`/`wb-vision` contracts.
5. `wb-artifacts` — depends on `wb-audit`'s contract.
6. `wb-ui`, `wb-admin-console` — depend on `wb-audit`/`wb-policy` read APIs.
7. `wb-presets` — depends on nothing but the frozen tool/ctx names; can
   genuinely run anytime, including first.

## Files in this directory

| File | Plugin |
|---|---|
| `wb-identity.md` | Identity & RBAC |
| `wb-policy.md` | Policy Gateway |
| `wb-audit.md` | Audit & Provenance |
| `wb-model-gateway.md` | Model Gateway |
| `wb-rag.md` | Enterprise RAG |
| `wb-vision.md` | Multimodal / Vision |
| `wb-tool-gateway.md` | Controlled Tool Execution |
| `wb-ingestion.md` | Document Ingestion |
| `wb-artifacts.md` | Artifact Generator |
| `wb-ui.md` | Secure Workbench UI |
| `wb-admin-console.md` | Admin & Policy Console |
| `wb-presets.md` | Agent preset compositions |

`wb-types` (the frozen shared contract) is not in this list — it already
exists at `workbench/packages/wb-types/`, written directly from `DESIGN.md`
§7. No agent should regenerate it; every prompt below tells its agent to
treat it as read-only and import from it.
