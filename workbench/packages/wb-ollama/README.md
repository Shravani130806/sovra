# `@mrpl/dsh-workbench-ollama`

**Priority: 🔴 Essential** — this is what makes the sovereignty claim real
rather than aspirational.

Serves open-weight models from the machine itself. Registers an `LlmAdapter`
so `ctx.llm` (and therefore `wb-model-gateway`) can reach local models, and
provides `ctx.wbEmbeddings` for the retrieval path the harness LLM seam cannot
serve.

## Setup

```bash
# 1. install Ollama (https://ollama.com/download)
brew install ollama          # macOS
# curl -fsSL https://ollama.com/install.sh | sh   # Linux

# 2. start the server (listens on 127.0.0.1:11434)
ollama serve

# 3. pull the models the routing table names
ollama pull llama3.2          # reasoning
ollama pull qwen2.5vl         # vision + OCR
ollama pull nomic-embed-text  # embeddings
```

Then set the model ids per capability in `cordis/workbench.cordis.yml`. Nothing
in this package needs editing to add a model — that is the §6.4 requirement
that a new open-weight model is a config change, not a code change.

## Why this package may open a socket

`DESIGN.md` §9 invariant 3 forbids workbench plugins from reaching the network
directly. A locally served model is reached over HTTP, so a literal reading
would make sovereign inference impossible — the opposite of what the invariant
protects. The amended invariant permits **an LLM adapter or embedding provider,
and only to its configured model host**, and requires that host to be loopback
or private.

`host-guard.ts` enforces it. A `baseUrl` whose host is not
`127.0.0.0/8`, `::1`, `10/8`, `172.16/12`, `192.168/16`, `.local` or
`.internal` **throws at load**, so the bundle does not start. That is
deliberate: a deployment must not be able to route MRPL's classified corpus to
a hosted API by editing one config line and having it work. The check rejects
`172.15.x` and `172.32.x` — the classic off-by-one in hand-written private
range tests — and that is covered by a test.

## Configuration

| Field | Default | Purpose |
|---|---|---|
| `baseUrl` | `http://127.0.0.1:11434` | Where Ollama listens. Must be on-premise. |
| `providers` | `['llm-local', 'llm-vision-local']` | Provider routes this adapter answers for; these are the ids `wb-model-gateway`'s routing points at. |
| `embeddingModel` | `nomic-embed-text` | Model backing `ctx.wbEmbeddings`. Must be an embedding model, not a chat model. |

## The embedding seam

`ctx.llm` is **chat-only** — `GenerateOptions` and `StreamChunk` describe a
conversation, and nothing behind `wb-model-gateway.resolve('embedding')` could
ever service it. That is why `wb-rag` and `wb-ingestion` both fell back to a
hash of the text, and why retrieval was lexical rather than semantic.

`WbEmbeddingsService` (§7.3) is the missing seam. Both plugins now prefer it
and fall back to the same lexical hash **together** when it is absent — writer
and reader must always agree, because vectors of different provenance compare
to plausible numbers and meaningless rankings.

An index built with one embedding model cannot be read with another. Changing
`embeddingModel` requires re-ingesting the corpus; `dimensions()` exists so a
future migration can detect the mismatch rather than silently mis-ranking.

## Wire format notes

- **Chat is NDJSON, not SSE.** One JSON object per line, each with an
  incremental `message.content`. Frames split across TCP reads are buffered
  rather than parsed — parsing a fragment would drop tokens mid-answer.
- **Images go as base64 in `messages[].images`.** They reach the harness as an
  opaque `ImageAttachmentRef`, so the plugin resolves bytes through
  `ctx.attachments`. An image that cannot be resolved is **announced to the
  model** rather than dropped: a vision answer built from an image the model
  never received would look confident and be baseless.
- **`listModels` returns empty rather than throwing** when the server is down.
  Discovery is advisory per the `LlmAdapter` contract, and an unreachable
  server must not take a boot down with it. A real call surfaces the failure
  with the `ollama pull` command that fixes it.

## Deviations

- **No reranking.** `wb-model-gateway` still routes `'rerank'` here, but Ollama
  has no rerank endpoint and `wb-rag`'s reranker remains a pass-through. A
  cross-encoder would need either a second server or an embedding-similarity
  rerank implemented in `wb-rag`.
- **Modality is not advertised.** `resolveModel` claims only identity, because
  Ollama serves text and multimodal models through one endpoint without
  declaring which is which. `wb-model-gateway`'s capability validation stays
  existence-only as a result.
- **Embeddings are sequential, not batched on the wire.** Ollama's
  `/api/embeddings` takes one prompt per request. `embed()` presents a batched
  interface so the seam does not have to change when a batching endpoint
  exists, but issues one request per text today.

## Known Limitations and Deferred Work

- No connection pooling or retry. A dropped request fails the turn; the
  harness's `llm-retry` plugin can wrap this route if a deployment wants it.
- No model preloading. The first call after `ollama serve` pays the model load
  time, which for a 7B model on a laptop is tens of seconds — worth warming
  before a demo.
- `dimensions()` embeds an empty probe string to learn the width. Harmless but
  wasteful; Ollama exposes no metadata endpoint that reports it.
