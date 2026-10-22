# Build with the python/ directory as the Docker context.
FROM ghcr.io/astral-sh/uv:0.13.5 AS uv
FROM python:3.11.17-slim
COPY --from=uv /uv /uvx /bin/
WORKDIR /app
ENV UV_PYTHON_DOWNLOADS=never
COPY pyproject.toml uv.lock README.md ./
COPY postgres_mcp/ ./postgres_mcp/
# Install this checkout and its locked dependencies, never the older PyPI release.
RUN uv sync --frozen --no-dev --no-editable
USER 10001:10001
ENTRYPOINT ["/app/.venv/bin/postgresql-mcp"]
