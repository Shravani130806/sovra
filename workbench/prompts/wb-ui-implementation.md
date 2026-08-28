# Prompt: Complete the Sovereign AI Workbench UI (`@mrpl/dsh-workbench-ui`)

You are the **Lead Frontend & Client Systems Engineer** building `@mrpl/dsh-workbench-ui` (located at `workbench/packages/wb-ui/`), the primary end-user GUI plugin for the **Sovereign AI Workbench** inside DeepSeek Harness.

Eleven other backend plugins (`wb-identity`, `wb-policy`, `wb-audit`, `wb-model-gateway`, `wb-tool-gateway`, `wb-vision`, `wb-ingestion`, `wb-rag`, `wb-artifacts`, `wb-admin-console`, `wb-presets`) have already been built, verified against `DESIGN.md`, and passed the 82+ system invariant and contract tests.

Your specific role is to turn `wb-ui` from a prototype mockup into a **fully functional, production-ready frontend** that wires the user interface directly to the DeepSeek Harness client session runtime and workbench services.

---

## 1. Required Reading & Architecture Context

Before modifying or creating any code, you MUST review:
1. **`workbench/DESIGN.md`**:
   - **§3**: The core UI screen specification (Chat, Sources, Agents, Activity, Security, Artifacts).
   - **§6.10**: Contract card for `wb-ui` (Leaf client plugin, consumes session stream + read-only audit/policy).
   - **§6.11**: `wb-admin-console` architecture for reference.
   - **§7**: Frozen shared contracts and types (`WbCitation`, `WbRagResult`, `WbPolicyDecision`, `WbAuditEntry`, `WbUser`, `WbIngestFile`).
   - **§9**: System invariants (Invariant 1: central policy check, Invariant 4: observable decisions, Invariant 6: no silent downgrade).
   - **§10**: Demonstration scenarios (Scenario 2: Inspection report → approval note generation).
2. **`workbench/AGENTS.md`**:
   - **§5**: Client (UI) plugin rules.
   - **§6**: Frozen shared contracts rule — do NOT edit `workbench/packages/wb-types/src/index.ts`.
   - **§8**: Pre-push checks & quality gates.
3. **`packages/client/AGENTS.md`** (Repo Client Architecture):
   - Slot composition model: UI plugins compose only through `ctx.slots.register()`.
   - Four derived props shares: `PropsRuntime`, `PropsRenderSlots`, `PropsStore`, and `inject`.
   - **Strict Red Lines**: Zero `ctx` inside React components (components receive data/callbacks only via props shares; no manual `useSyncExternalStore` or unmanaged subscriptions).
4. **Existing Prompts & Integration State**:
   - `workbench/prompts/wb-ui.md` & `workbench/prompts/wb-admin-console.md`.
   - `workbench/INTEGRATION_LOG.md`.

---

## 2. Current State & Known Deficiencies to Fix

An exhaustive audit of `workbench/packages/wb-ui/` shows that while layout slots and the security indicator are implemented, almost all workspace features are currently **disconnected static mocks**:

