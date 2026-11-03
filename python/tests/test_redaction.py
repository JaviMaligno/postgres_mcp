"""Unit tests for personal-data redaction (no database needed)."""

import json
import random
from pathlib import Path

import pytest

from postgres_mcp.redaction import (
    RedactionPolicy,
    columns_to_mask,
    parse_column_rules,
    redact_error_message,
    redact_rows,
    redact_text,
    redact_value,
    rule_matches,
)

VECTORS = json.loads(
    (
        Path(__file__).resolve().parents[2] / "testdata" / "redaction_vectors.json"
    ).read_text(encoding="utf-8")
)


@pytest.mark.parametrize(
    "case", VECTORS["detect"], ids=[c["input"] for c in VECTORS["detect"]]
)
def test_shared_vector_is_redacted(case):
    counts: dict[str, int] = {}
    assert redact_text(case["input"], counts) == case["output"]
    assert counts == case["counts"]


@pytest.mark.parametrize("text", VECTORS["keep"])
def test_shared_vector_is_kept(text):
    counts: dict[str, int] = {}
    assert redact_text(text, counts) == text
    assert counts == {}


def test_redaction_is_idempotent():
    for case in VECTORS["detect"]:
        once = redact_text(case["input"], {})
        assert redact_text(once, {}) == once


def test_random_order_numbers_are_rarely_redacted():
    """Measure the false-positive rate on unformatted numeric identifiers.

    Plain digit runs are only redacted when they pass a check digit, so a
    random 8-11 digit ID never is, and a 12-digit one only when it happens to
    be a valid Aadhaar (about one in ten, by construction of Verhoeff).
    """
    rng = random.Random(1234)
    for length in (8, 9, 10, 11):
        for _ in range(500):
            number = str(rng.randint(10 ** (length - 1), 10**length - 1))
            assert redact_text(number, {}) == number
    twelve = [str(rng.randint(10**11, 10**12 - 1)) for _ in range(2000)]
    hit_rate = sum(redact_text(n, {}) != n for n in twelve) / len(twelve)
    assert hit_rate < 0.12


def test_redact_value_walks_json():
    counts: dict[str, int] = {}
    value = {"contact": {"emails": ["a@b.io", "plain"]}, "n": 3, "ok": True}
    assert redact_value(value, counts) == {
        "contact": {"emails": ["[REDACTED:email]", "plain"]},
        "n": 3,
        "ok": True,
    }
    assert counts == {"email": 1}


class TestColumnRules:
    def test_parse_accepts_string_and_list(self):
        assert parse_column_rules("Email, users.phone ,", "X") == (
            "email",
            "users.phone",
        )
        assert parse_column_rules(["public.users.ssn"], "X") == ("public.users.ssn",)
        assert parse_column_rules(None, "X") == ()
        assert parse_column_rules("", "X") == ()

    @pytest.mark.parametrize("bad", ["a.b.c.d", "a..b", ".a"])
    def test_parse_rejects_bad_rules(self, bad):
        with pytest.raises(ValueError, match="invalid rule"):
            parse_column_rules(bad, "REDACT_COLUMNS")

    def test_parse_rejects_non_strings(self):
        with pytest.raises(ValueError):
            parse_column_rules([1], "X")
        with pytest.raises(ValueError):
            parse_column_rules(5, "X")

    def test_bare_rule_matches_result_name_or_source_column(self):
        source = ("public", "customers", "email")
        assert rule_matches("email", "email", None)
        assert rule_matches("email", "e", source)  # SELECT email AS e
        assert rule_matches("*mail*", "contact_email", None)
        assert not rule_matches("email", "name", ("public", "customers", "name"))

    def test_qualified_rules_need_the_source(self):
        source = ("public", "customers", "email")
        assert rule_matches("customers.email", "e", source)
        assert rule_matches("public.customers.email", "email", source)
        assert rule_matches("public.*.email", "email", source)
        assert not rule_matches("orders.email", "email", source)
        assert not rule_matches("customers.email", "email", None)

    def test_matching_is_case_insensitive(self):
        assert rule_matches("email", "EMAIL", None)
        assert rule_matches("customers.email", "x", ("public", "Customers", "Email"))

    COLUMNS = [
        {"name": "id", "source": ("public", "customers", "id")},
        {"name": "contact", "source": ("public", "customers", "email")},
        {"name": "total", "source": None},
    ]

    def test_deny_list(self):
        assert columns_to_mask(
            self.COLUMNS, RedactionPolicy(columns=("customers.email",))
        ) == {"contact": "[REDACTED:column]"}
        assert columns_to_mask(self.COLUMNS, RedactionPolicy()) == {}

    def test_deny_list_covers_whole_row_references(self):
        # SELECT c FROM customers c returns every column as one composite.
        row = {
            "name": "c",
            "source": None,
            "row_of": [("public", "customers", "id"), ("public", "customers", "email")],
        }
        assert columns_to_mask([row], RedactionPolicy(columns=("email",))) == {
            "c": "[REDACTED:column]"
        }
        assert columns_to_mask([row], RedactionPolicy(columns=("phone",))) == {}

    def test_allow_list_masks_everything_not_listed(self):
        assert columns_to_mask(
            self.COLUMNS, RedactionPolicy(allowed=("customers.id",))
        ) == {
            "contact": "[REDACTED:not_allowed]",
            "total": "[REDACTED:not_allowed]",
        }

    def test_allow_list_ignores_result_names(self):
        # SELECT email AS id FROM customers must not pass as the allowed "id".
        renamed = [{"name": "id", "source": ("public", "customers", "email")}]
        assert columns_to_mask(renamed, RedactionPolicy(allowed=("id",))) == {
            "id": "[REDACTED:not_allowed]"
        }

    def test_allow_list_masks_computed_columns_and_whole_rows(self):
        computed = [
            {"name": "e", "source": None},  # replace(email, '@', ' at ')
            {"name": "c", "source": None, "row_of": [("public", "t", "id")]},
        ]
        assert set(columns_to_mask(computed, RedactionPolicy(allowed=("*",)))) == {
            "e",
            "c",
        }

    def test_allow_list_accepts_views_as_sources(self):
        view = [{"name": "n", "source": ("public", "v_order_totals", "n")}]
        assert (
            columns_to_mask(view, RedactionPolicy(allowed=("v_order_totals.*",))) == {}
        )

    def test_deny_beats_allow(self):
        policy = RedactionPolicy(columns=("email",), allowed=("customers.*",))
        assert columns_to_mask(self.COLUMNS, policy) == {
            "contact": "[REDACTED:column]",
            "total": "[REDACTED:not_allowed]",
        }


