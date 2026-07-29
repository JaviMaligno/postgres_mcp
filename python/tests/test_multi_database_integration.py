"""Live multi-database routing tests for any reachable PostgreSQL server."""

import json
import os
import uuid

import psycopg2
import pytest

from postgres_mcp.postgres_client import get_client, reset_client
from postgres_mcp.settings import clear_settings_cache, list_connections


pytestmark = pytest.mark.skipif(
    not os.environ.get("POSTGRES_PASSWORD"),
    reason="Integration tests require PostgreSQL environment variables",
)


def test_routes_named_aliases_to_distinct_databases(monkeypatch):
    host = os.environ["POSTGRES_HOST"]
    port = int(os.environ.get("POSTGRES_PORT", "5432"))
    user = os.environ["POSTGRES_USER"]
    password = os.environ["POSTGRES_PASSWORD"]
    primary_database = os.environ.get("POSTGRES_DB", "postgres")
    sslmode = os.environ.get("POSTGRES_SSLMODE", "prefer")
    secondary_database = f"mcp_alias_{uuid.uuid4().hex[:12]}"

    admin = psycopg2.connect(
        host=host,
        port=port,
        user=user,
        password=password,
        database=primary_database,
        sslmode=sslmode,
    )
    admin.autocommit = True
    with admin.cursor() as cursor:
        cursor.execute(f'CREATE DATABASE "{secondary_database}"')
    admin.close()

    try:
        monkeypatch.setenv(
            "POSTGRES_CONNECTIONS",
            json.dumps(
                [
                    {
                        "alias": "primary",
                        "host": host,
                        "port": port,
                        "user": user,
                        "password": password,
                        "database": primary_database,
                        "sslmode": sslmode,
                        "default": True,
                    },
                    {
                        "alias": "secondary",
                        "host": host,
                        "port": port,
                        "user": user,
                        "password": password,
                        "database": secondary_database,
                        "sslmode": sslmode,
                        "allowWrite": True,
                    },
                ]
            ),
        )
        clear_settings_cache()
        reset_client()

        primary = get_client().execute_query("SELECT current_database() AS name")
        secondary = get_client("secondary").execute_query(
            "SELECT current_database() AS name"
        )

        assert primary["rows"][0]["name"] == primary_database
        assert secondary["rows"][0]["name"] == secondary_database
        assert [item["alias"] for item in list_connections()] == [
            "primary",
            "secondary",
        ]
        assert get_client("secondary").allow_write is True
        assert get_client("primary").allow_write is False
    finally:
        reset_client()
        clear_settings_cache()
        cleanup = psycopg2.connect(
            host=host,
            port=port,
            user=user,
            password=password,
            database=primary_database,
            sslmode=sslmode,
        )
        cleanup.autocommit = True
        with cleanup.cursor() as cursor:
            cursor.execute(f'DROP DATABASE IF EXISTS "{secondary_database}"')
        cleanup.close()
