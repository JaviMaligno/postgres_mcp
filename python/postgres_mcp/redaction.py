"""Personal-data redaction for query results and database error messages.

Three independent, opt-in layers, configured globally or per connection:

* **Allow list** (``ALLOWED_COLUMNS`` / ``allowedColumns``): the strictest
  mode. Only columns whose *source* matches a rule are returned; everything
  else, including computed columns and aggregates (which have no source), is
  replaced by ``[REDACTED:not_allowed]``. Views are sources too, so an
  aggregate can be exposed by allow-listing a view that computes it.

* **Deny list** (``REDACT_COLUMNS`` / ``redactColumns``): every value of a
  matching column is replaced by ``[REDACTED:column]``. A rule is ``column``,
  ``table.column`` or ``schema.table.column``, case-insensitive, with ``*`` as
  a wildcard. Rules are checked against the column's *source* (resolved from
  the table OID PostgreSQL reports for each result column, so an alias such as
  ``SELECT email AS e`` does not escape) and, for bare rules, against the name
  the column has in the result.

* **Pattern detection** (``REDACT_PII`` / ``redactPii``): string values are
  scanned for emails, phone numbers, payment cards, IBANs, US SSNs, Spanish
  DNI/NIE, Indian Aadhaar and PAN numbers. Every identifier with a check digit
  (card, IBAN, DNI/NIE, Aadhaar) is only redacted when the check digit is
  valid, which keeps order numbers and other IDs readable.

The deny list and the detectors are guardrails against personal data reaching
the model by accident: an expression such as ``replace(email, '@', ' at ')``
defeats both. The allow list withstands that, but no output filter stops a
query from *using* a hidden column (``WHERE email LIKE 'a%'`` still answers
through the row count). Database permissions are the only full guarantee.

The TypeScript implementation (``typescript/src/redaction.ts``) mirrors this
module; ``testdata/redaction_vectors.json`` holds the cases both must pass.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Callable, Iterable, Optional

REDACTED_COLUMN = "[REDACTED:column]"
REDACTED_NOT_ALLOWED = "[REDACTED:not_allowed]"
RULE_PATTERN = re.compile(r"^[^.\s,]+(\.[^.\s,]+){0,2}$")

Source = tuple[str, str, str]  # (schema, table, column)


@dataclass(frozen=True)
class RedactionPolicy:
    """What to redact for one connection.

    ``columns`` is a deny list, ``allowed`` an allow list (empty = not in use).
    With an allow list, a result column is returned only when its source
    column matches one of the rules: computed columns, aggregates, UNIONs and
    whole-row references have no single source column and are masked.
    """

    pii: bool = False
    columns: tuple[str, ...] = field(default_factory=tuple)
    allowed: tuple[str, ...] = field(default_factory=tuple)

    @property
    def enabled(self) -> bool:
        return self.pii or bool(self.columns) or bool(self.allowed)

    @property
    def needs_sources(self) -> bool:
        """Whether column rules apply, so result columns need their sources."""
        return bool(self.columns) or bool(self.allowed)


def parse_column_rules(value: object, where: str) -> tuple[str, ...]:
    """Validate column rules given as a comma-separated string or a list."""
    if value is None or value == "":
        return ()
    if isinstance(value, str):
        items: Iterable[object] = value.split(",")
    elif isinstance(value, (list, tuple)):
        items = value
    else:
        raise ValueError(f"{where} must be a list of column rules")
    rules = []
    for item in items:
        if not isinstance(item, str):
            raise ValueError(f"{where} must contain only strings")
        rule = item.strip().lower()
        if not rule:
            continue
        if not RULE_PATTERN.fullmatch(rule):
            raise ValueError(
                f'{where} has an invalid rule "{item}": use column, '
                "table.column or schema.table.column"
            )
        rules.append(rule)
    return tuple(rules)


# ==================== COLUMN RULES ====================


def _glob(pattern: str, value: str) -> bool:
    regex = ".*".join(re.escape(part) for part in pattern.split("*"))
    # fullmatch, not ^...$: $ would also accept a trailing newline.
    return re.fullmatch(regex, value.lower(), re.DOTALL) is not None


def rule_matches(rule: str, name: str, source: Optional[Source]) -> bool:
    """Whether one rule covers a result column."""
    parts = rule.split(".")
    if len(parts) == 1:
        if _glob(parts[0], name):
            return True
        return source is not None and _glob(parts[0], source[2])
    return source is not None and source_matches(rule, source)


def source_matches(rule: str, source: Source) -> bool:
    """Whether a rule covers a source column. Result names are not consulted:
    the query author chooses them, so an allow list must not trust them."""
    parts = rule.split(".")
    targets = source[-len(parts) :]
    return all(_glob(p, t) for p, t in zip(parts, targets))


def _denied(column: dict[str, Any], rules: tuple[str, ...]) -> bool:
    if any(rule_matches(rule, column["name"], column.get("source")) for rule in rules):
        return True
    # A whole-row reference (SELECT c FROM customers c) carries every column
    # of the table, so it is denied when any of them is.
    return any(
        source_matches(rule, member)
        for member in column.get("row_of") or ()
        for rule in rules
    )


def _allowed(column: dict[str, Any], rules: tuple[str, ...]) -> bool:
    source = column.get("source")
    return source is not None and any(source_matches(rule, source) for rule in rules)


def columns_to_mask(
    columns: list[dict[str, Any]], policy: RedactionPolicy
) -> dict[str, str]:
    """Result column name -> replacement token, for every column to mask.

    ``columns`` holds, per result column, ``{"name": str, "source": (schema,
    table, column) | None, "row_of": [source, ...] | None}`` — ``row_of`` lists
    the columns of a whole-row reference. Rows are keyed by name, so a name is
    masked when any column carrying it must be.
    """
    masked: dict[str, str] = {}
    for column in columns:
        name = column["name"]
        if policy.columns and _denied(column, policy.columns):
            masked[name] = REDACTED_COLUMN
        elif policy.allowed and not _allowed(column, policy.allowed):
            masked.setdefault(name, REDACTED_NOT_ALLOWED)
    return masked


# ==================== PATTERN DETECTORS ====================

_DNI_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE"

_VERHOEFF_D = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
    [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
    [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
    [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
    [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
    [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
    [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
    [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
    [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
]
_VERHOEFF_P = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
    [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
    [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
    [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
    [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
    [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
    [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
]

# Issuer prefixes of the major card networks (Visa, Mastercard, Amex, Diners,
# Discover, JCB). Luhn alone passes one random number in ten.
_CARD_PREFIX = re.compile(
    r"^(?:4|5[1-5]|2[2-7]|3[47]|3(?:0[0-5]|[68])|35|6(?:011|5|4[4-9]))"
)


def _digits(text: str) -> str:
    return re.sub(r"\D", "", text)


def _luhn(number: str) -> bool:
    total = 0
    for index, char in enumerate(reversed(number)):
        digit = int(char)
        if index % 2:
            digit *= 2
            if digit > 9:
                digit -= 9
        total += digit
    return total % 10 == 0


def _verhoeff(number: str) -> bool:
    check = 0
    for index, char in enumerate(reversed(number)):
        check = _VERHOEFF_D[check][_VERHOEFF_P[index % 8][int(char)]]
    return check == 0


def _valid_email(match: re.Match[str]) -> bool:
    return True


def _valid_iban(match: re.Match[str]) -> bool:
    iban = match.group(0).replace(" ", "")
    if not 15 <= len(iban) <= 34:
        return False
    rearranged = iban[4:] + iban[:4]
    return int("".join(str(int(char, 36)) for char in rearranged)) % 97 == 1


def _valid_card(match: re.Match[str]) -> bool:
    text = match.group(0)
    separators = set(re.findall(r"[ -]", text))
    if len(separators) > 1:
        return False
    number = _digits(text)
    return (
        13 <= len(number) <= 19 and bool(_CARD_PREFIX.match(number)) and _luhn(number)
    )


def _valid_ssn(match: re.Match[str]) -> bool:
    area, group, serial = match.group(1), match.group(2), match.group(3)
    return (
        area not in ("000", "666")
        and not area.startswith("9")
        and group != "00"
        and serial != "0000"
    )


def _valid_dni(match: re.Match[str]) -> bool:
    prefix, number, letter = match.group(1), match.group(2), match.group(3)
    if prefix:
        if len(number) != 7:
            return False
        number = str("XYZ".index(prefix.upper())) + number
    elif len(number) != 8:
        return False
    return _DNI_LETTERS[int(number) % 23] == letter.upper()


def _valid_aadhaar(match: re.Match[str]) -> bool:
    text = match.group(0)
    if len(set(re.findall(r"[ -]", text))) > 1:
        return False
    return _verhoeff(_digits(text))


def _valid_pan(match: re.Match[str]) -> bool:
    return True


def _is_ipv4(groups: list[str]) -> bool:
    return len(groups) == 4 and all(len(g) <= 3 and int(g) <= 255 for g in groups)


def _valid_phone(match: re.Match[str]) -> bool:
    text = match.group(0)
    count = len(_digits(text))
    if text.startswith("+"):
        return 8 <= count <= 15
    if "(" in text:
        return 9 <= count <= 12
    separators = set(re.findall(r"[ .-]", text))
    if len(separators) != 1:
        return False
    if not 9 <= count <= 12:
        return False
    groups = re.split(r"[ .-]", text)
    # 3-2-4 with dashes is the SSN shape; the SSN detector owns it, and one it
    # rejected (area 000, 666 or 9xx) is not a phone number either.
    if separators == {"-"} and [len(g) for g in groups] == [3, 2, 4]:
        return False
    return not (separators == {"."} and _is_ipv4(groups))


# Lookarounds use explicit ASCII classes because Python's \w is Unicode-aware
# and JavaScript's is not; both implementations must agree character for
# character.
_DETECTORS: list[tuple[str, re.Pattern[str], Callable[[re.Match[str]], bool]]] = [
    (
        "email",
        re.compile(
            r"(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+"
            r"(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![A-Za-z0-9-])"
        ),
        _valid_email,
    ),
    (
        "iban",
        re.compile(
            r"(?<![A-Za-z0-9])[A-Z]{2}[0-9]{2}(?: ?[A-Z0-9]{4}){2,7}"
            r"(?: ?[A-Z0-9]{1,4})?(?![A-Za-z0-9])"
        ),
        _valid_iban,
    ),
    (
        "credit_card",
        re.compile(r"(?<![A-Za-z0-9_+])[0-9](?:[ -]?[0-9]){12,18}(?![A-Za-z0-9_])"),
        _valid_card,
    ),
    (
        "us_ssn",
        re.compile(
            r"(?<![A-Za-z0-9_-])([0-9]{3})-([0-9]{2})-([0-9]{4})"
            r"(?![A-Za-z0-9_]|-[0-9])"
        ),
        _valid_ssn,
    ),
    (
        "es_dni",
        re.compile(
            r"(?<![A-Za-z0-9_])([XYZxyz]?)([0-9]{7,8})-?([A-Za-z])(?![A-Za-z0-9_])"
        ),
        _valid_dni,
    ),
    (
        "in_aadhaar",
        re.compile(
            r"(?<![A-Za-z0-9_+-])[2-9][0-9]{3}[ -]?[0-9]{4}[ -]?[0-9]{4}"
            r"(?![A-Za-z0-9_])"
        ),
        _valid_aadhaar,
    ),
    (
        "in_pan",
        re.compile(
            r"(?<![A-Za-z0-9_])[A-Z]{3}[ABCFGHLJPT][A-Z][0-9]{4}[A-Z](?![A-Za-z0-9_])"
        ),
        _valid_pan,
    ),
    (
        "phone",
        re.compile(
            r"(?<![A-Za-z0-9_./:+-])(?:\+[0-9]{1,3}[ .-]?)?(?:\([0-9]{1,4}\)[ .-]?)?"
            r"[0-9]{1,14}(?:[ .-][0-9]{1,14}){0,5}"
            r"(?![A-Za-z0-9_/]|[.:-][0-9])"
        ),
        _valid_phone,
    ),
]


def _count(counts: dict[str, int], kind: str) -> None:
    counts[kind] = counts.get(kind, 0) + 1


def redact_text(text: str, counts: dict[str, int]) -> str:
    """Replace every detected identifier in ``text``; tally them in ``counts``."""
    for kind, pattern, is_valid in _DETECTORS:

        def replace(match: re.Match[str], kind: str = kind, is_valid=is_valid) -> str:
            if not is_valid(match):
                return match.group(0)
            _count(counts, kind)
            return f"[REDACTED:{kind}]"

        text = pattern.sub(replace, text)
    return text


def redact_value(value: Any, counts: dict[str, int]) -> Any:
    """Pattern-redact strings, including those nested in JSON values."""
    if isinstance(value, str):
        return redact_text(value, counts)
    if isinstance(value, list):
        return [redact_value(item, counts) for item in value]
    if isinstance(value, dict):
        # Keys too: {"ana@corp.es": "owner"} is personal data in the key.
        return {
            (redact_text(key, counts) if isinstance(key, str) else key): redact_value(
                item, counts
            )
            for key, item in value.items()
        }
    return value


def redact_rows(
    rows: list[dict[str, Any]],
    columns: list[dict[str, Any]],
    policy: RedactionPolicy,
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    """Apply ``policy`` to result rows. Returns the new rows and the tallies."""
    counts: dict[str, int] = {}
    if not policy.enabled:
        return rows, counts
    masked = columns_to_mask(columns, policy)
    result = []
    for row in rows:
        new_row = {}
        for key, value in row.items():
            if key in masked:
                if value is not None:
                    token = masked[key]
                    _count(counts, token[len("[REDACTED:") : -1])
                    value = token
            elif policy.pii:
                value = redact_value(value, counts)
            new_row[key] = value
        result.append(new_row)
    return result, counts


# ==================== ERROR MESSAGES ====================

# PostgreSQL repeats values in error messages in more shapes than any rewriter
# can enumerate: invalid input syntax for type integer: "<value>",
# unrecognized configuration parameter "<value>" (current_setting(col) dumps a
# column this way), date field value out of range: 2020-01-<number>, and the
# DETAIL and CONTEXT lines. So:
#   * with an allow list, an error says only which condition was raised;
#   * otherwise only the primary message is kept (callers pass it, never the
#     DETAIL or CONTEXT), with every quoted string masked, newlines included.
# Numbers outside quotes survive the second form: deny lists and detection
# guard against accidents, the allow list is the strict mode.
_QUOTED = re.compile(r'"[^"]*"')
# (?![\s\S]) is end-of-input in both Python and JavaScript ($ is not).
_KEY_VALUES = re.compile(
    r"(Key \([^)]*\)=\().*?"
    r"(\)(?: already exists| is not present| is still referenced|\.|(?![\s\S])))",
    re.DOTALL,
)
_FAILING_ROW = re.compile(r"(Failing row contains \().*(\))", re.DOTALL)


def condition_name(sqlstate: Optional[str]) -> Optional[str]:
    """PostgreSQL condition name for a SQLSTATE, e.g. 42P01 -> undefined_table."""
    if not sqlstate:
        return None
    from psycopg2 import errorcodes

    try:
        name = errorcodes.lookup(sqlstate)
    except KeyError:
        return None
    return name.lower() if isinstance(name, str) else None


def _condition(sqlstate: Optional[str]) -> str:
    name = condition_name(sqlstate)
    if name and sqlstate:
        return f"{name}, SQLSTATE {sqlstate}"
    return f"SQLSTATE {sqlstate}" if sqlstate else "unknown condition"


def redact_error(
    message: str, policy: RedactionPolicy, sqlstate: Optional[str] = None
) -> str:
    """Make a database error safe to show the model under ``policy``.

    ``message`` must be the primary message only. Returns it unchanged when
    the policy is disabled.
    """
    if not policy.enabled:
        return message
    if policy.allowed:
        return (
            f"{_condition(sqlstate)} (error details hidden because an allow list "
            "is active)"
        )
    message = _KEY_VALUES.sub(r"\1[REDACTED]\2", message)
    message = _FAILING_ROW.sub(r"\1[REDACTED]\2", message)
    message = _QUOTED.sub('"[REDACTED]"', message)
    if policy.pii:
        message = redact_text(message, {})
    return f"{message} ({_condition(sqlstate)})" if sqlstate else message