| Component / Subsystem | Current State & Problem | Target Functional Requirement |
|---|---|---|
| **Security Indicator** (`SecurityIndicator.tsx`, `policy-store.ts`) | ✅ Functional with 17 unit tests. Maps 5 `WbDecisionKind` states and preserves one-way sovereignty flipping. | Preserve existing implementation; ensure it hooks into live session turns. |
| **Chat Composer** (`ChatComposer.tsx`) | ❌ **Bare Mock**: `<textarea>` has no `value`, `onChange`, `onSubmit`, or `onKeyDown`. Send button does nothing. | Controlled input, Enter/Shift+Enter handling, prompt dispatch via harness session (`session.sendUserPrompt` / `props.actions.submitPrompt`), loading state, and abort trigger. |
| **Conversation View & History** (`ConversationRoot.tsx`, `MessageList.tsx`) | ❌ **Placeholder**: `ConversationRoot` only renders `ChatHomeView` with a `{/* messages go here */}` comment; `MessageList` has hardcoded dummy text. | Bind to harness session streaming hooks (`useSession()`). Render live message turns: user bubbles, assistant streaming chunks (`assistant/chunk`), and tool execution cards showing policy approval status. |
| **Agent Presets** (`ChatHomeView.tsx`) | 🟡 **UI-Only**: Clicking preset cards only sets local React state; prompt starter pills do not dispatch. | Connect preset selection to harness session config/persona switching (`Document Analyst`, `Engineering Vision Specialist`, `Artifact Generator`, `Code Analyst`). Clicking starter cards pre-fills and sends prompts. |
| **RAG Sources & Citations** (`SourcesView.tsx`) | ❌ **Static Mock**: Pulls 3 hardcoded citations from `src/client/mock/useMockCitations()`. | Extract live `WbCitation` objects from turn metadata / `wb-rag` outputs. Render title, page, section, and classification badge (`PUBLIC`, `INTERNAL`, etc.) with clickable document links. |
| **Generated Artifacts** (`ArtifactView.tsx`) | ❌ **Static Mock**: Pulls static `Inspection_Summary.docx` from `src/client/mock/useMockArtifacts()`. Buttons do nothing. | Capture tool outputs from `wb_generate_report`, `wb_generate_approval_note`, `wb_generate_spreadsheet`, `wb_generate_presentation`. Render real file metadata, cryptographic provenance, and working download/preview triggers. |
| **Activity Stream** (`ActivityView.tsx`, `DetailsRoot.tsx`) | ❌ **Static Mock**: Pulls 3 fake strings from `src/client/mock/useSovereignActivity()`. | Query `ctx.wbAudit.query({ sessionId })` on session events or polling interval. Render chronological log entries for policy decisions, tool results, and ingestion events. |
| **Knowledge Repository** (`DocumentsView.tsx`, `DocumentViewer.tsx`) | ❌ **Static Mock**: Hardcoded 3-row HTML table; upload button has no handler; viewer shows dummy text. | Add real file upload handler calling `ctx.wbIngestion.enqueue()`. Show live indexing progress, auto-classification band, and display parsed text/OCR content in `DocumentViewer`. |
| **Engineering Vision Studio** (`EngineeringVisionView.tsx`) | ❌ **Static SVG Mock**: Renders hardcoded P&ID diagram (P-101, V-204) with static boxes. | Allow image upload (`.png`, `.jpg`). Add query input ("Locate safety valve V-204") triggering `wb_vision_analyze` / `wb_ocr_extract`. Render dynamic SVG bounding boxes `[x, y, w, h]` with confidence tooltips over the image. |
| **Mock Directory** (`src/client/mock/`) | ⚠️ Contains `index.ts`, `navigation.ts`, `data.ts` holding obsolete mock data. | Remove or refactor mock layers in favor of real runtime models and stores. |
| **Testing Coverage** | ⚠️ Only 1 test file exists (`security-indicator.spec.ts`). No component DOM tests. | Add comprehensive Vitest / `@testing-library/react` tests for all components and interaction paths. |

---

## 3. Implementation Tasks

You must execute the following tasks systematically:

### Task 1: Clean Up Mocks & Set Up Stores
1. Create dedicated client stores or observable models for:
   - Active session state, message turns, streaming deltas.
   - Citations and grounded sources per turn.
   - Generated artifacts and file references.
   - Ingestion queue and corpus document metadata.
   - Engineering vision interactive canvas state.
2. Remove dependencies on `src/client/mock/index.ts` and `src/client/mock/data.ts`.

### Task 2: Implement Real Chat & Streaming Execution Loop
1. **`ChatComposer.tsx`**:
   - Implement controlled multiline text input with auto-expanding height.
   - Support `Enter` to submit prompt, `Shift+Enter` for newline.
   - Add clear disabled / busy state when an agent turn is generating.
   - Implement Stop / Abort button bound to the active turn signal.
2. **`MessageList.tsx` & Message Turn Nodes**:
   - Render user message turns with timestamp and principal badge.
   - Render streaming assistant text with markdown formatting and inline citation tokens `[1]`.
   - Render tool execution cards:
     - Tool name, parameters preview, policy gate decision badge (`ALLOW` / `REQUIRE_APPROVAL` / `DENY`).
     - Tool execution result expandable drawer.
3. **`ChatHomeView.tsx`**:
   - Wire preset selection cards to update the active session persona.
   - Wire starter prompts to immediately submit into the active chat session.

