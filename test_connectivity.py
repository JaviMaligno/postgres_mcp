#!/usr/bin/env python3

"""
Standalone connectivity test script for PostgreSQL MCP Server

This script provides a quick way to test database connectivity and configuration
without running the full test suite. Run this script to verify your setup.

Usage:
    python test_connectivity.py
    or
    poetry run python test_connectivity.py
"""

import os
import sys
from pathlib import Path

# Add the postgres_mcp module to the path
sys.path.insert(0, str(Path(__file__).parent))

try:
    from postgres_mcp.server import PostgresMCPServer
    import psycopg2
    from dotenv import load_dotenv
except ImportError as e:
    print(f"❌ Import error: {e}")
    print("Make sure you've installed dependencies with: poetry install")
    sys.exit(1)


def print_header(title):
    """Print a formatted header"""
    print("\n" + "="*60)
    print(f" {title}")
    print("="*60)


def print_section(title):
    """Print a formatted section header"""
    print(f"\n📋 {title}")
    print("-" * 50)


def check_environment_variables():
    """Check and display environment variable configuration"""
    print_section("Environment Variables Check")
    
    # Load environment variables
    load_dotenv()
    
    env_vars = {
        'POSTGRES_HOST': os.getenv('POSTGRES_HOST'),
        'POSTGRES_PORT': os.getenv('POSTGRES_PORT'),
        'POSTGRES_USER': os.getenv('POSTGRES_USER'),
        'POSTGRES_PASSWORD': os.getenv('POSTGRES_PASSWORD'),
        'POSTGRES_DB': os.getenv('POSTGRES_DB'),
    }
    
    defaults = {
        'POSTGRES_HOST': 'localhost',
        'POSTGRES_PORT': '5432',
        'POSTGRES_USER': 'postgres',
        'POSTGRES_PASSWORD': 'postgres',
        'POSTGRES_DB': 'postgres',
    }
    
    print("Environment variable status:")
    using_defaults = []
    
    for var, value in env_vars.items():
        if value:
            display_value = "***" if "PASSWORD" in var else value
            print(f"  ✅ {var}: {display_value}")
        else:
            print(f"  ⚠️  {var}: Not set (will use default: {defaults[var]})")
            using_defaults.append(var)
    
    if using_defaults:
        print(f"\n⚠️  WARNING: Using defaults for {len(using_defaults)} variables")
        print("   Consider creating a .env file for proper configuration")
    else:
        print("\n✅ All environment variables are configured")
    
    return len(using_defaults) == 0


def check_dependencies():
    """Check that all required dependencies are installed"""
    print_section("Dependencies Check")
    
    try:
        import psycopg2
        print(f"  ✅ psycopg2: {psycopg2.__version__}")
    except ImportError:
        print("  ❌ psycopg2: Not installed")
        return False
    
    try:
        import mcp
        print("  ✅ mcp: Available")
    except ImportError:
        print("  ❌ mcp: Not installed")
        return False
    
    try:
        from dotenv import load_dotenv
        print("  ✅ python-dotenv: Available")
    except ImportError:
        print("  ❌ python-dotenv: Not installed")
        return False
    
    print("\n✅ All dependencies are installed")
    return True


def test_database_connection():
    """Test database connectivity"""
    print_section("Database Connectivity Test")
    
    try:
        # Create server instance
        server = PostgresMCPServer()
        
        # Display configuration (hide password)
        config = server.connection_config
        print("Connection configuration:")
        for key, value in config.items():
            display_value = "***" if key == 'password' and value != 'postgres' else value
            print(f"  {key}: {display_value}")
        
        print(f"\nAttempting to connect to {config['host']}:{config['port']}...")
        
        # Attempt connection
        conn = server.get_connection()
        cursor = conn.cursor()
        
        # Test basic connectivity
        cursor.execute("SELECT 1 as test, version() as version;")
        result = cursor.fetchone()
        
        print("✅ Connection successful!")
        print(f"PostgreSQL version: {result['version']}")
        
        # Test database information
        cursor.execute("""
            SELECT 
                current_database() as database,
                current_user as user,
                current_timestamp as timestamp
        """)
        info = cursor.fetchone()
        
        print(f"Connected to database: {info['database']}")
        print(f"Connected as user: {info['user']}")
        print(f"Connection timestamp: {info['timestamp']}")
        
        # Test basic schema query
        cursor.execute("""
            SELECT count(*) as schema_count 
            FROM information_schema.schemata 
            WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast')
        """)
        schema_info = cursor.fetchone()
        print(f"Available schemas: {schema_info['schema_count']}")
        
        conn.close()
        print("\n🎉 Database connectivity test PASSED!")
        return True
        
    except psycopg2.OperationalError as e:
        error_msg = str(e)
        print(f"\n❌ Database connection failed: {error_msg}")
        
        # Provide troubleshooting tips
        print("\n🔧 TROUBLESHOOTING TIPS:")
        if "could not connect to server" in error_msg:
            print("  • Check that PostgreSQL server is running")
            print("  • Verify POSTGRES_HOST and POSTGRES_PORT are correct")
            print("  • Check firewall/network settings")
        elif "password authentication failed" in error_msg:
            print("  • Verify POSTGRES_USER and POSTGRES_PASSWORD are correct")
            print("  • Check that the user exists in PostgreSQL")
            print("  • Verify user has permission to connect")
        elif "database" in error_msg and "does not exist" in error_msg:
            print("  • Verify POSTGRES_DB exists in your PostgreSQL server")
            print("  • Create the database if it doesn't exist")
            print("  • Check that the user has access to the database")
        else:
            print("  • Check your PostgreSQL server logs")
            print("  • Verify all connection parameters are correct")
        
        return False
        
    except Exception as e:
        print(f"\n❌ Unexpected error: {e}")
        print("\n🔧 TROUBLESHOOTING TIPS:")
        print("  • Check that all dependencies are properly installed")
        print("  • Verify your .env file format is correct")
        print("  • Try running: poetry install")
        return False


