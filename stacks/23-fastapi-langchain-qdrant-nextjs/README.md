# Stack 23 — FastAPI + LangChain + Qdrant + Next.js (RAG reference)

AI-native reference stack: upload documents, get grounded answers with
citations from a retrieval-augmented generation (RAG) pipeline — fully
offline by default, with swappable embedding and vector-store backends.

## Layout

```text
backend/   FastAPI API (/api/v1): auth, documents, chat (RAG pipeline)
web/       Next.js 14 (App Router, TypeScript): four-screen journey + chat UI
```

## Prerequisites

- Python 3.13+ (tested on 3.13.2, Windows 11)
- Node.js 24 (tested v24.19.0)

No database, no Qdrant server, no API key required for the default run.

## Quickstart (backend)

```powershell
cd stacks/23-fastapi-langchain-qdrant-nextjs/backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000
```

Health probe: `GET http://localhost:8000/api/v1/health`

## Quickstart (web)

```powershell
cd stacks/23-fastapi-langchain-qdrant-nextjs/web
npm install
npm run dev
```

Open http://localhost:3000 — `/api/*` is rewritten to the backend on
:8000 (override with `STACK23_API_URL`), so the session cookie stays
first-party.

## The RAG pipeline (configurable backends, adapter pattern)

```
upload -> chunk (langchain RecursiveCharacterTextSplitter)
       -> embed (provider adapter)
       -> upsert (vector-store adapter)
chat    -> embed question -> retrieve top-k -> extractive answer + citations
```

| Concern | Default (offline) | Alternative |
|---|---|---|
| Embeddings | `STACK23_EMBEDDING_PROVIDER=fake` — LangChain `DeterministicFakeEmbedding` (real LangChain class, deterministic, no network) | `openai` — lazy-imports `langchain-openai`; requires `OPENAI_API_KEY` (never committed) |
| Vector store | `STACK23_VECTOR_STORE=local` — file-backed brute-force cosine retriever | `qdrant` — real `qdrant-client`; `STACK23_QDRANT_IN_MEMORY=1` (what tests exercise) or `STACK23_QDRANT_URL` for a live server |

There are **no mocks** in the test suite: the fake embedding is a real
LangChain class and the Qdrant tests run the real client in `:memory:` mode.

## Security posture (summary)

- bcrypt (12 rounds) hashing off the event loop via a bounded
  `ThreadPoolExecutor` (Stack-20 lesson); timing-equalized login.
- Server-side sessions in an HttpOnly, SameSite=Lax cookie
  (`STACK23_SESSION`), 30-minute idle TTL; logout invalidates server-side.
- Login throttle: 5 failed attempts / 60 s per email+IP -> `429` with
  `Retry-After: 60`.
- Upload limits: `.txt`/`.md` only, 2 MiB, 50 documents/user, bounded
  chat questions; stable error codes; no stack traces in responses.
- Chat is JSON-only — deliberately **no** `StreamingResponse`/SSE
  (QA lesson M9); the client polls with plain POST requests.
- Every JSON response uses the repository envelope
  (docs/PRODUCT_REQUIREMENTS.md §7).

See ARCHITECTURE.md for decisions and verification.md for evidence.

## Tests

```powershell
# backend
cd backend
.\.venv\Scripts\python.exe -m pytest            # 74 tests

# web
cd ../web
npm test                                        # 15 tests
npm run build                                   # production build
```

## Optional: real Qdrant server

```powershell
docker run -p 6333:6333 qdrant/qdrant            # separate terminal
cd backend
$env:STACK23_VECTOR_STORE='qdrant'
$env:STACK23_QDRANT_IN_MEMORY='0'
$env:STACK23_QDRANT_URL='http://localhost:6333'
.\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000
```

This path was **not executed** during verification (no Qdrant server in the
task environment) — see verification.md §7 before relying on it.
