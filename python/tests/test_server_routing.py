from types import SimpleNamespace

from postgres_mcp import server


class FakeClient:
    def __init__(self, allow_write=False):
        self.allow_write = allow_write
        self.calls = []

    def get_database_info(self):
        return {"database": "selected"}

    def execute_query(self, sql, **kwargs):
        self.calls.append((sql, kwargs))
        return {"row_count": 1, "message": "ok"}


def test_database_info_routes_to_requested_alias(monkeypatch):
    selected = []
    fake = FakeClient()
    monkeypatch.setattr(
        server,
        "get_client",
        lambda alias=None: selected.append(alias) or fake,
    )

    assert server.get_database_info(database="analytics") == {"database": "selected"}
    assert selected == ["analytics"]


def test_execute_uses_selected_connection_write_permission(monkeypatch):
    readonly = FakeClient(allow_write=False)
    monkeypatch.setattr(server, "get_client", lambda alias=None: readonly)
    monkeypatch.setattr(
        server,
        "get_settings",
        lambda: SimpleNamespace(allow_write_operations=True),
    )

    result = server.execute("DELETE FROM events", database="analytics")

    assert result["success"] is False
    assert readonly.calls == []


def test_execute_allows_connection_even_if_legacy_default_is_readonly(monkeypatch):
    writable = FakeClient(allow_write=True)
    monkeypatch.setattr(server, "get_client", lambda alias=None: writable)
    monkeypatch.setattr(
        server,
        "get_settings",
        lambda: SimpleNamespace(allow_write_operations=False),
    )

    result = server.execute("DELETE FROM scratch", database="scratch")

    assert result == {"success": True, "row_count": 1, "message": "ok"}
    assert writable.calls == [("DELETE FROM scratch", {"allow_write": True})]


def test_list_databases_does_not_open_a_connection(monkeypatch):
    monkeypatch.setattr(
        server,
        "list_connections",
        lambda: [
            {
                "alias": "prod",
                "host": "example.test",
                "port": 5432,
                "database": "main",
                "allowWrite": False,
                "isDefault": True,
            }
        ],
    )
    monkeypatch.setattr(
        server,
        "get_client",
        lambda alias=None: (_ for _ in ()).throw(AssertionError("connected")),
    )

    result = server.list_databases()

    assert result["default"] == "prod"
    assert "password" not in str(result).lower()
