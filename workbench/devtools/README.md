# Workbench devtools

A probe UI over the **composed workbench with nothing faked**. Every boundary
is the production implementation: `wb-ollama` against a local Ollama,
`wb-model-gateway` routing capabilities to it, the harness's own
`LocalAttachmentStore` for image bytes, and the real `ToolRuntime`.

```bash
pnpm dev:workbench-ui     # http://localhost:4173
```

## Requires Ollama

```bash
ollama serve
ollama pull qwen2.5vl          # vision + OCR
ollama pull nomic-embed-text   # embeddings
```

Without it the page still loads and the manifest panels work — a tool call
returns `vision model produced no output. Is the model server running and the
model pulled?` rather than a misleading parse error.

| Variable | Default | Purpose |
|---|---|---|
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Model host. Must be loopback or RFC 1918 — the on-premise guard refuses anything else at load. |
| `WB_VISION_MODEL` | `qwen2.5vl` | Model backing `wb_ocr_extract` and `wb_vision_analyze`. |
| `WB_EMBEDDING_MODEL` | `nomic-embed-text` | Model backing `ctx.wbEmbeddings`. |
| `DSH_HOME` | `~/.dsh` | Where the attachment store writes image bytes. |
| `PORT` | `4173` | HTTP port. |

## Endpoints

- `GET /api/manifests` — every manifest `wb-policy` can see, from the live
  `wb-tool-gateway`.
- `GET /api/manifest?toolId=` — the lookup `wb-policy` performs per call.
- `POST /api/tool` — run a real tool call. Body: `{name, arguments}`.

```bash
curl -X POST localhost:4173/api/tool -H 'content-type: application/json' -d '{
  "name": "wb_vision_analyze",
  "arguments": {"image": "<base64>", "mediaType": "image/png", "question": "What do you see?"}
}'
```

Note the parameter names are `image`, `mediaType` and `question` — the frozen
schema in DESIGN.md §7.5, not `encodedImage`/`prompt`.

## Mount order matters

`LlmRuntime` → `LocalAttachmentStore` → `wb-ollama` → `wb-model-gateway` →
`wb-vision`. Cordis `inject` is required-only, so a plugin whose dependency is
missing does not fail — it silently never applies, and its tools never
register. `wb-model-gateway` in particular validates its routing against the
adapters actually registered, so the adapter must mount first.