class TestRedactRows:
    COLUMNS = [
        {"name": "id", "source": ("public", "customers", "id")},
        {"name": "email", "source": ("public", "customers", "email")},
        {"name": "notes", "source": ("public", "customers", "notes")},
    ]
    ROWS = [
        {"id": 1, "email": "ana@corp.es", "notes": "call +34 600 123 456"},
        {"id": 2, "email": None, "notes": "nothing"},
    ]

    def test_disabled_policy_returns_rows_untouched(self):
        rows, counts = redact_rows(self.ROWS, self.COLUMNS, RedactionPolicy())
        assert rows == self.ROWS
        assert counts == {}

    def test_column_rules_mask_whole_values_but_keep_nulls(self):
        rows, counts = redact_rows(
            self.ROWS, self.COLUMNS, RedactionPolicy(columns=("email",))
        )
        assert rows[0]["email"] == "[REDACTED:column]"
        assert rows[1]["email"] is None
        assert rows[0]["notes"] == "call +34 600 123 456"
        assert counts == {"column": 1}

    def test_column_rules_mask_non_string_values(self):
        rows, _ = redact_rows(self.ROWS, self.COLUMNS, RedactionPolicy(columns=("id",)))
        assert [r["id"] for r in rows] == ["[REDACTED:column]", "[REDACTED:column]"]

    def test_pii_detection_scans_every_string(self):
        rows, counts = redact_rows(self.ROWS, self.COLUMNS, RedactionPolicy(pii=True))
        assert rows[0] == {
            "id": 1,
            "email": "[REDACTED:email]",
            "notes": "call [REDACTED:phone]",
        }
        assert counts == {"email": 1, "phone": 1}

    def test_allow_list_rows(self):
        rows, counts = redact_rows(
            self.ROWS, self.COLUMNS, RedactionPolicy(allowed=("customers.id",))
        )
        assert rows[0] == {
            "id": 1,
            "email": "[REDACTED:not_allowed]",
            "notes": "[REDACTED:not_allowed]",
        }
        assert counts == {"not_allowed": 3}

    def test_input_rows_are_not_mutated(self):
        original = [dict(r) for r in self.ROWS]
        redact_rows(self.ROWS, self.COLUMNS, RedactionPolicy(pii=True, columns=("id",)))
        assert self.ROWS == original


