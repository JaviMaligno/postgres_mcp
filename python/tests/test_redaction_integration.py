"""Live redaction tests against the seeded sample database.

``support_tickets`` (scripts/init_sample_db.sql) hides personal data where a
column name gives no hint: free text, columns called ``ref`` and ``c1``, nested
JSON and arrays. These tests pin down which layer catches what, through the
real ``query`` tool, so the result is what a model would actually receive.
"""

import datetime
import json
import os
from decimal import Decimal

import pytest

from postgres_mcp import server
from postgres_mcp.postgres_client import reset_client
from postgres_mcp.settings import clear_settings_cache

pytestmark = pytest.mark.skipif(
    not os.environ.get("POSTGRES_PASSWORD"),
    reason="Integration tests require PostgreSQL environment variables",
)

TICKETS = "SELECT * FROM support_tickets ORDER BY id"


@pytest.fixture
def configure(monkeypatch):
    def apply(**env):
        for name in ("REDACT_PII", "REDACT_COLUMNS", "ALLOWED_COLUMNS"):
            monkeypatch.delenv(name, raising=False)
        for name, value in env.items():
            monkeypatch.setenv(name, value)
        clear_settings_cache()
        reset_client()

    yield apply
    clear_settings_cache()
    reset_client()


def run(sql):
    result = server.query(sql)
    assert "error" not in result, result
    return result


def test_without_configuration_nothing_changes(configure):
    configure()
    result = run(TICKETS)
    assert "redacted" not in result
    assert result["rows"][0]["ref"] == "234567890124"
    assert "ana.garcia@corp.es" in result["rows"][0]["notes"]


class TestPatternDetection:
    def test_finds_personal_data_regardless_of_column_name(self, configure):
        configure(REDACT_PII="true")
        result = run(TICKETS)
        first, second = result["rows"]

        assert first["notes"] == (
            "Llamar a Ana al [REDACTED:phone] o escribir a [REDACTED:email]; "
            "DNI [REDACTED:es_dni]"
        )
        assert first["ref"] == "[REDACTED:in_aadhaar]"
        assert first["c1"] == "[REDACTED:phone]"
        assert first["extra"] == {
            "contact": {
                "alt_email": "[REDACTED:email]",
                "phones": ["[REDACTED:phone]"],
            },
            "priority": "high",
        }
        assert first["tags"] == ["vip", "iban:[REDACTED:iban]"]
        assert result["redacted"] == {
            "phone": 3,
            "email": 2,
            "es_dni": 1,
            "in_aadhaar": 1,
            "iban": 1,
        }

        # Values that are not personal data keep their type and content.
        assert first["subject"] == "Refund for order 100234567"
        assert first["email_verified"] is True
        assert first["amount"] == Decimal("1299.99")
        assert isinstance(first["created_at"], datetime.datetime)

    def test_ticket_without_personal_data_is_untouched(self, configure):
        configure(REDACT_PII="true")
        plain = run(TICKETS)["rows"][1]
        configure()
        assert plain == run(TICKETS)["rows"][1]

    def test_sample_tables_without_personal_data_are_untouched(self, configure):
        """False-positive measure over the rest of the sample database."""
        for table in ("products", "orders", "order_items"):
            configure()
            raw = run(f"SELECT * FROM {table} ORDER BY id")
            configure(REDACT_PII="true")
            redacted = run(f"SELECT * FROM {table} ORDER BY id")
            assert redacted["rows"] == raw["rows"], table
            assert redacted["redacted"] == {}, table

    def test_whole_rows_and_json_are_scanned(self, configure):
        configure(REDACT_PII="true")
        result = run(
            "SELECT t AS whole, row_to_json(t) AS j FROM support_tickets t WHERE id = 1"
        )
        row = result["rows"][0]
        assert "ana.garcia@corp.es" not in row["whole"]
        assert "[REDACTED:email]" in row["whole"]
        assert "ana.garcia@corp.es" not in json.dumps(row["j"])

    def test_transformed_values_escape_detection(self, configure):
        """Documented limit: the detectors see values, not intent."""
        configure(REDACT_PII="true")
        row = run(
            "SELECT replace(notes, '@', ' at ') AS n FROM support_tickets WHERE id = 1"
        )["rows"][0]
        assert "ana.garcia at corp.es" in row["n"]


