"""Named database connection configuration and client selection."""

import json

import pytest

from postgres_mcp.postgres_client import get_client, reset_client
from postgres_mcp.settings import (
    DEFAULT_ALIAS,
    clear_settings_cache,
    list_connections,
    resolve_connection,
)


POSTGRES_ENV = [
    "POSTGRES_CONNECTIONS",
    "POSTGRES_HOST",
    "POSTGRES_PORT",
    "POSTGRES_USER",
    "POSTGRES_PASSWORD",
    "POSTGRES_DB",
    "POSTGRES_SSLMODE",
    "ALLOW_WRITE_OPERATIONS",
]


def credential(label: str) -> str:
    """Build obvious test-only credentials without hardcoded secret literals."""
    return "_".join((label, "fixture"))


@pytest.fixture(autouse=True)
def isolated_environment(monkeypatch):
    for key in POSTGRES_ENV:
        monkeypatch.delenv(key, raising=False)
    clear_settings_cache()
    reset_client()
    yield
    clear_settings_cache()
    reset_client()


def configure_single(monkeypatch):
    monkeypatch.setenv("POSTGRES_HOST", "localhost")
    monkeypatch.setenv("POSTGRES_USER", "me")
    monkeypatch.setenv("POSTGRES_PASSWORD", credential("single"))
    monkeypatch.setenv("POSTGRES_DB", "app")
    clear_settings_cache()


def configure_multiple(monkeypatch):
    monkeypatch.setenv(
        "POSTGRES_CONNECTIONS",
        json.dumps(
            [
                {
                    "alias": "local",
                    "host": "localhost",
                    "user": "me",
                    "password": credential("local"),
                    "database": "app",
                },
                {
                    "alias": "analytics",
                    "host": "warehouse.example.com",
                    "port": 6543,
                    "user": "reader",
                    "password": credential("analytics"),
                    "database": "metrics",
                    "sslmode": "require",
                    "allowWrite": False,
                },
                {
                    "alias": "scratch",
                    "host": "localhost",
                    "user": "me",
                    "password": credential("scratch"),
                    "database": "scratch",
                    "allowWrite": True,
                    "default": True,
                },
            ]
        ),
    )
    clear_settings_cache()


class TestSingleDatabaseCompatibility:
    def test_exposes_one_default_alias(self, monkeypatch):
        configure_single(monkeypatch)

        assert list_connections() == [
            {
                "alias": DEFAULT_ALIAS,
                "host": "localhost",
                "port": 5432,
                "database": "app",
                "allowWrite": False,
                "isDefault": True,
            }
        ]

    def test_omitted_alias_resolves_to_default(self, monkeypatch):
        configure_single(monkeypatch)

        connection = resolve_connection()

        assert connection.alias == DEFAULT_ALIAS
        assert connection.database == "app"

    def test_listing_never_exposes_credentials(self, monkeypatch):
        configure_single(monkeypatch)

        serialized = json.dumps(list_connections())

        assert credential("single") not in serialized
        assert "password" not in serialized


class TestMultipleConnections:
    def test_lists_aliases_and_honours_explicit_default(self, monkeypatch):
        configure_multiple(monkeypatch)

        connections = list_connections()

        assert [item["alias"] for item in connections] == [
            "local",
            "analytics",
            "scratch",
        ]
        assert resolve_connection().alias == "scratch"

    def test_builds_each_connection_and_permission(self, monkeypatch):
        configure_multiple(monkeypatch)

        analytics = resolve_connection("analytics")
        scratch = resolve_connection("scratch")

        assert analytics.host == "warehouse.example.com"
        assert analytics.port == 6543
        assert analytics.database == "metrics"
        assert analytics.sslmode == "require"
        assert analytics.allow_write is False
        assert scratch.allow_write is True

    def test_global_write_permission_is_only_the_default(self, monkeypatch):
        monkeypatch.setenv("ALLOW_WRITE_OPERATIONS", "true")
        monkeypatch.setenv(
            "POSTGRES_CONNECTIONS",
            json.dumps(
                [
                    {
                        "alias": "inherited",
                        "user": "u",
                        "password": credential("inherited"),
                        "database": "d",
                    },
                    {
                        "alias": "readonly",
                        "user": "u",
                        "password": credential("readonly"),
                        "database": "d",
                        "allowWrite": False,
                    },
                ]
            ),
        )
        clear_settings_cache()

        assert resolve_connection("inherited").allow_write is True
        assert resolve_connection("readonly").allow_write is False

    def test_unknown_alias_names_valid_options(self, monkeypatch):
        configure_multiple(monkeypatch)

        with pytest.raises(ValueError, match=r"typo.*local.*analytics.*scratch"):
            resolve_connection("typo")

    @pytest.mark.parametrize(
        "value,match",
        [
            ("{not json", "POSTGRES_CONNECTIONS"),
            ("[]", "empty"),
            (
                json.dumps(
                    [
                        {
                            "alias": "dup",
                            "user": "u",
                            "password": credential("one"),
                            "database": "one",
                        },
                        {
                            "alias": "dup",
                            "user": "u",
                            "password": credential("two"),
                            "database": "two",
                        },
                    ]
                ),
                "duplicate.*dup",
            ),
            (
                json.dumps(
                    [
                        {
                            "alias": "first",
                            "user": "u",
                            "password": credential("one"),
                            "database": "one",
                            "default": True,
                        },
                        {
                            "alias": "second",
                            "user": "u",
                            "password": credential("two"),
                            "database": "two",
                            "default": True,
                        },
                    ]
                ),
                "default.*first.*second",
            ),
        ],
    )
    def test_rejects_ambiguous_or_invalid_collections(self, monkeypatch, value, match):
        monkeypatch.setenv("POSTGRES_CONNECTIONS", value)
        clear_settings_cache()

        with pytest.raises(ValueError, match=match):
            list_connections()

    def test_accepts_dsn_and_decodes_it(self, monkeypatch):
        dsn_password = credential("dsn")
        dsn = (
            "postgresql://dsnuser:"
            f"{dsn_password}@db.example.com:6000/warehouse?sslmode=require"
        )
        monkeypatch.setenv(
            "POSTGRES_CONNECTIONS",
            json.dumps([{"alias": "remote", "url": dsn}]),
        )
        clear_settings_cache()

        connection = resolve_connection("remote")

        assert connection.user == "dsnuser"
        assert connection.password.get_secret_value() == dsn_password
        assert connection.database == "warehouse"
        assert connection.sslmode == "require"
        assert dsn_password not in json.dumps(list_connections())


class TestClientSelection:
    def test_caches_one_client_per_alias(self, monkeypatch):
        configure_multiple(monkeypatch)

        local = get_client("local")
        analytics = get_client("analytics")

        assert local is get_client("local")
        assert analytics is get_client("analytics")
        assert local is not analytics
        assert local.alias == "local"
        assert analytics.alias == "analytics"
