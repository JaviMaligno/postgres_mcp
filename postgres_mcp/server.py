#!/usr/bin/env python3

"""
PostgreSQL MCP Server
Provides tools for querying PostgreSQL databases, listing schemas, tables, and describing table structures.
"""

import os
import json
import asyncio
from typing import Dict, List, Any, Optional
from dotenv import load_dotenv
import psycopg2
from psycopg2.extras import RealDictCursor
import psycopg2.sql
import logging

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import (
    Tool,
    TextContent
)
from mcp.server.models import InitializationOptions
from mcp.types import ServerCapabilities

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class PostgresMCPServer:
    def __init__(self):
        self.server = Server("postgres-mcp")
        self.connection_config = {
            'host': os.getenv('POSTGRES_HOST', 'localhost'),
            'port': int(os.getenv('POSTGRES_PORT', 5432)),
            'user': os.getenv('POSTGRES_USER', 'postgres'),
            'password': os.getenv('POSTGRES_PASSWORD', 'postgres'),
            'database': os.getenv('POSTGRES_DB', 'postgres')
        }
        
        # Register tools
        self.register_tools()
        
    def get_connection(self):
        """Get a database connection"""
        try:
            conn = psycopg2.connect(
                host=self.connection_config['host'],
                port=self.connection_config['port'],
                user=self.connection_config['user'],
                password=self.connection_config['password'],
                database=self.connection_config['database'],
                cursor_factory=RealDictCursor
            )
            return conn
        except Exception as e:
            logger.error(f"Database connection failed: {e}")
            raise

    def register_tools(self):
        """Register all available tools"""
        
        @self.server.list_tools()
        async def handle_list_tools() -> List[Tool]:
            """List available tools"""
            return [
                Tool(
                    name="query",
                    description="Execute a SQL query against the PostgreSQL database",
                    inputSchema={
                        "type": "object",
                        "properties": {
                            "sql": {
                                "type": "string",
                                "description": "SQL query to execute"
                            }
                        },
                        "required": ["sql"]
                    }
                ),
                Tool(
                    name="list_schemas",
                    description="List all schemas in the PostgreSQL database",
                    inputSchema={
                        "type": "object",
                        "properties": {},
                        "required": []
                    }
                ),
                Tool(
                    name="list_tables",
                    description="List all tables in a specific schema",
                    inputSchema={
                        "type": "object",
                        "properties": {
                            "schema": {
                                "type": "string",
                                "description": "Schema name to list tables from (default: public)",
                                "default": "public"
                            }
                        },
                        "required": []
                    }
                ),
                Tool(
                    name="describe_table",
                    description="Describe the structure of a table including columns, types, and constraints",
                    inputSchema={
                        "type": "object",
                        "properties": {
                            "table_name": {
                                "type": "string",
                                "description": "Name of the table to describe"
                            },
                            "schema": {
                                "type": "string",
                                "description": "Schema name (default: public)",
                                "default": "public"
                            }
                        },
                        "required": ["table_name"]
                    }
                )
            ]

        @self.server.call_tool()
        async def handle_call_tool(name: str, arguments: Dict[str, Any]) -> List[TextContent]:
            """Handle tool calls"""
            
            if name == "query":
                return await self.handle_query(arguments)
            elif name == "list_schemas":
                return await self.handle_list_schemas()
            elif name == "list_tables":
                return await self.handle_list_tables(arguments)
            elif name == "describe_table":
                return await self.handle_describe_table(arguments)
            else:
                raise ValueError(f"Unknown tool: {name}")

    async def handle_query(self, arguments: Dict[str, Any]) -> List[TextContent]:
        """Execute a SQL query"""
        sql = arguments.get("sql")
        if not sql:
            raise ValueError("SQL query is required")
        
        try:
            conn = self.get_connection()
            cursor = conn.cursor()
            
            # Execute the query
            cursor.execute(sql)
            
            # Check if it's a SELECT query or other query type
            if sql.strip().upper().startswith('SELECT'):
                results = cursor.fetchall()
                
                # Convert results to a more readable format
                if results:
                    # RealDictCursor already returns dictionaries, no need to process further
                    formatted_results = [dict(row) for row in results]
                    
                    return [TextContent(
                        type="text",
                        text=json.dumps(formatted_results, indent=2, default=str)
                    )]
                else:
                    return [TextContent(
                        type="text",
                        text="Query executed successfully. No results returned."
                    )]
            else:
                # For non-SELECT queries, commit and return affected rows
                conn.commit()
                affected_rows = cursor.rowcount
                return [TextContent(
                    type="text",
                    text=f"Query executed successfully. {affected_rows} rows affected."
                )]
        
        except Exception as e:
            logger.error(f"Query execution failed: {e}")
            return [TextContent(
                type="text",
                text=f"Error executing query: {str(e)}"
            )]
        finally:
            if 'conn' in locals():
                conn.close()

    async def handle_list_schemas(self) -> List[TextContent]:
        """List all schemas in the database"""
        try:
            conn = self.get_connection()
            cursor = conn.cursor()
            
            cursor.execute("""
                SELECT schema_name 
                FROM information_schema.schemata 
                WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast')
                ORDER BY schema_name
            """)
            
            schemas = cursor.fetchall()
            schema_list = [row['schema_name'] for row in schemas]
            
            return [TextContent(
                type="text",
                text=json.dumps(schema_list, indent=2)
            )]
        
        except Exception as e:
            logger.error(f"Failed to list schemas: {e}")
            return [TextContent(
                type="text",
                text=f"Error listing schemas: {str(e)}"
            )]
        finally:
            if 'conn' in locals():
                conn.close()

    async def handle_list_tables(self, arguments: Dict[str, Any]) -> List[TextContent]:
        """List all tables in a schema"""
        schema = arguments.get("schema", "public")
        
        try:
            conn = self.get_connection()
            cursor = conn.cursor()
            
            cursor.execute("""
                SELECT table_name, table_type
                FROM information_schema.tables 
                WHERE table_schema = %s
                ORDER BY table_name
            """, (schema,))
            
            tables = cursor.fetchall()
            table_list = [{"name": row['table_name'], "type": row['table_type']} for row in tables]
            
            return [TextContent(
                type="text",
                text=json.dumps(table_list, indent=2)
            )]
        
        except Exception as e:
            logger.error(f"Failed to list tables: {e}")
            return [TextContent(
                type="text",
                text=f"Error listing tables: {str(e)}"
            )]
        finally:
            if 'conn' in locals():
                conn.close()

    async def handle_describe_table(self, arguments: Dict[str, Any]) -> List[TextContent]:
        """Describe table structure"""
        table_name = arguments.get("table_name")
        schema = arguments.get("schema", "public")
        
        if not table_name:
            raise ValueError("Table name is required")
        
        try:
            conn = self.get_connection()
            cursor = conn.cursor()
            
            # Get column information
            cursor.execute("""
                SELECT 
                    column_name,
                    data_type,
                    is_nullable,
                    column_default,
                    character_maximum_length,
                    numeric_precision,
                    numeric_scale
                FROM information_schema.columns 
                WHERE table_schema = %s AND table_name = %s
                ORDER BY ordinal_position
            """, (schema, table_name))
            
            columns = cursor.fetchall()
            
            # Get primary key information
            cursor.execute("""
                SELECT column_name
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                    ON tc.constraint_name = kcu.constraint_name
                WHERE tc.table_schema = %s 
                    AND tc.table_name = %s
                    AND tc.constraint_type = 'PRIMARY KEY'
            """, (schema, table_name))
            
            primary_keys = [row['column_name'] for row in cursor.fetchall()]
            
            # Get foreign key information
            cursor.execute("""
                SELECT 
                    kcu.column_name,
                    ccu.table_name AS foreign_table_name,
                    ccu.column_name AS foreign_column_name
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                    ON tc.constraint_name = kcu.constraint_name
                JOIN information_schema.constraint_column_usage ccu
                    ON ccu.constraint_name = tc.constraint_name
                WHERE tc.table_schema = %s 
                    AND tc.table_name = %s
                    AND tc.constraint_type = 'FOREIGN KEY'
            """, (schema, table_name))
            
            foreign_keys = cursor.fetchall()
            
            # Format the results
            table_info = {
                "schema": schema,
                "table_name": table_name,
                "columns": [],
                "primary_keys": primary_keys,
                "foreign_keys": [
                    {
                        "column": fk['column_name'],
                        "references": f"{fk['foreign_table_name']}.{fk['foreign_column_name']}"
                    } for fk in foreign_keys
                ]
            }
            
            for col in columns:
                col_info = {
                    "name": col['column_name'],
                    "type": col['data_type'],
                    "nullable": col['is_nullable'] == 'YES',
                    "default": col['column_default'],
                    "is_primary_key": col['column_name'] in primary_keys
                }
                
                # Add length/precision info if available
                if col['character_maximum_length']:
                    col_info["max_length"] = col['character_maximum_length']
                if col['numeric_precision']:
                    col_info["precision"] = col['numeric_precision']
                if col['numeric_scale']:
                    col_info["scale"] = col['numeric_scale']
                
                table_info["columns"].append(col_info)
            
            return [TextContent(
                type="text",
                text=json.dumps(table_info, indent=2, default=str)
            )]
        
        except Exception as e:
            logger.error(f"Failed to describe table: {e}")
            return [TextContent(
                type="text",
                text=f"Error describing table: {str(e)}"
            )]
        finally:
            if 'conn' in locals():
                conn.close()

    async def run(self):
        """Run the MCP server"""
        async with stdio_server() as streams:
            await self.server.run(
                streams[0], 
                streams[1],
                InitializationOptions(
                    server_name="postgres-mcp",
                    server_version="0.1.0",
                    capabilities=ServerCapabilities(
                        tools={
                            "listChanged": True
                        }
                    )
                )
            )

def main():
    """Main entry point"""
    server = PostgresMCPServer()
    asyncio.run(server.run())

if __name__ == "__main__":
    main() 