async def test_mcp_server_functionality():
    """Test basic MCP server functionality"""
    print_section("MCP Server Functionality Test")
    
    try:
        server = PostgresMCPServer()
        
        # Test list schemas
        print("Testing list_schemas...")
        schemas = await server.handle_list_schemas()
        assert len(schemas) == 1 and schemas[0].type == 'text'
        print("  ✅ list_schemas working")
        
        # Test basic query
        print("Testing basic query...")
        result = await server.handle_query({
            'sql': 'SELECT current_database() as db, current_user as user;'
        })
        assert len(result) == 1 and result[0].type == 'text'
        print("  ✅ Basic query working")
        
        # Test list tables
        print("Testing list_tables...")
        tables = await server.handle_list_tables({'schema': 'public'})
        assert len(tables) == 1 and tables[0].type == 'text'
        print("  ✅ list_tables working")
        
        print("\n🎉 MCP Server functionality test PASSED!")
        return True
        
    except Exception as e:
        print(f"\n❌ MCP Server functionality test failed: {e}")
        return False


def check_env_file():
    """Check if .env file exists and provide guidance"""
    print_section("Environment File Check")
    
    env_file = Path('.env')
    env_example = Path('.env.example')
    
    if env_file.exists():
        print("  ✅ .env file found")
        file_size = env_file.stat().st_size
        print(f"     File size: {file_size} bytes")
        
        if file_size == 0:
            print("  ⚠️  WARNING: .env file is empty")
            return False
    else:
        print("  ❌ .env file not found")
        print("\n📝 To create a .env file:")
        print("  1. Copy .env.example to .env (if available)")
        print("  2. Or create .env with the following content:")
        print()
        print("     POSTGRES_HOST=localhost")
        print("     POSTGRES_PORT=5432")
        print("     POSTGRES_USER=your_username")
        print("     POSTGRES_PASSWORD=your_password")
        print("     POSTGRES_DB=your_database")
        return False
    
    return True


def main():
    """Main function to run all connectivity checks"""
    print_header("PostgreSQL MCP Server Connectivity Test")
    print("This script will test your database connection and MCP server setup.")
    
    # Track test results
    results = {
        'dependencies': False,
        'env_file': False,
        'env_vars': False,
        'database': False,
        'mcp_server': False
    }
    
    # Run checks
    results['dependencies'] = check_dependencies()
    results['env_file'] = check_env_file()
    results['env_vars'] = check_environment_variables()
    
    if results['dependencies']:
        results['database'] = test_database_connection()
        
        if results['database']:
            # Import asyncio here to avoid issues if not available
            import asyncio
            results['mcp_server'] = asyncio.run(test_mcp_server_functionality())
    
    # Print summary
    print_header("Test Results Summary")
    
    for test_name, passed in results.items():
        status = "✅ PASS" if passed else "❌ FAIL"
        print(f"  {test_name.replace('_', ' ').title()}: {status}")
    
    total_tests = len(results)
    passed_tests = sum(results.values())
    
    print(f"\nOverall: {passed_tests}/{total_tests} tests passed")
    
    if passed_tests == total_tests:
        print("\n🎉 ALL TESTS PASSED!")
        print("Your PostgreSQL MCP Server is properly configured and ready to use.")
        print("\nNext steps:")
        print("  • Run 'poetry run postgres-mcp' to start the server")
        print("  • Configure your MCP client to use this server")
    else:
        print(f"\n⚠️  {total_tests - passed_tests} test(s) failed")
        print("Please address the issues above before using the MCP server.")
        
        if not results['dependencies']:
            print("\n🔧 To install dependencies:")
            print("  poetry install")
        
        if not results['env_file'] or not results['env_vars']:
            print("\n🔧 To configure environment:")
            print("  1. Create a .env file in your project root")
            print("  2. Add your PostgreSQL connection details")
        
        if not results['database']:
            print("\n🔧 To fix database connection:")
            print("  1. Ensure PostgreSQL is running")
            print("  2. Verify your connection details in .env")
            print("  3. Test connection with psql or another client")
    
    return passed_tests == total_tests


if __name__ == "__main__":
    try:
        success = main()
        sys.exit(0 if success else 1)
    except KeyboardInterrupt:
        print("\n\nTest interrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Unexpected error running connectivity test: {e}")
        sys.exit(1)

