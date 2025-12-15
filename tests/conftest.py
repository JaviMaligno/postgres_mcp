#!/usr/bin/env python3

"""
Pytest configuration and shared fixtures for postgres_mcp tests
"""

import os
import pytest
from unittest.mock import patch

from postgres_mcp.settings import Settings, clear_settings_cache
from postgres_mcp.postgres_client import PostgresClient


@pytest.fixture(autouse=True)
def reset_settings():
    """Reset settings cache before each test."""
    clear_settings_cache()
    yield
    clear_settings_cache()


@pytest.fixture
def clean_env():
    """Fixture that provides a clean environment for testing"""
    with patch.dict(os.environ, {}, clear=True):
        yield


@pytest.fixture
def mock_env():
    """Fixture that provides a mock environment with test database configuration"""
    test_env = {
        'POSTGRES_HOST': 'test_host',
        'POSTGRES_PORT': '5433',
        'POSTGRES_USER': 'test_user',
        'POSTGRES_PASSWORD': 'test_password',
        'POSTGRES_DB': 'test_database'
    }
    
    with patch.dict(os.environ, test_env):
        yield test_env


@pytest.fixture
def test_settings(mock_env) -> Settings:
    """Create a test Settings instance."""
    return Settings(
        postgres_host="localhost",
        postgres_port=5432,
        postgres_user="testuser",
        postgres_password="testpass",
        postgres_db="testdb",
    )


@pytest.fixture
def write_enabled_settings(mock_env) -> Settings:
    """Create Settings with write operations enabled."""
    return Settings(
        postgres_host="localhost",
        postgres_port=5432,
        postgres_user="testuser",
        postgres_password="testpass",
        postgres_db="testdb",
        allow_write_operations=True,
    )


@pytest.fixture
def postgres_client(mock_env):
    """Fixture that provides a PostgresClient instance with mocked environment"""
    settings = Settings(
        postgres_host=mock_env['POSTGRES_HOST'],
        postgres_port=int(mock_env['POSTGRES_PORT']),
        postgres_user=mock_env['POSTGRES_USER'],
        postgres_password=mock_env['POSTGRES_PASSWORD'],
        postgres_db=mock_env['POSTGRES_DB'],
    )
    return PostgresClient(settings)


@pytest.fixture
def real_postgres_client():
    """
    Fixture that provides a PostgresClient instance with real environment variables.
    Tests using this fixture will be skipped if no real database configuration is available.
    """
    # Check if we have real database configuration
    required_env_vars = ['POSTGRES_HOST', 'POSTGRES_USER', 'POSTGRES_PASSWORD']
    
    if not all(os.getenv(var) for var in required_env_vars):
        pytest.skip("Real database configuration not available")
    
    return PostgresClient()


def pytest_configure(config):
    """Configure pytest with custom markers"""
    config.addinivalue_line(
        "markers", "integration: mark test as an integration test requiring a real database"
    )
    config.addinivalue_line(
        "markers", "unit: mark test as a unit test"
    )
    config.addinivalue_line(
        "markers", "env_config: mark test as testing environment configuration"
    )


def pytest_collection_modifyitems(config, items):
    """Automatically mark tests based on their names and locations"""
    for item in items:
        # Mark tests that require real database connections
        if "real_database" in item.name or "integration" in item.name:
            item.add_marker(pytest.mark.integration)
        
        # Mark environment configuration tests
        if "env" in item.name or "test_env_config.py" in str(item.fspath):
            item.add_marker(pytest.mark.env_config)
        
        # Mark unit tests (most tests)
        if not hasattr(item, 'pytestmark') or not any(
            marker.name in ['integration'] for marker in getattr(item, 'pytestmark', [])
        ):
            item.add_marker(pytest.mark.unit)


# Test helper functions
def check_database_connectivity():
    """
    Helper function to check if a real database is available for testing.
    Returns True if database is accessible, False otherwise.
    """
    try:
        client = PostgresClient()
        with client.get_cursor() as cursor:
            cursor.execute("SELECT 1;")
            result = cursor.fetchone()
            return result is not None
    except Exception:
        return False


def get_test_database_config():
    """
    Helper function to get database configuration for testing.
    Returns None if no configuration is available.
    """
    required_vars = ['POSTGRES_HOST', 'POSTGRES_USER', 'POSTGRES_PASSWORD']
    
    if not all(os.getenv(var) for var in required_vars):
        return None
    
    return {
        'host': os.getenv('POSTGRES_HOST'),
        'port': int(os.getenv('POSTGRES_PORT', 5432)),
        'user': os.getenv('POSTGRES_USER'),
        'password': os.getenv('POSTGRES_PASSWORD'),
        'database': os.getenv('POSTGRES_DB', 'postgres')
    }


# Pytest command line options
def pytest_addoption(parser):
    """Add custom command line options"""
    parser.addoption(
        "--run-integration",
        action="store_true",
        default=False,
        help="run integration tests that require a real database"
    )
    parser.addoption(
        "--db-host",
        action="store",
        default=None,
        help="database host for integration tests"
    )
    parser.addoption(
        "--db-user",
        action="store", 
        default=None,
        help="database user for integration tests"
    )
    parser.addoption(
        "--db-password",
        action="store",
        default=None, 
        help="database password for integration tests"
    )


def pytest_runtest_setup(item):
    """Setup function run before each test"""
    # Skip integration tests unless explicitly requested
    if item.get_closest_marker("integration"):
        if not item.config.getoption("--run-integration"):
            pytest.skip("need --run-integration option to run integration tests")


# Custom assertion helpers
def assert_connection_config_valid(config):
    """Assert that a database connection config is valid"""
    required_keys = ['host', 'port', 'user', 'password', 'database']
    
    assert isinstance(config, dict), "Config must be a dictionary"
    
    for key in required_keys:
        assert key in config, f"Config missing required key: {key}"
    
    assert isinstance(config['port'], int), "Port must be an integer"
    assert config['port'] > 0, "Port must be positive"
    
    for key in ['host', 'user', 'password', 'database']:
        assert isinstance(config[key], str), f"{key} must be a string"
        assert len(config[key]) > 0, f"{key} cannot be empty"


def assert_textcontent_valid(content_list):
    """Assert that a list of TextContent objects is valid"""
    assert isinstance(content_list, list), "Content must be a list"
    assert len(content_list) > 0, "Content list cannot be empty"
    
    for content in content_list:
        assert hasattr(content, 'type'), "Content must have type attribute"
        assert hasattr(content, 'text'), "Content must have text attribute"
        assert content.type == 'text', "Content type must be 'text'"
        assert isinstance(content.text, str), "Content text must be a string"
