import pytest
from mcp import Client

from postgres_mcp.__version__ import __version__
from postgres_mcp.server import mcp


DATABASE_TOOLS = {
    "query",
    "execute",
    "explain_query",
    "list_schemas",
    "list_tables",
    "describe_table",
    "table_stats",
    "list_indexes",
    "list_constraints",
    "list_views",
    "describe_view",
    "list_functions",
    "get_database_info",
    "search_columns",
}


@pytest.mark.asyncio
async def test_server_exposes_multidatabase_tools_through_mcp_v2_client():
    async with Client(mcp) as client:
        result = await client.list_tools()
        assert client.protocol_version == "2026-07-28"
        assert client.server_info is not None
        assert client.server_info.name == "postgres-mcp"
        assert client.server_info.version == __version__
        assert client.server_capabilities.tools is not None
        assert client.server_capabilities.resources is not None
        assert client.server_capabilities.prompts is not None

    tools = {tool.name: tool for tool in result.tools}
    assert set(tools) == DATABASE_TOOLS | {"list_databases"}
    assert result.ttl_ms == 0
    assert result.cache_scope == "private"

    for name in DATABASE_TOOLS:
        schema = tools[name].input_schema
        assert "database" in schema["properties"], name
        assert "database" not in schema.get("required", []), name
