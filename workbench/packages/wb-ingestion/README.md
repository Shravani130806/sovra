# wb-ingestion

Document ingestion pipeline for the Sovereign AI Workbench: upload → validate → classify → parse/OCR → chunk → embed → index.

## Service API

### `ctx.wbIngestion.enqueue(file): Promise<WbDocumentId>`

Accepts a file for ingestion. Validates file type/size, assigns a document ID, parses content (text direct, images via OCR), chunks text, generates embeddings, and writes chunks to the shared JSONL vector index.

**Parameters:**
- `file.path` — absolute path to the file on disk
- `file.declaredClassification` — the user's declared classification level (`'PUBLIC'` | `'INTERNAL'` | `'CONFIDENTIAL'` | `'RESTRICTED'`)

**Returns:** `WbDocumentId` — a branded unique identifier for the ingested document.

**Throws:** `Error` with descriptive message for validation failures (file not found, empty, over size limit, disallowed MIME type, unparsable format).

## Configuration

```ts
interface IngestionConfig {
  /** Maximum file size in bytes. Default: 52428800 (50MB). */
  maxFileSize: number
  /** Allowed MIME types (glob patterns supported). Default: ['text/*', 'application/pdf', 'image/*']. */
  allowedMimeTypes: string[]
  /** Path to the shared JSONL vector index (read by wb-rag). Default: '$DSH_HOME/workbench/vector-index'. */
  indexPath: string
  /** Chunk size in characters for text splitting. Default: 1000. */
  chunkSize: number
  /** Overlap between consecutive chunks in characters. Default: 200. */
  chunkOverlap: number
}
```

All fields are validated via Schemastery and fail loud at boot on invalid values. `$DSH_HOME` is expanded at apply time.

## Events

### `wb/ingestion/completed`

Emitted after a document is successfully ingested.

```ts
interface WbIngestionCompletedEvent {
  documentId: WbDocumentId
  classification: WbClassification
}
```

Consumed by `wb-audit` for provenance logging.

## Index Storage Format

Chunks are written as JSONL (one JSON object per line) to `config.indexPath`. Each line contains:

```ts
interface IndexChunk {
  text: string
  documentId: WbDocumentId
  title: string
  page?: number
  section?: string
  classification: WbClassification
  embedding: number[]
}
```

**Concurrency:** Each append uses `fs.appendFileSync` with `O_APPEND`, which is atomic under `PIPE_BUF` (4096 bytes on Linux) — same pattern as `wb-audit/src/index.ts:139-144`. Individual chunk lines are well under this limit.

**`wb-rag` integration:** `wb-rag` reads this JSONL file directly. Both plugins must agree on the `IndexChunk` shape. The format is defined here (built first) and documented in this README.

## Classification Handling

**Rule (DESIGN.md §9 invariant 6): classification is never silently downgraded.**

- The `declaredClassification` from the upload is the minimum stored classification.
- Any auto-classification heuristic (if implemented) can only *raise* the level for human confirmation.
- The current prototype does not implement auto-classification — the stored classification always equals exactly the declared one.

## Text Parsing

- **Text files:** Read directly as UTF-8. Binary content detection via `application/octet-stream` MIME rejection.
- **Image/PDF files:** Parsed via `ctx.wbVision.describe()` for OCR before chunking.
- **Unparsable formats:** Files with MIME types like `application/octet-stream` are rejected with a clear error.

## Dependencies Consumed

| `ctx` key | Source | Purpose |
|-----------|--------|---------|
| `ctx.wbVision` | `wb-vision` (sibling) | OCR for image/PDF files |
| `ctx.wbModelGateway` | `wb-model-gateway` (sibling) | Embedding capability resolution |
| `ctx.wbPolicy` | `wb-policy` (sibling) | Currently not called (see Deviations) |

## Deviations

1. **`ctx.wbPolicy` not called during ingestion.** DESIGN.md §6 lists `wb-policy` as a dependency of `wb-ingestion`, but §7.2 `WbPolicyRequest.action` has no variant that maps to "ingest/upload document" (`send_data` implies egress, not local ingestion). This is a contract ambiguity flagged in DESIGN.md §12. The service is injected for forward-compatibility but not called until the action gap is resolved.

2. **Auto-classification not implemented.** The prototype stores exactly the declared classification. Auto-classification heuristics (e.g., detecting P&ID-like drawings to suggest `CONFIDENTIAL`) are deferred to a future iteration. The downgrade-prevention invariant is still validated by tests.
