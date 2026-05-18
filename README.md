# Compact Playground

![Compact Playground Banner](assets/banner.png)

Compile, format, analyze, and diff [Compact](https://docs.midnight.network/) smart contracts through a simple REST API. Built for [Learn Compact](https://github.com/Olanetsoft/learn-compact) and the [Midnight Network](https://midnight.network/) ecosystem.

**Live API:** https://compact-playground.up.railway.app

## Features

- **Compile** contracts with automatic pragma/import wrapping for code snippets
- **Compile archives** — tar.gz uploads with multi-file contracts and preserved directory structure
- **Format** code using the official Compact formatter
- **Analyze** contracts with a 5-stage pipeline — parse, semantic model, rules, recommendations, and per-circuit explanations
- **Diff** two contract versions to detect structural changes
- **Visualize** contract structure as a Mermaid graph of circuits, ledger fields, and witnesses
- **Prove** — per-circuit ZK privacy-boundary analysis (what the prover knows vs. what the verifier sees)
- **Multi-version** compilation — test against multiple compiler versions in one request
- **Version detection** — auto-select the right compiler from `pragma` constraints
- **OpenZeppelin Compact** library integration with an allowlisted import surface
- **File-backed LRU cache** with shareable public IDs and per-IP / per-client **rate limiting** out of the box
- **mdBook integration** — add Run buttons to Compact code blocks

## Quick Start

```bash
docker run -p 8080:8080 ghcr.io/olanetsoft/compact-playground
```

Or build from source:

```bash
docker compose up
```

Test it:

```bash
curl http://localhost:8080/compile \
  -H "Content-Type: application/json" \
  -d '{"code": "export circuit add(a: Uint<64>, b: Uint<64>): Uint<64> { return (a + b) as Uint<64>; }"}'
```

## API Reference

### POST /compile

Compile Compact code. Snippets without a `pragma` are automatically wrapped with the correct pragma and `import CompactStandardLibrary`.

```bash
# Simple — uses default compiler
curl http://localhost:8080/compile \
  -H "Content-Type: application/json" \
  -d '{"code": "export circuit add(a: Uint<64>, b: Uint<64>): Uint<64> { return (a + b) as Uint<64>; }"}'

# Detect compiler from pragma
curl http://localhost:8080/compile \
  -H "Content-Type: application/json" \
  -d '{"code": "pragma language_version >= 0.21;\nimport CompactStandardLibrary;\nexport ledger counter: Counter;", "versions": ["detect"]}'

# Multi-version matrix
curl http://localhost:8080/compile \
  -H "Content-Type: application/json" \
  -d '{"code": "export circuit add(a: Uint<64>, b: Uint<64>): Uint<64> { return (a + b) as Uint<64>; }", "versions": ["latest", "0.26.0", "0.24.0"]}'
```

**Request:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `code` | string | *required* | Compact source code |
| `versions` | string[] | — | Compiler versions to use. Special values: `"latest"`, `"detect"`. Omit for single compilation with default version. |
| `options.wrapWithDefaults` | boolean | `true` | Auto-wrap snippets with pragma and imports |
| `options.skipZk` | boolean | `true` | Skip ZK proof generation (faster, syntax-only) |
| `options.version` | string | — | Single compiler version (alternative to `versions` array) |

**Response (single-version — no `versions` array in request):** Result fields are exposed at both the top level (legacy flat shape) and inside `results[0]`. Either form is supported indefinitely; legacy consumers read top-level `success` / `errors`, newer consumers read `results[0]`.

```json
{
  "success": true,
  "compilerVersion": "0.31.0",
  "requestedVersion": "default",
  "output": "Compilation successful",
  "executionTime": 3360,
  "compiledAt": "2026-05-18T16:00:00.000Z",
  "originalCode": "export circuit add...",
  "wrappedCode": "pragma language_version >= 0.14;\nimport CompactStandardLibrary;\n...",
  "results": [
    { "success": true, "compilerVersion": "0.31.0", "requestedVersion": "default", "output": "Compilation successful", "executionTime": 3360, "...": "..." }
  ],
  "cacheKey": "a1b2c3d4-..."
}
```

**Response (multi-version — request includes `versions: [...]`):** Only the `results` array is populated; per-version output is keyed by `requestedVersion`.

```json
{
  "results": [
    {"version": "0.31.0", "requestedVersion": "latest", "success": true, "output": "Compilation successful", "executionTime": 3100},
    {"version": "0.26.0", "requestedVersion": "0.26.0", "success": false, "errors": [{"message": "language version 0.18.0 mismatch", "severity": "error"}]}
  ]
}
```

### POST /format

Format Compact code. Returns the formatted output, whether anything changed, and a line-by-line diff when changes are detected.

```bash
curl http://localhost:8080/format \
  -H "Content-Type: application/json" \
  -d '{"code": "export circuit add(a:Uint<64>,b:Uint<64>):Uint<64>{return (a+b) as Uint<64>;}"}'
```

**Request:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `code` | string | *required* | Compact source code |
| `versions` | string[] | — | Compiler versions (for multi-version formatting) |
| `options.version` | string | — | Single compiler version |

**Response:**
```json
{
  "success": true,
  "formatted": "export circuit add(a: Uint<64>, b: Uint<64>): Uint<64> {\n  return (a + b) as Uint<64>;\n}\n",
  "changed": true,
  "diff": "- export circuit add(a:Uint<64>...)\n+ export circuit add(a: Uint<64>...)"
}
```

### POST /analyze

Run a 5-stage analysis pipeline on Compact source code: **parse → semantic model → rules → recommendations → circuit explanations**. Two modes:

- **`fast`** — source-level analysis only (no compilation needed, version-independent)
- **`deep`** — analysis + compilation diagnostics from the Compact compiler

```bash
# Fast mode — full analysis without compilation
curl http://localhost:8080/analyze \
  -H "Content-Type: application/json" \
  -d '{"code": "export ledger counter: Counter;\nexport circuit increment(): [] { counter.increment(1n); }", "mode": "fast"}'

# Filter response to specific sections
curl http://localhost:8080/analyze \
  -H "Content-Type: application/json" \
  -d '{"code": "...", "mode": "fast", "include": ["findings", "recommendations"]}'

# Focus on a single circuit
curl http://localhost:8080/analyze \
  -H "Content-Type: application/json" \
  -d '{"code": "...", "mode": "fast", "circuit": "transfer"}'

# Deep mode with version detection
curl http://localhost:8080/analyze \
  -H "Content-Type: application/json" \
  -d '{"code": "pragma language_version >= 0.21;\nimport CompactStandardLibrary;\nexport ledger counter: Counter;", "mode": "deep", "versions": ["detect"]}'
```

**Request:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `code` | string | *required* | Compact source code |
| `mode` | string | `"fast"` | `"fast"` or `"deep"` |
| `versions` | string[] | — | Compiler versions (deep mode only) |
| `include` | string[] | — | Filter response sections: `"diagnostics"`, `"facts"`, `"findings"`, `"recommendations"`, `"circuits"`, `"compilation"`. `summary` and `structure` are always returned. |
| `circuit` | string | — | Focus analysis on a single circuit by name |

**Response (fast):**
```json
{
  "success": true,
  "mode": "fast",
  "diagnostics": [],
  "summary": {
    "hasLedger": true,
    "hasCircuits": true,
    "hasWitnesses": false,
    "totalLines": 2,
    "publicCircuits": 1,
    "privateCircuits": 0,
    "publicState": 1,
    "privateState": 0
  },
  "structure": {
    "imports": [],
    "exports": ["counter", "increment"],
    "ledger": [{"name": "counter", "type": "Counter", "isPrivate": false, "location": {"line": 1, "column": 0, "offset": 0}}],
    "circuits": [{"name": "increment", "isPublic": true, "isPure": false, "parameters": [], "returnType": "[]", "location": {"line": 2, "column": 0, "offset": 31}}],
    "witnesses": [],
    "types": []
  },
  "facts": {
    "hasStdLibImport": false,
    "unusedWitnesses": []
  },
  "findings": [
    {"code": "missing-stdlib-import", "severity": "warning", "message": "...", "suggestion": "..."}
  ],
  "recommendations": [
    {"message": "...", "priority": "medium", "relatedFindings": ["missing-stdlib-import"]}
  ],
  "circuits": [
    {
      "name": "increment",
      "structure": {"isPublic": true, "isPure": false, "parameters": [], "returnType": "[]"},
      "explanation": {"explanation": "...", "operations": ["..."], "zkImplications": ["..."], "privacyConsiderations": ["..."]},
      "facts": {"readsPrivateState": false, "revealsPrivateData": false, "commitsData": false, "hashesData": false, "constrainsExecution": false, "mutatesLedger": true, "ledgerMutations": ["counter"]},
      "findings": []
    }
  ]
}
```

**Response (deep)** includes a `compilation` field:
```json
{
  "success": true,
  "mode": "deep",
  "compiler": {"available": true, "executionTime": 3200},
  "compilation": {
    "success": true,
    "diagnostics": [],
    "executionTime": 3200,
    "compilerVersion": "0.30.0",
    "languageVersion": "0.22.0"
  }
}
```

### POST /diff

Semantic diff between two contract versions. Detects added, removed, and modified circuits, ledger fields, imports, and pragma changes.

```bash
curl http://localhost:8080/diff \
  -H "Content-Type: application/json" \
  -d '{
    "before": "export circuit add(a: Uint<64>): Uint<64> { return a; }",
    "after": "export circuit add(a: Uint<64>, b: Uint<64>): Uint<64> { return (a + b) as Uint<64>; }"
  }'
```

**Response:**
```json
{
  "success": true,
  "hasChanges": true,
  "circuits": {
    "added": [],
    "removed": [],
    "modified": [{"name": "add", "changes": ["params"]}]
  },
  "ledger": {"added": [], "removed": [], "modified": []},
  "pragma": {"before": null, "after": null, "changed": false},
  "imports": {"added": [], "removed": []}
}
```

### POST /visualize

Build an architecture graph of the contract — circuits, ledger fields, and witnesses with read/write/witness edges. Returns both structured graph data and a ready-to-render Mermaid diagram.

```bash
curl http://localhost:8080/visualize \
  -H "Content-Type: application/json" \
  -d '{"code": "export ledger counter: Counter;\nexport circuit increment(): [] { counter.increment(1n); }"}'
```

**Request:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `code` | string | *required* | Compact source code |

**Response:**
```json
{
  "success": true,
  "graph": {
    "nodes": [
      {"id": "circuit:increment", "type": "circuit", "label": "increment", "isPublic": true, "isPure": false, "parameters": [], "returnType": "[]"},
      {"id": "ledger:counter", "type": "ledger", "label": "counter"}
    ],
    "edges": [{"source": "circuit:increment", "target": "ledger:counter", "type": "writes"}],
    "groups": [{"id": "public", "label": "Public", "nodeIds": ["circuit:increment"]}],
    "mermaid": "graph TD\n  circuit_increment[increment]\n  ledger_counter[(counter)]\n  circuit_increment -->|writes| ledger_counter"
  },
  "cacheKey": "a1b2c3d4-..."
}
```

### POST /prove

Per-circuit ZK privacy-boundary analysis. For each circuit, returns what the prover knows locally, what the verifier sees, the constraints, a step-by-step proof flow, and a human-readable narrative.

```bash
curl http://localhost:8080/prove \
  -H "Content-Type: application/json" \
  -d '{"code": "export ledger balance: Uint<64>;\nexport circuit deposit(amount: Uint<64>): [] { balance = (balance + amount) as Uint<64>; }"}'

# Narrow to a single circuit
curl http://localhost:8080/prove \
  -H "Content-Type: application/json" \
  -d '{"code": "...", "circuit": "deposit"}'
```

**Request:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `code` | string | *required* | Compact source code |
| `circuit` | string | — | Limit the analysis to a single circuit by name |

**Response:**
```json
{
  "success": true,
  "contract": {
    "publicState": [{"name": "balance", "type": "Uint<64>"}],
    "privateState": []
  },
  "circuits": [
    {
      "circuit": "deposit",
      "isPublic": true,
      "isPure": false,
      "proverKnows": [{"name": "amount", "type": "Uint<64>", "side": "prover", "reason": "Circuit parameter"}],
      "verifierSees": [{"name": "balance", "type": "Uint<64>", "side": "verifier", "reason": "Public ledger mutation"}],
      "constraints": [{"description": "...", "humanReadable": "..."}],
      "privacyBoundary": [],
      "proofFlow": [{"actor": "prover", "action": "...", "detail": "...", "dataVisible": [], "dataHidden": []}],
      "narrative": "..."
    }
  ],
  "cacheKey": "a1b2c3d4-..."
}
```

### POST /compile/archive

Compile multi-file contracts uploaded as a `.tar.gz` archive. Preserves directory structure so imports resolve across files. Protects against zip-slip, symlinks, and oversized or non-`.compact` entries.

```bash
curl -X POST http://localhost:8080/compile/archive \
  -F "archive=@contract.tar.gz" \
  -F "entryPoint=src/main.compact" \
  -F 'options={"skipZk":true}'
```

**Request (multipart/form-data):**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `archive` | file | *required* | `.tar.gz` archive (≤ 1 MB compressed, ≤ 2 MB uncompressed, ≤ 50 files, `.compact` entries only) |
| `entryPoint` | string | *required* | Path inside the archive to the contract to compile |
| `options` | JSON string | — | `{ "skipZk"?: boolean, "timeout"?: number }` |

Compiler version is resolved from the entry-point's `pragma language_version` (equivalent to `versions: ["detect"]`).

**Response:** Same `{ results: [...] }` shape as multi-version `/compile`, plus a `cacheKey` for shareable retrieval via `/cached-response/:uuid`.

### GET /cached-response/:uuid

Fetch a previously cached response by its public cache ID. Every successful `/compile`, `/compile/archive`, `/visualize`, `/prove`, `/analyze`, `/format`, and `/diff` response includes a `cacheKey` — use it here to share the result.

```bash
curl http://localhost:8080/cached-response/a1b2c3d4-e5f6-7890-abcd-ef0123456789
```

**Response:** The original JSON response body, or `404` if the ID is invalid or the entry has been evicted / expired (TTL defaults to 30 days).

### GET /versions

List installed compiler versions with language version mapping.

```bash
curl http://localhost:8080/versions
```

**Response:**
```json
{
  "default": "0.30.0",
  "installed": [
    {"version": "0.30.0", "languageVersion": "0.22.0"},
    {"version": "0.29.0", "languageVersion": "0.21.0"},
    {"version": "0.28.0", "languageVersion": "0.20.0"},
    {"version": "0.26.0", "languageVersion": "0.18.0"},
    {"version": "0.25.0", "languageVersion": "0.17.0"},
    {"version": "0.24.0", "languageVersion": "0.16.0"},
    {"version": "0.23.0", "languageVersion": "0.15.0"},
    {"version": "0.22.0", "languageVersion": "0.14.0"}
  ]
}
```

### GET /health

Health check with compiler status.

```bash
curl http://localhost:8080/health
```

**Response:**
```json
{
  "status": "healthy",
  "compactCli": {"installed": true, "version": "0.5.0"},
  "defaultVersion": {"configured": "latest", "resolved": "0.30.0", "valid": true},
  "timestamp": "2026-03-09T14:00:00.000Z"
}
```

## Version Resolution

Every endpoint that accepts a `versions` array supports three resolution strategies:

| Value | Behavior |
|-------|----------|
| `"latest"` | Resolves to the newest installed compiler |
| `"detect"` | Parses `pragma language_version` constraints from the source code and finds the best matching compiler |
| `"0.26.0"` | Uses the exact compiler version specified |

When no version is specified, the server uses the configured default (see `DEFAULT_COMPILER_VERSION`).

## Configuration

All settings are controlled via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | Server port |
| `DEFAULT_COMPILER_VERSION` | `latest` | Default compiler. Use `latest`, or pin to a specific version (e.g. `0.26.0`) |
| `TEMP_DIR` | `/tmp/compact-playground` | Temporary directory for compilations |
| `COMPACT_CLI_PATH` | `compact` | Path to the Compact CLI binary |
| `COMPILE_TIMEOUT` | `30000` | Compilation timeout in ms |
| `RATE_LIMIT` | `20` | Max requests per window per IP |
| `RATE_WINDOW` | `60000` | Rate limit window in ms |
| `ARCHIVE_RATE_LIMIT` | `10` | Max archive compile requests per IP per window |
| `ARCHIVE_RATE_WINDOW` | `60000` | Archive rate limit window in ms |
| `CACHE_ENABLED` | `true` | Enable file-based result caching |
| `CACHE_DIR` | `/data/cache` | Persistent cache directory |
| `CACHE_MAX_DISK_MB` | `800` | Max cache disk usage in MB |
| `CACHE_MAX_ENTRIES` | `50000` | Max cached entries |
| `CACHE_TTL` | `2592000000` | Cache entry TTL in ms (30 days) |
| `CACHE_KEY_SALT` | *(ephemeral)* | Server-side salt mixed into cache key hashes. If unset, an ephemeral random salt is generated at startup and the cache is cleared to prevent stale cross-process lookups. Set explicitly in production to persist cache across restarts. |
| `MAX_CODE_SIZE` | `102400` | Max code size in bytes (100 KB) |
| `MAX_VERSIONS_PER_REQUEST` | `3` | Max versions in a multi-version request |
| `MAX_QUEUE_SIZE` | `100` | Max queued compiler invocations; excess requests get `503` under sustained overload |
| `TRUST_PROXY` | `false` | Trust `X-Forwarded-For` / `X-Real-IP` headers for client IP |
| `TRUST_CLOUDFLARE` | `false` | Trust `CF-Connecting-IP` header for client IP |
| `OZ_CONTRACTS_PATH` | `/opt/oz-compact/contracts/src` | Path to OpenZeppelin Compact contracts |

> **Learn Compact:** Set `DEFAULT_COMPILER_VERSION=0.26.0` to pin the compiler to match `pragma language_version >= 0.16 && <= 0.18` used in the tutorial contracts.

## Request Headers

### X-Client-ID

Clients that share a source IP (e.g. multiple MCP server instances behind one egress) can send an `X-Client-ID` header to get their own rate-limit bucket instead of sharing one IP bucket.

```bash
curl http://localhost:8080/compile \
  -H "Content-Type: application/json" \
  -H "X-Client-ID: mcp-server-abc123" \
  -d '{"code": "..."}'
```

Validation: up to 128 characters, restricted to `[A-Za-z0-9._-]`. Values that fail validation are silently ignored and the request falls back to IP-based identification.

## Upgrading

### From v1 (pre-MCP)

- **Node.js 24+** is required (up from 18).
- **`/compile` multi-version responses use the `{ results: CompileResult[] }` shape.** Single-version requests (no `versions` array) keep the original flat shape *and* additionally expose `results[0]` so callers can opt in to the unified shape. Both old and new consumers continue to work without changes. Error responses (400/429/500/503) are still the flat `{ success: false, error, message }` shape.

## Deployment

### Docker

```bash
docker build -t compact-playground .
docker run -p 8080:8080 compact-playground
```

Pin a specific default compiler:

```bash
docker build --build-arg DEFAULT_COMPILER=0.26.0 -t compact-playground .
```

### Docker Compose

```bash
docker compose up
```

Configure via `.env` file (see `.env.example`).

### Railway

1. Fork this repo
2. Create a new project on [Railway](https://railway.app)
3. Connect the repo — Railway auto-detects `railway.toml`
4. Deploy

### Fly.io

```bash
fly launch --copy-config
fly deploy
```

### Render

1. Fork this repo
2. Create Web Service on [render.com](https://render.com)
3. Connect repo, select Docker runtime
4. Deploy

## mdBook Integration

Add interactive Run buttons to Compact code blocks in [mdBook](https://rust-lang.github.io/mdBook/).

1. Copy `frontend/compact-playground.js` and `frontend/compact-playground.css` into your book

2. Add to `book.toml`:
   ```toml
   [output.html]
   additional-js = ["compact-playground.js"]
   additional-css = ["compact-playground.css"]
   ```

3. Write Compact code blocks:
   ````markdown
   ```compact
   export circuit add(a: Uint<64>, b: Uint<64>): Uint<64> {
       return (a + b) as Uint<64>;
   }
   ```
   ````

Each block gets a **Run** button. Press **Ctrl+Enter** to compile. Results appear inline below the code.

To point at your own instance, set `window.COMPACT_PLAYGROUND_API_URL` before the script loads or use a `data-api-url` attribute on the script tag.

## Development

**Prerequisites:** Node.js 24+ (see `.nvmrc`) and the [Compact toolchain](https://docs.midnight.network/) installed locally.

```bash
npm install
npm run dev:node    # Start dev server with watch mode
npm run build       # Compile TypeScript
npm run test:run    # Run the test suite once
npm test            # Run tests in watch mode
npm run lint        # ESLint
npm run format      # Prettier check
npm run typecheck   # tsc --noEmit
npm run quality     # Full gate: lint + format + typecheck + test:run
```

### Project Structure

```
backend/src/
  index.ts            Server entry point (Hono)
  compiler.ts         Compilation engine
  formatter.ts        Code formatting
  differ.ts           Semantic diffing
  parser.ts           Compiler error parsing
  wrapper.ts          Automatic pragma/import wrapping
  version-manager.ts  Multi-version orchestration
  cache.ts            LRU compilation cache
  rate-limit.ts       Per-IP rate limiting
  config.ts           Environment config
  routes/             HTTP route handlers
  analysis/           5-stage analysis pipeline
    types.ts            Shared type definitions
    parser.ts           Source code parser (stage 1)
    semantic-model.ts   Semantic model builder (stage 2)
    rules.ts            Analysis rules engine (stage 3)
    recommendations.ts  Recommendation builder (stage 4)
    explanations.ts     Circuit explanation builder (stage 5)
    index.ts            Pipeline orchestrator
frontend/
  compact-playground.js   mdBook integration script
  compact-playground.css  mdBook styles
demo/
  demo.sh             Interactive API walkthrough
  contracts/          Example Compact contracts
```

### Running the Demo

The demo script builds a Docker image, starts the server, and walks through every endpoint interactively:

```bash
cd demo
./demo.sh
```

## License

MIT
