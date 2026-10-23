# Runtime and dependency security update

The Python image now builds this checkout with `uv sync --frozen --no-dev --no-editable` from `python/`; it no longer installs an older published release. Node images use 24.22.1 and Python images use 3.11.17, with uv 0.13.5. Rebuild and redeploy images to change a running service. No package release or deployment is performed by this change.

Node consumers need a patched supported runtime (22.23.4 or 24.22.1). Python supports 3.11 and newer; CI checks patched 3.11/3.12 where applicable. Existing tool names, credential modes, database aliases, and stdio entry points are preserved. Test/toolchain parents move together to Vitest 4 and Vite 8 rather than overriding incompatible nested majors.

Draft pull requests run lightweight checks; Ready enables full tests and Linux Docker distribution builds without publishing images. Local verification does not run a Docker daemon, live server, or real provider/database calls. The Linux image proof remains pending until that Ready CI job passes.

The TypeScript and Python PostgreSQL servers remain stdio-only; HTTP-only advisories do not justify introducing an HTTP transport. Python MCP stays on its existing v2 API (2.3.0); the JavaScript v2 SDK packages use 2.3.1 or newer. Python 3.10 is no longer claimed as a supported runtime.

The build uses tsup 8.5.0 deliberately: its official esbuild range is ^0.25.0, allowing a fixed compatible 0.25 release. tsup 8.5.1 instead constrains the Windows dev-server vulnerability branch to ^0.27.0. No incompatible esbuild override is introduced; ESM and declarations are rebuilt and the stdio protocol is checked against the resulting executable.

Vite 8 additionally declares an optional esbuild ^0.27.0 || ^0.28.0 peer. The root dev dependency supplies corrected esbuild ^0.28.1 for that peer while tsup retains its own compatible ^0.25.0 dependency. Both ranges are respected; neither uses a forced out-of-range override.
