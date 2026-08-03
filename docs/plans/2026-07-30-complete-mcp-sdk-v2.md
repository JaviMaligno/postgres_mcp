# Complete MCP SDK v2 Migration Implementation Plan

**Goal:** Close the remaining code and metadata gaps in issue #4 for both TypeScript and Python without publishing a release prematurely.

**Architecture:** Keep both servers on their official v2 SDK abstractions and verify modern `server/discover` negotiation through real in-memory clients. Align runtime identity and versions at `1.1.0`, then replace the Python-only manifest with one root `server.json` describing both npm and PyPI packages and both legacy and named-connection configuration.

**Tech Stack:** TypeScript, Vitest, `@modelcontextprotocol/server` v2, Python, pytest, `mcp` v2, JSON Schema, MCP Registry `server.json`.

**Risks:** The registry schema date is independent from the protocol revision and must remain `2025-12-11` while that is the official current schema. Package versions `1.1.0` are not published yet, so this work prepares but does not perform npm/PyPI/Registry publication.

---

### Task 1: Verify modern protocol negotiation and server identity

**Files:**
- Modify: `typescript/src/__tests__/server.test.ts`
- Modify: `python/tests/test_server_api.py`
- Modify: `python/postgres_mcp/server.py`

**Step 1: Write the failing Python identity test**

Extend the real in-memory MCP v2 client test to assert:
- negotiated protocol version is `2026-07-28`;
- server identity is `postgres-mcp`;
- advertised version matches `postgres_mcp.__version__.__version__`;
- tools, resources, and prompts capabilities are present;
- list results carry `ttlMs`/`cacheScope` equivalents.

**Step 2: Run the focused Python test and confirm RED**

Run: `uv run --no-sync pytest tests/test_server_api.py -q`

Expected: failure because Python currently advertises name `postgres` and an empty version.

**Step 3: Implement the minimal identity fix**

Construct `MCPServer` with name `postgres-mcp` and `version=__version__`.

**Step 4: Verify GREEN**

Run: `uv run --no-sync pytest tests/test_server_api.py -q`

Expected: pass.

**Step 5: Add TypeScript characterization assertions**

Assert `getProtocolEra() === "modern"`, negotiated version `2026-07-28`, a populated discover result, identity `postgres-mcp@1.1.0`, and cache metadata on list results.

Run: `npm test -- src/__tests__/server.test.ts`

Expected: pass using the existing SDK v2 implementation.

### Task 2: Unify Python and TypeScript release identity

**Files:**
- Modify: `python/pyproject.toml`
- Modify: `python/postgres_mcp/__version__.py`
- Modify: `python/server.json` (subsequently moved in Task 3)
- Create: `python/tests/test_release_metadata.py`

**Step 1: Write a failing metadata consistency test**

Assert Python runtime/package version, TypeScript package/runtime version, root manifest version, and both manifest package versions are all `1.1.0`.

**Step 2: Run and confirm RED**

Run: `uv run --no-sync pytest tests/test_release_metadata.py -q`

Expected: failure because Python is still `0.2.0` and no root manifest exists.

**Step 3: Apply the minimal version alignment**

Set Python project/runtime to `1.1.0`; regenerate `uv.lock` only if dependency metadata changes.

**Step 4: Re-run the focused test after Task 3 supplies the root manifest**

Expected: pass.

### Task 3: Replace the invalid Python-only Registry manifest

**Files:**
- Delete: `python/server.json`
- Create: `server.json`
- Modify: `typescript/package.json`
- Modify: `python/README.md`
- Test: `python/tests/test_release_metadata.py`

**Step 1: Extend the failing manifest test**

Assert:
- official current schema URI remains `2025-12-11`;
- description is at most 100 characters;
- npm and PyPI packages are both present;
- npm `mcpName` and Python README `mcp-name` match the manifest name;
- `POSTGRES_CONNECTIONS` is optional and secret;
- legacy connection variables are optional because either configuration mode is valid;
- credentials are never embedded as defaults.

**Step 2: Run and confirm RED**

Run: `uv run --no-sync pytest tests/test_release_metadata.py -q`

Expected: failure against the old Python-only manifest.

**Step 3: Implement the root manifest and ownership metadata**

Create a schema-valid manifest for both `postgresql-mcp@1.1.0` packages, duplicate the same environment-variable contract per package, add npm `mcpName`, and add the hidden ownership marker to the packaged Python README.

**Step 4: Validate against the live official schema**

Run a read-only `jsonschema` validation against:
`https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json`.

Expected: zero validation errors.

**Step 5: Re-run focused tests**

Run: `uv run --no-sync pytest tests/test_release_metadata.py -q`

Expected: pass.

### Task 4: Make release CI exercise the migrated behavior

**Files:**
- Modify: `.github/workflows/publish.yml`
- Modify: `README.md`

**Step 1: Add regression assertions to metadata test**

Assert the publish workflow runs pytest with `--run-integration` and validates the root manifest before release.

**Step 2: Run and confirm RED**

Run: `uv run --no-sync pytest tests/test_release_metadata.py -q`

Expected: failure because the tag workflow currently skips integrations and manifest validation.

**Step 3: Update release workflow and documentation**

Run all PostgreSQL integration tests in the tag workflow and add a schema-validation step. Clarify that both implementations speak `2026-07-28`, while Node 20+ applies only to TypeScript and Python 3.10+ to Python.

**Step 4: Verify focused tests GREEN**

Run: `uv run --no-sync pytest tests/test_release_metadata.py -q`

Expected: pass.

### Task 5: Full verification and handoff

**Files:**
- Review all changed files.

**Step 1: Python gates**

Run:
- `uv run --no-sync ruff format --check .`
- `uv run --no-sync ruff check .`
- `uv run --no-sync pytest -q`
- `uv build`

Expected: all pass; live integration tests skip locally without credentials but run in CI.

**Step 2: TypeScript gates**

Run:
- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `npm test`

Expected: all pass.

**Step 3: Registry validation**

Validate `server.json` against the official schema and verify both `1.1.0` package identifiers are structurally ready. Do not publish npm, PyPI, create a tag, or publish Registry metadata without explicit release authorization.

**Step 4: Commit, push, and open PR**

Create a focused PR referencing #4 and report the release prerequisites separately.