class TestErrorMessages:
    POLICY = RedactionPolicy(columns=("email",))

    def test_unique_violation_detail(self):
        message = (
            'duplicate key value violates unique constraint "customers_email_key"\n'
            "DETAIL:  Key (email)=(ana@corp.es) already exists."
        )
        assert redact_error_message(message, self.POLICY) == (
            'duplicate key value violates unique constraint "customers_email_key"\n'
            "DETAIL:  Key (email)=([REDACTED]) already exists."
        )

    def test_values_with_parentheses(self):
        message = "DETAIL:  Key (name, phone)=(Ana (work), 600) already exists."
        assert redact_error_message(message, self.POLICY) == (
            "DETAIL:  Key (name, phone)=([REDACTED]) already exists."
        )

    def test_failing_row(self):
        message = (
            'new row for relation "customers" violates check constraint "c"\n'
            "DETAIL:  Failing row contains (7, ana@corp.es, null)."
        )
        assert redact_error_message(message, self.POLICY).endswith(
            "Failing row contains ([REDACTED])."
        )

    def test_invalid_input_syntax(self):
        message = 'invalid input syntax for type integer: "ana@corp.es"'
        assert redact_error_message(message, self.POLICY) == (
            'invalid input syntax for type integer: "[REDACTED]"'
        )

    def test_pii_policy_also_scans_the_rest(self):
        message = "something mentioned ana@corp.es"
        assert redact_error_message(message, RedactionPolicy(pii=True)) == (
            "something mentioned [REDACTED:email]"
        )

    def test_messages_untouched_when_disabled(self):
        message = "DETAIL:  Key (email)=(ana@corp.es) already exists."
        assert redact_error_message(message, RedactionPolicy()) == message

    def test_identifiers_in_errors_survive(self):
        message = 'relation "customers" does not exist'
        assert redact_error_message(message, self.POLICY) == message


class TestSettings:
    BASE = {"POSTGRES_USER": "u", "POSTGRES_PASSWORD": "p", "POSTGRES_DB": "d"}

    def _connections(self, monkeypatch, env):
        from postgres_mcp.settings import clear_settings_cache, get_connections

        for name in (
            "REDACT_PII",
            "REDACT_COLUMNS",
            "ALLOWED_COLUMNS",
            "POSTGRES_CONNECTIONS",
        ):
            monkeypatch.delenv(name, raising=False)
        for name, value in {**self.BASE, **env}.items():
            monkeypatch.setenv(name, value)
        clear_settings_cache()
        return {c.alias: c for c in get_connections()}

    def test_off_by_default(self, monkeypatch):
        policy = self._connections(monkeypatch, {})["default"].redaction
        assert policy == RedactionPolicy()
        assert not policy.enabled

    def test_global_variables(self, monkeypatch):
        policy = self._connections(
            monkeypatch,
            {
                "REDACT_PII": "true",
                "REDACT_COLUMNS": "Email, customers.phone",
                "ALLOWED_COLUMNS": "customers.*",
            },
        )["default"].redaction
        assert policy == RedactionPolicy(
            pii=True, columns=("email", "customers.phone"), allowed=("customers.*",)
        )

    def test_connections_inherit_and_override(self, monkeypatch):
        connections = json.dumps(
            [
                {"alias": "inherits", "url": "postgresql://u:p@h/d"},
                {
                    "alias": "overrides",
                    "url": "postgresql://u:p@h/d",
                    "redactPii": False,
                    "redactColumns": ["ssn"],
                    "allowedColumns": ["public.orders.*"],
                },
            ]
        )
        found = self._connections(
            monkeypatch,
            {
                "POSTGRES_CONNECTIONS": connections,
                "REDACT_PII": "true",
                "REDACT_COLUMNS": "email",
            },
        )
        assert found["inherits"].redaction == RedactionPolicy(
            pii=True, columns=("email",)
        )
        assert found["overrides"].redaction == RedactionPolicy(
            pii=False, columns=("ssn",), allowed=("public.orders.*",)
        )

    @pytest.mark.parametrize(
        "entry, message",
        [
            ({"redactPii": "yes"}, "redactPii must be boolean"),
            ({"redactColumns": "a.b.c.d"}, "invalid rule"),
            ({"allowedColumns": [3]}, "only strings"),
        ],
    )
    def test_invalid_connection_policies_are_rejected(
        self, monkeypatch, entry, message
    ):
        connections = json.dumps(
            [{"alias": "x", "url": "postgresql://u:p@h/d", **entry}]
        )
        with pytest.raises(ValueError, match=message):
            self._connections(monkeypatch, {"POSTGRES_CONNECTIONS": connections})

    def test_invalid_global_rule_is_rejected(self, monkeypatch):
        with pytest.raises(ValueError, match="REDACT_COLUMNS"):
            self._connections(monkeypatch, {"REDACT_COLUMNS": "a.b.c.d"})