class TestDenyList:
    def test_masks_whole_columns(self, configure):
        configure(REDACT_COLUMNS="notes,ref")
        first = run(TICKETS)["rows"][0]
        assert first["notes"] == "[REDACTED:column]"
        assert first["ref"] == "[REDACTED:column]"
        # Not listed, so returned as is: a deny list only knows names.
        assert first["c1"] == "(555) 123-4567"

    def test_follows_aliases_subqueries_and_ctes(self, configure):
        configure(REDACT_COLUMNS="support_tickets.notes")
        for sql in (
            "SELECT notes AS x FROM support_tickets WHERE id = 1",
            "SELECT x FROM (SELECT notes AS x FROM support_tickets) s LIMIT 1",
            # Wrapped: a statement starting with WITH returns no rows here.
            "SELECT * FROM (WITH c AS (SELECT notes FROM support_tickets) "
            "SELECT notes AS y FROM c LIMIT 1) s",
            "SELECT t.notes::text AS z FROM support_tickets t "
            "JOIN support_tickets u ON u.id = t.id LIMIT 1",
        ):
            row = run(sql)["rows"][0]
            assert list(row.values()) == ["[REDACTED:column]"], sql

    def test_masks_whole_row_references(self, configure):
        configure(REDACT_COLUMNS="support_tickets.notes")
        row = run("SELECT t FROM support_tickets t WHERE id = 1")["rows"][0]
        assert row["t"] == "[REDACTED:column]"

    def test_name_patterns_do_not_mask_unrelated_names(self, configure):
        configure(REDACT_COLUMNS="email")
        assert run(TICKETS)["rows"][0]["email_verified"] is True

    def test_computed_columns_escape_a_deny_list(self, configure):
        """Documented limit: an expression has no source column to match."""
        configure(REDACT_COLUMNS="support_tickets.notes")
        row = run("SELECT upper(notes) AS n FROM support_tickets WHERE id = 1")["rows"][
            0
        ]
        assert "ANA.GARCIA@CORP.ES" in row["n"]


class TestAllowList:
    def test_returns_only_listed_columns(self, configure):
        configure(ALLOWED_COLUMNS="support_tickets.id,support_tickets.subject")
        result = run(TICKETS)
        first = result["rows"][0]
        assert first["id"] == 1
        assert first["subject"] == "Refund for order 100234567"
        for column in ("notes", "ref", "c1", "extra", "tags", "amount", "created_at"):
            assert first[column] == "[REDACTED:not_allowed]", column
        assert result["redacted"]["not_allowed"] > 0

    def test_blocks_the_bypasses_of_the_other_layers(self, configure):
        configure(ALLOWED_COLUMNS="support_tickets.id,support_tickets.subject")
        for sql in (
            "SELECT replace(notes, '@', ' at ') AS subject FROM support_tickets",
            "SELECT notes AS subject FROM support_tickets",
            "SELECT t AS subject FROM support_tickets t",
            "SELECT subject FROM support_tickets UNION ALL SELECT notes FROM support_tickets",
            "SELECT (SELECT notes FROM support_tickets LIMIT 1) AS subject",
            "SELECT length(notes) AS subject FROM support_tickets",
        ):
            for row in run(sql)["rows"]:
                assert row["subject"] == "[REDACTED:not_allowed]", sql

    def test_aliases_of_allowed_columns_pass(self, configure):
        configure(ALLOWED_COLUMNS="support_tickets.subject")
        row = run("SELECT subject AS s FROM support_tickets WHERE id = 1")["rows"][0]
        assert row["s"] == "Refund for order 100234567"

    def test_aggregates_need_an_allowed_view(self, configure):
        configure(ALLOWED_COLUMNS="ticket_counts.n")
        assert run("SELECT count(*) AS n FROM support_tickets")["rows"][0]["n"] == (
            "[REDACTED:not_allowed]"
        )
        assert run("SELECT n FROM ticket_counts")["rows"][0]["n"] == 2

    def test_allowed_columns_are_still_scanned_when_detection_is_on(self, configure):
        configure(ALLOWED_COLUMNS="support_tickets.notes", REDACT_PII="true")
        row = run("SELECT notes FROM support_tickets WHERE id = 1")["rows"][0]
        assert "[REDACTED:email]" in row["notes"]


class TestErrors:
    def test_values_echoed_in_errors_are_redacted(self, configure):
        configure(REDACT_COLUMNS="support_tickets.notes")
        result = server.query("SELECT notes::int FROM support_tickets WHERE id = 1")
        assert "error" in result
        assert "ana.garcia" not in result["error"]
        assert '"[REDACTED]"' in result["error"]

    def test_errors_are_unchanged_without_configuration(self, configure):
        configure()
        result = server.query("SELECT notes::int FROM support_tickets WHERE id = 1")
        assert "ana.garcia@corp.es" in result["error"]

    def test_explain_analyze_errors_are_redacted(self, configure):
        configure(REDACT_PII="true")
        result = server.explain_query(
            "SELECT notes::int FROM support_tickets WHERE id = 1", analyze=True
        )
        assert "error" in result
        assert "ana.garcia" not in result["error"]