### Task 3: Implement Live RAG Grounding & Sources Panel
1. **`SourcesView.tsx`**:
   - Parse `WbCitation` objects from the current session's tool outputs and `wb/rag/retrieved` events.
   - Display card list of citations: Document Name, Page, Section, Excerpt, Classification level.
   - Implement click handler to select and highlight the corresponding source document in `DocumentViewer`.

### Task 4: Implement Generated Artifacts Delivery
1. **`ArtifactView.tsx`**:
   - Parse tool outputs from `wb_generate_report`, `wb_generate_approval_note`, `wb_generate_spreadsheet`, `wb_generate_presentation`.
   - Render artifact cards with file extension icons (`.docx`, `.xlsx`, `.pptx`), file size, generation timestamp, and provenance breakdown (sources cited, generating tool, authoring agent).
   - Implement download action and inline text/table preview.

### Task 5: Implement Live Activity & Audit Stream
1. **`ActivityView.tsx` & `DetailsRoot.tsx`**:
   - Integrate with `ctx.wbAudit.query({ sessionId })` (either pushed via session updates or polled via 4s interval similar to `wb-admin-console`).
   - Render chronological event timeline with icons for `policy_decision`, `tool_result`, `rag_retrieval`, and `ingestion_completed`.
   - Highlight `DENY` policy entries in red with their blocking reason.

### Task 6: Implement Document Repository & Ingestion Pipeline
1. **`DocumentsView.tsx`**:
   - Implement file input / dropzone accepting `.pdf`, `.png`, `.jpg`, `.docx`, `.xlsx`, `.txt`, `.md`.
   - Add classification picker (`PUBLIC`, `INTERNAL`, `CONFIDENTIAL`, `RESTRICTED`) defaulting to `INTERNAL`.
   - Dispatch upload to `ctx.wbIngestion.enqueue()`.
   - Display ingestion progress bar, assigned `WbDocumentId`, and final classification (confirming auto-classification did not downgrade).
2. **`DocumentViewer.tsx`**:
   - Render the parsed content, section headers, and metadata of the selected document.

### Task 7: Implement Engineering Vision Studio
1. **`EngineeringVisionView.tsx`**:
   - Provide image dropzone for P&IDs, blueprints, and scanned schematics.
   - Provide query input (e.g. *"Inspect pump P-101 and check valve V-204"*).
   - Trigger `wb_vision_analyze` / `wb_ocr_extract` via tool dispatch.
   - Overlay responsive SVG bounding boxes dynamically calculated from `findings[].box` (`[x, y, w, h]`).
   - Show interactive finding cards on hover with confidence scores and detection labels.

### Task 8: Quality Gates & Testing
1. **Zero TypeScript Errors**: Run `pnpm --filter @mrpl/dsh-workbench-ui typecheck` and ensure clean compilation with zero `any` leaks.
2. **Unit & Component Testing**:
   - Create tests in `workbench/packages/wb-ui/tests/` covering:
     - `chat-composer.spec.ts`: Input handling, Enter key submission, disabled/generating state.
     - `message-list.spec.ts`: Turn rendering, assistant delta accumulation, tool cards.
     - `sources-view.spec.ts`: Citation formatting and classification badge display.
     - `artifact-view.spec.ts`: Artifact metadata and provenance display.
     - `documents-view.spec.ts`: File upload queue and ingestion status.
     - `security-indicator.spec.ts`: Retain all 17 existing policy transition tests.
3. **Workspace Integration**: Run root test suite `pnpm test` and verify that all package tests (223+) and integration tests (31+) pass.

---

## 4. Red Lines & Invariants
- **NEVER** edit `workbench/packages/wb-types/src/index.ts` directly.
- **NEVER** violate `packages/client/AGENTS.md` rules: React components must NOT access `ctx` directly; state and actions must flow through the 4 derived props shares and declared store handles.
- **NEVER** create raw network calls (`fetch`, `XMLHttpRequest`) from the UI — all data access must route through harness RPC, session streams, or declared backend services.
- **NEVER** compromise the Security Indicator: the persistent sovereignty badge must remain active, reactive to `wb/policy/decision`, and faithful to the one-way external transition invariant.
