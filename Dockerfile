# Dockerfile for Smithery deployment
FROM python:3.11-slim

# Install the MCP server from PyPI
RUN pip install --no-cache-dir postgresql-mcp

# Set the entrypoint
ENTRYPOINT ["postgresql-mcp"]