def test_per_connection_policy_overrides_the_global_one(configure, monkeypatch):
    connection = {
        "alias": "masked",
        "host": os.environ.get("POSTGRES_HOST", "localhost"),
        "port": int(os.environ.get("POSTGRES_PORT", "5432")),
        "user": os.environ["POSTGRES_USER"],
        "password": os.environ["POSTGRES_PASSWORD"],
        "database": os.environ.get("POSTGRES_DB", "postgres"),
        "allowedColumns": ["support_tickets.id"],
    }
    open_connection = {**connection, "alias": "open", "allowedColumns": []}
    monkeypatch.setenv(
        "POSTGRES_CONNECTIONS", json.dumps([connection, open_connection])
    )
    configure(REDACT_PII="true")

    masked = server.query(
        "SELECT ref FROM support_tickets WHERE id = 1", database="masked"
    )
    assert masked["rows"][0]["ref"] == "[REDACTED:not_allowed]"
    # "open" drops the allow list but inherits REDACT_PII from the environment.
    opened = server.query(
        "SELECT ref FROM support_tickets WHERE id = 1", database="open"
    )
    assert opened["rows"][0]["ref"] == "[REDACTED:in_aadhaar]"


def test_a_redaction_failure_withholds_the_result(configure, monkeypatch):
    """Fail closed: neither the rows nor the exception text reach the model."""
    from postgres_mcp import postgres_client

    def explode(*_args, **_kwargs):
        raise RuntimeError("boom while reading ana.garcia@corp.es")

    configure(REDACT_PII="true")
    monkeypatch.setattr(postgres_client, "redact_rows", explode)
    result = server.query("SELECT notes FROM support_tickets WHERE id = 1")
    assert "rows" not in result
    assert "withheld" in result["error"]
    assert "ana.garcia" not in result["error"]


class TestErrorChannel:
    """Errors repeat values in many shapes; none may carry data out."""

    ALLOWED = "support_tickets.id,support_tickets.subject"
    LEAKY = (
        # Dumps a whole column into "unrecognized configuration parameter".
        "SELECT current_setting(string_agg(notes, ',')) FROM support_tickets",
        "SELECT subject::regclass FROM support_tickets WHERE id = 2",
        "SELECT ('x' || chr(10) || notes)::int FROM support_tickets WHERE id = 1",
        # Numbers appear unquoted in range errors.
        "SELECT make_date(2020, 1, (amount * 100)::int) FROM support_tickets "
        "WHERE id = 1",
    )

    def test_allow_list_hides_error_details(self, configure):
        configure(ALLOWED_COLUMNS=self.ALLOWED)
        for sql in self.LEAKY:
            error = server.query(sql)["error"]
            assert "hidden because an allow list is active" in error, sql
            for secret in ("ana", "Ana", "Monitor", "129999"):
                assert secret not in error, (sql, error)

    def test_condition_name_is_kept_so_the_model_can_fix_its_sql(self, configure):
        configure(ALLOWED_COLUMNS=self.ALLOWED)
        error = server.query("SELECT nope FROM support_tickets")["error"]
        assert "undefined_column, SQLSTATE 42703" in error

    def test_detail_and_context_lines_never_leave(self, configure):
        configure(REDACT_COLUMNS="support_tickets.notes")
        error = server.query("SELECT notes::jsonb FROM support_tickets WHERE id = 1")[
            "error"
        ]
        assert "ana.garcia" not in error
        assert "DETAIL" not in error and "CONTEXT" not in error
        assert "invalid_text_representation" in error


class TestReadOnlyUnderRedaction:
    def test_temp_tables_cannot_shadow_an_allowed_table(self, configure):
        configure(ALLOWED_COLUMNS="support_tickets.id")
        created = server.query(
            "SELECT notes AS id INTO TEMP support_tickets FROM public.support_tickets"
        )
        assert "error" in created
        assert "read_only_sql_transaction" in created["error"]
        ids = [
            row["id"]
            for row in run("SELECT id FROM support_tickets ORDER BY id")["rows"]
        ]
        assert ids == [1, 2]

    def test_data_modifying_ctes_are_refused(self, configure):
        configure(REDACT_PII="true")
        result = server.query(
            "WITH u AS (UPDATE support_tickets SET subject = subject RETURNING 1) "
            "SELECT 1"
        )
        assert "error" in result

    def test_without_redaction_reads_are_not_forced_read_only(self, configure):
        """Opt-in: nothing configured, nothing changes (nextval keeps working)."""
        configure()
        assert run("SELECT nextval('customers_id_seq') > 0 AS ok")["rows"] == [
            {"ok": True}
        ]
        configure(REDACT_PII="true")
        refused = server.query("SELECT nextval('customers_id_seq') > 0 AS ok")
        assert "read_only_sql_transaction" in refused["error"]


def test_multiple_statements_cannot_leave_the_read_only_transaction(configure):
    configure(ALLOWED_COLUMNS="support_tickets.subject")
    for sql in (
        "SELECT 1; COMMIT; UPDATE support_tickets SET subject = notes WHERE id = 2",
        "SET TRANSACTION READ WRITE; UPDATE support_tickets SET subject = notes "
        "WHERE id = 2",
    ):
        assert "error" in server.query(sql), sql
    configure()
    subject = run("SELECT subject FROM support_tickets WHERE id = 2")["rows"][0]
    assert subject == {"subject": "Monitor flickering"}
