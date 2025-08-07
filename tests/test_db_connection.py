#!/usr/bin/env python3

"""
Tests for database connectivity
"""

import os
import pytest
from unittest.mock import patch, MagicMock
import psycopg2
from postgres_mcp.server import PostgresMCPServer


class TestDatabaseConnection:
    """Test database connectivity and configuration"""
    
    def test_get_connection_success(self):
        """Test successful database connection"""
        server = PostgresMCPServer()
        
        # Mock psycopg2.connect to return a mock connection
        mock_conn = MagicMock()
        with patch('postgres_mcp.server.psycopg2.connect', return_value=mock_conn) as mock_connect:
            conn = server.get_connection()
            
            # Verify connection was attempted with correct parameters
            mock_connect.assert_called_once_with(
                host=server.connection_config['host'],
                port=server.connection_config['port'],
                user=server.connection_config['user'],
                password=server.connection_config['password'],
                database=server.connection_config['database'],
                cursor_factory=psycopg2.extras.RealDictCursor
            )
            
            # Verify the connection object is returned
            assert conn == mock_conn
    
    def test_get_connection_failure(self):
        """Test database connection failure handling"""
        server = PostgresMCPServer()
        
        # Mock psycopg2.connect to raise an exception
        with patch('postgres_mcp.server.psycopg2.connect', side_effect=psycopg2.OperationalError("Connection failed")):
            with pytest.raises(psycopg2.OperationalError):
                server.get_connection()
    
    def test_connection_with_custom_config(self):
        """Test connection with custom configuration"""
        custom_env = {
            'POSTGRES_HOST': 'test_host',
            'POSTGRES_PORT': '5433',
            'POSTGRES_USER': 'test_user',
            'POSTGRES_PASSWORD': 'test_password',
            'POSTGRES_DB': 'test_database'
        }
        
        with patch.dict(os.environ, custom_env):
            server = PostgresMCPServer()
            mock_conn = MagicMock()
            
            with patch('postgres_mcp.server.psycopg2.connect', return_value=mock_conn) as mock_connect:
                server.get_connection()
                
                mock_connect.assert_called_once_with(
                    host='test_host',
                    port=5433,
                    user='test_user',
                    password='test_password',
                    database='test_database',
                    cursor_factory=psycopg2.extras.RealDictCursor
                )
    
    def test_real_database_connection_if_configured(self):
        """
        Test real database connection if environment variables are properly set.
        This test will skip if no real database is configured.
        """
        # Check if we have database configuration
        db_config = {
            'host': os.getenv('POSTGRES_HOST'),
            'port': os.getenv('POSTGRES_PORT'),
            'user': os.getenv('POSTGRES_USER'),
            'password': os.getenv('POSTGRES_PASSWORD'),
            'database': os.getenv('POSTGRES_DB')
        }
        
        # Skip test if any required config is missing (using defaults is not sufficient for real connection test)
        if not all([db_config['host'], db_config['user'], db_config['password']]):
            pytest.skip("Real database configuration not available - set POSTGRES_* environment variables to enable this test")
        
        server = PostgresMCPServer()
        
        try:
            conn = server.get_connection()
            
            # Test that we can execute a simple query
            cursor = conn.cursor()
            cursor.execute("SELECT 1 as test_column;")
            result = cursor.fetchone()
            
            assert result is not None
            assert result['test_column'] == 1
            
            conn.close()
            
        except psycopg2.OperationalError as e:
            pytest.fail(f"Database connection failed with configured environment variables: {e}")
    
    def test_connection_logging_on_failure(self):
        """Test that connection failures are properly logged"""
        server = PostgresMCPServer()
        
        with patch('postgres_mcp.server.psycopg2.connect', side_effect=psycopg2.OperationalError("Test error")):
            with patch('postgres_mcp.server.logger.error') as mock_logger:
                with pytest.raises(psycopg2.OperationalError):
                    server.get_connection()
                
                # Verify error was logged
                mock_logger.assert_called_once()
                call_args = mock_logger.call_args[0][0]
                assert "Database connection failed" in call_args
                assert "Test error" in call_args
    
    def test_connection_uses_realdict_cursor(self):
        """Test that connections use RealDictCursor by default"""
        server = PostgresMCPServer()
        
        with patch('postgres_mcp.server.psycopg2.connect') as mock_connect:
            server.get_connection()
            
            # Verify cursor_factory parameter is set
            call_kwargs = mock_connect.call_args[1]
            assert 'cursor_factory' in call_kwargs
            assert call_kwargs['cursor_factory'] == psycopg2.extras.RealDictCursor


class TestDatabaseConnectionIntegration:
    """Integration tests for database connection functionality"""
    
    @pytest.fixture
    def mock_database(self):
        """Fixture that provides a mock database connection for integration tests"""
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        
        # Set up cursor to return expected results
        mock_conn.cursor.return_value = mock_cursor
        mock_cursor.fetchall.return_value = [{'test': 'result'}]
        mock_cursor.fetchone.return_value = {'test': 'single_result'}
        mock_cursor.rowcount = 1
        
        return mock_conn, mock_cursor
    
    def test_connection_lifecycle(self, mock_database):
        """Test complete connection lifecycle"""
        mock_conn, mock_cursor = mock_database
        server = PostgresMCPServer()
        
        with patch('postgres_mcp.server.psycopg2.connect', return_value=mock_conn):
            # Get connection
            conn = server.get_connection()
            
            # Use connection
            cursor = conn.cursor()
            cursor.execute("SELECT 1;")
            result = cursor.fetchone()
            
            # Verify the connection was used properly
            assert result == {'test': 'single_result'}
            mock_conn.cursor.assert_called_once()
            mock_cursor.execute.assert_called_once_with("SELECT 1;")
            mock_cursor.fetchone.assert_called_once()
    
    def test_connection_error_types(self):
        """Test handling of different types of connection errors"""
        server = PostgresMCPServer()
        
        error_types = [
            psycopg2.OperationalError("Connection timeout"),
            psycopg2.DatabaseError("Database not found"),
            Exception("Generic connection error")
        ]
        
        for error in error_types:
            with patch('postgres_mcp.server.psycopg2.connect', side_effect=error):
                with pytest.raises(type(error)):
                    server.get_connection()

