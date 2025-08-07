#!/usr/bin/env python3

"""
Comprehensive connectivity and configuration tests

This module provides tests to verify that the PostgreSQL MCP server
is properly configured and can connect to the database.
"""

import os
import pytest
from postgres_mcp.server import PostgresMCPServer
import psycopg2


class TestConnectivityCheck:
    """
    Main connectivity tests to verify environment configuration and database access.
    
    These tests are designed to help users verify their setup is working correctly.
    """
    
    def test_environment_variables_loaded(self):
        """
        Test that environment variables are loaded and have expected values.
        
        This test helps verify that your .env file or environment variables
        are properly configured.
        """
        server = PostgresMCPServer()
        
        # Print current configuration for debugging
        print("\n" + "="*50)
        print("CURRENT DATABASE CONFIGURATION:")
        print("="*50)
        for key, value in server.connection_config.items():
            # Hide password for security
            display_value = "***" if key == 'password' and value != 'postgres' else value
            print(f"{key.upper()}: {display_value}")
        print("="*50)
        
        # Verify all configuration keys exist
        required_keys = ['host', 'port', 'user', 'password', 'database']
        for key in required_keys:
            assert key in server.connection_config, f"Missing configuration key: {key}"
        
        # Verify types
        assert isinstance(server.connection_config['port'], int), "Port must be an integer"
        assert server.connection_config['port'] > 0, "Port must be positive"
        
        # Check if using default values (might indicate missing configuration)
        defaults_used = []
        if server.connection_config['host'] == 'localhost':
            defaults_used.append('POSTGRES_HOST')
        if server.connection_config['port'] == 5432:
            defaults_used.append('POSTGRES_PORT')
        if server.connection_config['user'] == 'postgres':
            defaults_used.append('POSTGRES_USER')
        if server.connection_config['password'] == 'postgres':
            defaults_used.append('POSTGRES_PASSWORD')
        if server.connection_config['database'] == 'postgres':
            defaults_used.append('POSTGRES_DB')
        
        if defaults_used:
            print(f"\nWARNING: Using default values for: {', '.join(defaults_used)}")
            print("Consider setting these environment variables for proper configuration.")
    
    def test_database_connectivity(self):
        """
        Test actual database connectivity.
        
        This is the main test to verify your database connection works.
        It will attempt to connect to the database and execute a simple query.
        """
        server = PostgresMCPServer()
        
        try:
            # Attempt to get a connection
            print(f"\nAttempting to connect to database at {server.connection_config['host']}:{server.connection_config['port']}")
            conn = server.get_connection()
            
            # Test basic query execution
            cursor = conn.cursor()
            cursor.execute("SELECT 1 as connectivity_test, version() as postgres_version;")
            result = cursor.fetchone()
            
            print("✅ Database connection successful!")
            print(f"PostgreSQL version: {result['postgres_version']}")
            
            # Test that we can query basic system information
            cursor.execute("SELECT current_database(), current_user, current_timestamp;")
            info = cursor.fetchone()
            
            print(f"Connected to database: {info['current_database']}")
            print(f"Connected as user: {info['current_user']}")
            print(f"Connection time: {info['current_timestamp']}")
            
            # Close connection
            conn.close()
            
            # Verify result structure
            assert result['connectivity_test'] == 1
            assert 'PostgreSQL' in result['postgres_version']
            
        except psycopg2.OperationalError as e:
            error_msg = str(e)
            print(f"\n❌ Database connection failed: {error_msg}")
            
            # Provide helpful error messages based on common issues
            if "could not connect to server" in error_msg:
                print("\n🔧 TROUBLESHOOTING TIPS:")
                print("1. Check that PostgreSQL server is running")
                print("2. Verify POSTGRES_HOST and POSTGRES_PORT are correct")
                print("3. Check firewall/network settings")
            elif "password authentication failed" in error_msg:
                print("\n🔧 TROUBLESHOOTING TIPS:")
                print("1. Verify POSTGRES_USER and POSTGRES_PASSWORD are correct")
                print("2. Check that the user exists in PostgreSQL")
                print("3. Verify user has permission to connect")
            elif "database" in error_msg and "does not exist" in error_msg:
                print("\n🔧 TROUBLESHOOTING TIPS:")
                print("1. Verify POSTGRES_DB exists in your PostgreSQL server")
                print("2. Create the database if it doesn't exist")
                print("3. Check that the user has access to the database")
            
            # Re-raise the exception so the test fails
            pytest.fail(f"Database connectivity test failed: {error_msg}")
        
        except Exception as e:
            print(f"\n❌ Unexpected error during database connection: {e}")
            pytest.fail(f"Unexpected database error: {e}")
    
    @pytest.mark.asyncio
    async def test_mcp_server_basic_functionality(self):
        """
        Test basic MCP server functionality with database operations.
        
        This test verifies that the MCP server can perform its core functions.
        """
        server = PostgresMCPServer()
        
        try:
            # Test list_schemas functionality
            print("\nTesting list_schemas...")
            schemas_result = await server.handle_list_schemas()
            assert len(schemas_result) == 1
            assert schemas_result[0].type == 'text'
            print("✅ list_schemas working")
            
            # Test a simple query
            print("Testing basic query...")
            query_result = await server.handle_query({
                'sql': 'SELECT current_database() as db_name, current_user as username;'
            })
            assert len(query_result) == 1
            assert query_result[0].type == 'text'
            assert 'db_name' in query_result[0].text
            print("✅ Basic query working")
            
            # Test list_tables for public schema
            print("Testing list_tables...")
            tables_result = await server.handle_list_tables({'schema': 'public'})
            assert len(tables_result) == 1
            assert tables_result[0].type == 'text'
            print("✅ list_tables working")
            
            print("🎉 All MCP server basic functionality tests passed!")
            
        except Exception as e:
            print(f"❌ MCP server functionality test failed: {e}")
            pytest.fail(f"MCP server functionality test failed: {e}")
    
    def test_connection_configuration_summary(self):
        """
        Print a summary of the current connection configuration for troubleshooting.
        
        This test always passes but provides useful information for debugging.
        """
        server = PostgresMCPServer()
        
        print("\n" + "="*60)
        print("POSTGRESQL MCP SERVER CONFIGURATION SUMMARY")
        print("="*60)
        
        config = server.connection_config
        print(f"Host: {config['host']}")
        print(f"Port: {config['port']}")
        print(f"User: {config['user']}")
        print(f"Password: {'***' if config['password'] != 'postgres' else 'postgres (default)'}")
        print(f"Database: {config['database']}")
        
        print("\nEnvironment Variables Status:")
        env_vars = {
            'POSTGRES_HOST': os.getenv('POSTGRES_HOST', 'Not set (using default)'),
            'POSTGRES_PORT': os.getenv('POSTGRES_PORT', 'Not set (using default)'),
            'POSTGRES_USER': os.getenv('POSTGRES_USER', 'Not set (using default)'),
            'POSTGRES_PASSWORD': '***' if os.getenv('POSTGRES_PASSWORD') else 'Not set (using default)',
            'POSTGRES_DB': os.getenv('POSTGRES_DB', 'Not set (using default)'),
        }
        
        for var, value in env_vars.items():
            print(f"  {var}: {value}")
        
        print("\nNext Steps:")
        print("1. If using defaults, create a .env file with your database configuration")
        print("2. Run the connectivity test to verify your database connection")
        print("3. Use 'poetry run postgres-mcp' to start the MCP server")
        
        print("="*60)
        
        # This test always passes - it's just for information
        assert True


