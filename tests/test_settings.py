"""Tests for postgres_mcp.settings module."""

import os
import pytest

from postgres_mcp.settings import Settings, get_settings, clear_settings_cache


class TestSettings:
    """Tests for Settings class."""
    
    def test_default_values(self, monkeypatch):
        """Settings should have sensible defaults."""
        # Clear any existing env vars that could interfere
        for var in ["POSTGRES_DB", "POSTGRES_SSLMODE", "POSTGRES_HOST", "POSTGRES_PORT",
                    "POSTGRES_USER", "POSTGRES_PASSWORD", "ALLOW_WRITE_OPERATIONS",
                    "QUERY_TIMEOUT", "MAX_ROWS"]:
            monkeypatch.delenv(var, raising=False)
        
        settings = Settings(
            postgres_host="localhost",
            postgres_user="test",
            postgres_password="test",
            _env_file=None,  # Disable .env file reading
        )
        assert settings.postgres_host == "localhost"
        assert settings.postgres_port == 5432
        assert settings.postgres_db == "postgres"
        assert settings.postgres_sslmode == "prefer"
        assert settings.allow_write_operations is False
        assert settings.query_timeout == 30
        assert settings.max_rows == 1000
    
    def test_custom_values(self):
        """Settings should accept custom values."""
        settings = Settings(
            postgres_host="myhost",
            postgres_port=5433,
            postgres_user="myuser",
            postgres_password="mypass",
            postgres_db="mydb",
            postgres_sslmode="require",
            allow_write_operations=True,
            query_timeout=60,
            max_rows=500,
        )
        assert settings.postgres_host == "myhost"
        assert settings.postgres_port == 5433
        assert settings.postgres_db == "mydb"
        assert settings.postgres_sslmode == "require"
        assert settings.allow_write_operations is True
        assert settings.query_timeout == 60
        assert settings.max_rows == 500
    
    def test_port_validation(self):
        """Port should be validated."""
        with pytest.raises(ValueError, match="Port must be between"):
            Settings(
                postgres_host="localhost",
                postgres_user="test",
                postgres_password="test",
                postgres_port=0,
            )
        
        with pytest.raises(ValueError, match="Port must be between"):
            Settings(
                postgres_host="localhost",
                postgres_user="test",
                postgres_password="test",
                postgres_port=70000,
            )
    
    def test_timeout_clamped(self):
        """Timeout should be clamped to valid range."""
        settings = Settings(
            postgres_host="localhost",
            postgres_user="test",
            postgres_password="test",
            query_timeout=0,
        )
        assert settings.query_timeout == 1  # Clamped to minimum
        
        settings = Settings(
            postgres_host="localhost",
            postgres_user="test",
            postgres_password="test",
            query_timeout=500,
        )
        assert settings.query_timeout == 300  # Clamped to maximum
    
    def test_max_rows_clamped(self):
        """Max rows should be clamped to valid range."""
        settings = Settings(
            postgres_host="localhost",
            postgres_user="test",
            postgres_password="test",
            max_rows=0,
        )
        assert settings.max_rows == 1  # Clamped to minimum
        
        settings = Settings(
            postgres_host="localhost",
            postgres_user="test",
            postgres_password="test",
            max_rows=1000000,
        )
        assert settings.max_rows == 100000  # Clamped to maximum
    
    def test_password_is_secret(self):
        """Password should be stored as SecretStr."""
        settings = Settings(
            postgres_host="localhost",
            postgres_user="test",
            postgres_password="supersecret",
        )
        # Should not reveal password when converted to string
        assert "supersecret" not in str(settings.postgres_password)
        # But should be accessible via get_secret_value()
        assert settings.postgres_password.get_secret_value() == "supersecret"
    
    def test_connection_string(self):
        """Connection string should be properly formatted."""
        settings = Settings(
            postgres_host="myhost",
            postgres_port=5433,
            postgres_user="myuser",
            postgres_password="mypass",
            postgres_db="mydb",
            postgres_sslmode="require",
        )
        conn_str = settings.get_connection_string()
        assert "postgresql://myuser:mypass@myhost:5433/mydb" in conn_str
        assert "sslmode=require" in conn_str
    
    def test_connection_dict(self):
        """Connection dict should have all required keys."""
        settings = Settings(
            postgres_host="myhost",
            postgres_port=5433,
            postgres_user="myuser",
            postgres_password="mypass",
            postgres_db="mydb",
        )
        conn_dict = settings.get_connection_dict()
        assert conn_dict["host"] == "myhost"
        assert conn_dict["port"] == 5433
        assert conn_dict["user"] == "myuser"
        assert conn_dict["password"] == "mypass"
        assert conn_dict["database"] == "mydb"


class TestGetSettings:
    """Tests for get_settings function."""
    
    def test_caching(self, monkeypatch):
        """Settings should be cached."""
        monkeypatch.setenv("POSTGRES_HOST", "host1")
        monkeypatch.setenv("POSTGRES_USER", "user1")
        monkeypatch.setenv("POSTGRES_PASSWORD", "pass1")
        
        clear_settings_cache()
        settings1 = get_settings()
        
        # Change env var, but cached settings should be returned
        monkeypatch.setenv("POSTGRES_HOST", "host2")
        settings2 = get_settings()
        
        assert settings1 is settings2
        assert settings1.postgres_host == "host1"
    
    def test_cache_clear(self, monkeypatch):
        """Clearing cache should reload settings."""
        monkeypatch.setenv("POSTGRES_HOST", "host1")
        monkeypatch.setenv("POSTGRES_USER", "user1")
        monkeypatch.setenv("POSTGRES_PASSWORD", "pass1")
        
        clear_settings_cache()
        settings1 = get_settings()
        assert settings1.postgres_host == "host1"
        
        # Clear cache and change env var
        clear_settings_cache()
        monkeypatch.setenv("POSTGRES_HOST", "host2")
        settings2 = get_settings()
        
        assert settings1 is not settings2
        assert settings2.postgres_host == "host2"
