#!/usr/bin/env python3

"""
Tests for basic MCP server functionality
"""

import pytest
from unittest.mock import patch, MagicMock, AsyncMock
from postgres_mcp.server import PostgresMCPServer


class TestMCPServerInitialization:
    """Test MCP server initialization and basic functionality"""
    
    def test_server_initialization(self):
        """Test that server initializes correctly"""
        server = PostgresMCPServer()
        
        assert server.server is not None
        assert hasattr(server, 'connection_config')
        assert isinstance(server.connection_config, dict)
    
    def test_server_name(self):
        """Test that server has correct name"""
        server = PostgresMCPServer()
        assert server.server.name == "postgres-mcp"
    
    def test_connection_config_structure(self):
        """Test that connection config has all required fields"""
        server = PostgresMCPServer()
        required_fields = ['host', 'port', 'user', 'password', 'database']
        
        for field in required_fields:
            assert field in server.connection_config
    
    def test_tools_registration(self):
        """Test that tools are properly registered during initialization"""
        # Mock the server methods to verify they're called
        with patch.object(PostgresMCPServer, 'register_tools') as mock_register:
            server = PostgresMCPServer()
            mock_register.assert_called_once()


class TestMCPServerTools:
    """Test MCP server tools and handlers"""
    
    @pytest.fixture
    def server(self):
        """Fixture providing a PostgresMCPServer instance"""
        return PostgresMCPServer()
    
    def test_tool_list_structure(self, server):
        """Test that tools are properly defined"""
        # We need to test the tools that would be returned by handle_list_tools
        # Since it's an async method, we'll test the expected structure
        
        expected_tools = ['query', 'list_schemas', 'list_tables', 'describe_table']
        
        # This verifies the tools exist by checking the handler method
        for tool in expected_tools:
            handler_method = f"handle_{tool.replace('_', '_')}"
            if tool == 'query':
                handler_method = 'handle_query'
            elif tool == 'list_schemas':
                handler_method = 'handle_list_schemas'
            elif tool == 'list_tables':
                handler_method = 'handle_list_tables'
            elif tool == 'describe_table':
                handler_method = 'handle_describe_table'
            
            assert hasattr(server, handler_method)
    
    @pytest.mark.asyncio
    async def test_handle_query_with_select(self, server):
        """Test handle_query with SELECT statement"""
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_cursor.fetchall.return_value = [{'id': 1, 'name': 'test'}]
        
        with patch.object(server, 'get_connection', return_value=mock_conn):
            result = await server.handle_query({'sql': 'SELECT * FROM test'})
            
            assert len(result) == 1
            assert result[0].type == 'text'
            assert 'id' in result[0].text
            assert 'name' in result[0].text
            
            mock_cursor.execute.assert_called_once_with('SELECT * FROM test')
            mock_cursor.fetchall.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_handle_query_with_insert(self, server):
        """Test handle_query with INSERT statement"""
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_cursor.rowcount = 1
        mock_conn.cursor.return_value = mock_cursor
        
        with patch.object(server, 'get_connection', return_value=mock_conn):
            result = await server.handle_query({'sql': 'INSERT INTO test VALUES (1)'})
            
            assert len(result) == 1
            assert result[0].type == 'text'
            assert '1 rows affected' in result[0].text
            
            mock_cursor.execute.assert_called_once_with('INSERT INTO test VALUES (1)')
            mock_conn.commit.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_handle_query_with_error(self, server):
        """Test handle_query error handling"""
        with patch.object(server, 'get_connection', side_effect=Exception('Connection failed')):
            result = await server.handle_query({'sql': 'SELECT * FROM test'})
            
            assert len(result) == 1
            assert result[0].type == 'text'
            assert 'Error executing query' in result[0].text
            assert 'Connection failed' in result[0].text
    
    @pytest.mark.asyncio
    async def test_handle_list_schemas(self, server):
        """Test handle_list_schemas"""
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_cursor.fetchall.return_value = [
            {'schema_name': 'public'},
            {'schema_name': 'test_schema'}
        ]
        
        with patch.object(server, 'get_connection', return_value=mock_conn):
            result = await server.handle_list_schemas()
            
            assert len(result) == 1
            assert result[0].type == 'text'
            assert 'public' in result[0].text
            assert 'test_schema' in result[0].text
    
    @pytest.mark.asyncio
    async def test_handle_list_tables(self, server):
        """Test handle_list_tables"""
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_cursor.fetchall.return_value = [
            {'table_name': 'users', 'table_type': 'BASE TABLE'},
            {'table_name': 'orders', 'table_type': 'BASE TABLE'}
        ]
        
        with patch.object(server, 'get_connection', return_value=mock_conn):
            result = await server.handle_list_tables({'schema': 'public'})
            
            assert len(result) == 1
            assert result[0].type == 'text'
            assert 'users' in result[0].text
            assert 'orders' in result[0].text
    
    @pytest.mark.asyncio
    async def test_handle_describe_table(self, server):
        """Test handle_describe_table"""
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        
        # Mock the multiple queries that describe_table makes
        mock_cursor.fetchall.side_effect = [
            # Columns query result
            [
                {
                    'column_name': 'id',
                    'data_type': 'integer',
                    'is_nullable': 'NO',
                    'column_default': 'nextval(\'users_id_seq\'::regclass)',
                    'character_maximum_length': None,
                    'numeric_precision': 32,
                    'numeric_scale': 0
                }
            ],
            # Primary keys query result
            [{'column_name': 'id'}],
            # Foreign keys query result
            []
        ]
        
        with patch.object(server, 'get_connection', return_value=mock_conn):
            result = await server.handle_describe_table({'table_name': 'users', 'schema': 'public'})
            
            assert len(result) == 1
            assert result[0].type == 'text'
            assert 'id' in result[0].text
            assert 'integer' in result[0].text
            assert 'primary_keys' in result[0].text