class TestEnvironmentSetup:
    """Tests specifically for environment setup and configuration validation"""
    
    def test_dotenv_file_recommendations(self):
        """
        Provide recommendations for .env file setup.
        
        This test checks if a .env file exists and provides setup guidance.
        """
        print("\n" + "="*50)
        print("ENVIRONMENT SETUP CHECK")
        print("="*50)
        
        env_file_path = os.path.join(os.getcwd(), '.env')
        env_file_exists = os.path.exists(env_file_path)
        
        print(f".env file exists: {env_file_exists}")
        
        if not env_file_exists:
            print("\n📝 RECOMMENDED .env FILE CONTENT:")
            print("-" * 40)
            print("POSTGRES_HOST=localhost")
            print("POSTGRES_PORT=5432") 
            print("POSTGRES_USER=your_username")
            print("POSTGRES_PASSWORD=your_password")
            print("POSTGRES_DB=your_database")
            print("-" * 40)
            print("Create this file in your project root to configure the MCP server.")
        else:
            print("✅ .env file found")
            
        print("="*50)
        
        # Test passes regardless - this is informational
        assert True
    
    def test_required_dependencies(self):
        """
        Test that all required dependencies are available.
        """
        try:
            import psycopg2
            import mcp
            from dotenv import load_dotenv
            
            print("\n✅ All required dependencies are installed:")
            print(f"  - psycopg2: {psycopg2.__version__}")
            print(f"  - mcp: available") 
            print(f"  - python-dotenv: available")
            
        except ImportError as e:
            pytest.fail(f"Missing required dependency: {e}")
    
    def test_python_version_compatibility(self):
        """
        Test that Python version is compatible with the MCP server.
        """
        import sys
        
        python_version = sys.version_info
        print(f"\nPython version: {python_version.major}.{python_version.minor}.{python_version.micro}")
        
        # MCP requires Python 3.10+
        assert python_version >= (3, 10), f"Python 3.10+ required, got {python_version.major}.{python_version.minor}"
        
        print("✅ Python version is compatible")


# Utility function that can be run directly
def run_connectivity_check():
    """
    Utility function to run a quick connectivity check.
    
    This can be imported and run directly from Python code.
    """
    print("Running PostgreSQL MCP Server connectivity check...")
    
    try:
        server = PostgresMCPServer()
        conn = server.get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT 1;")
        result = cursor.fetchone()
        conn.close()
        
        print("✅ Connectivity check passed!")
        return True
        
    except Exception as e:
        print(f"❌ Connectivity check failed: {e}")
        return False


if __name__ == "__main__":
    # Allow running this file directly for quick connectivity check
    run_connectivity_check()

