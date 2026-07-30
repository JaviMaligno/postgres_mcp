import pytest
from mcp import Client

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

    tools = {tool.name: tool for tool in result.tools}
    assert set(tools) == DATABASE_TOOLS | {"list_databases"}

    for name in DATABASE_TOOLS:
        schema = tools[name].input_schema
        assert "database" in schema["properties"], name
        assert "database" not in schema.get("required", []), name