class TestMCPServerErrorHandling:
    """Test error handling in MCP server methods"""
    
    @pytest.fixture
    def server(self):
        """Fixture providing a PostgresMCPServer instance"""
        return PostgresMCPServer()
    
    @pytest.mark.asyncio
    async def test_query_without_sql_parameter(self, server):
        """Test query handler without required sql parameter"""
        with pytest.raises(ValueError, match="SQL query is required"):
            await server.handle_query({})
    
    @pytest.mark.asyncio
    async def test_describe_table_without_table_name(self, server):
        """Test describe_table handler without required table_name parameter"""
        with pytest.raises(ValueError, match="Table name is required"):
            await server.handle_describe_table({})
    
    @pytest.mark.asyncio
    async def test_connection_cleanup_on_error(self, server):
        """Test that database connections are properly closed on errors"""
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_cursor.execute.side_effect = Exception("Query failed")
        
        with patch.object(server, 'get_connection', return_value=mock_conn):
            result = await server.handle_query({'sql': 'SELECT * FROM test'})
            
            # Verify connection was closed even after error
            mock_conn.close.assert_called_once()
            
            # Verify error was handled gracefully
            assert len(result) == 1
            assert 'Error executing query' in result[0].text


class TestMCPServerIntegration:
    """Integration tests for MCP server functionality"""
    
    @pytest.mark.asyncio
    async def test_server_tool_execution_flow(self):
        """Test the complete flow of tool execution"""
        server = PostgresMCPServer()
        
        # Mock database connection and results
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_cursor.fetchall.return_value = [{'version': '13.0'}]
        
        with patch.object(server, 'get_connection', return_value=mock_conn):
            # Test the call_tool handler directly
            # This simulates what would happen when MCP receives a tool call
            result = await server.server._call_tool_handlers['query']({'sql': 'SELECT version()'})
            
            assert len(result) == 1
            assert result[0].type == 'text'
            assert 'version' in result[0].text

