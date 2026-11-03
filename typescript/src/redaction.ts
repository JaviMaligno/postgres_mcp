/**
 * Personal-data redaction for query results and database error messages.
 *
 * Mirrors python/postgres_mcp/redaction.py — see that module for the full
 * rationale. Both implementations run against testdata/redaction_vectors.json
 * so they redact identically.
 *
 * Three independent, opt-in layers, configured globally or per connection:
 *
 * - Allow list (ALLOWED_COLUMNS / allowedColumns): only columns whose *source*
 *   matches a rule are returned. Computed columns, aggregates, UNIONs and
 *   whole-row references have no single source and are masked as
 *   `[REDACTED:not_allowed]`. Views are sources too.
 * - Deny list (REDACT_COLUMNS / redactColumns): matching columns are masked as
 *   `[REDACTED:column]`, matched on the source column (so an alias does not
 *   escape) and, for bare rules, on the result name.
 * - Pattern detection (REDACT_PII / redactPii): emails, phones, payment cards,
 *   IBANs, US SSNs, Spanish DNI/NIE, Aadhaar and PAN inside string values.
 *
 * The deny list and the detectors guard against accidents; the allow list
 * also withstands expressions like replace(email, '@', ' at '). None of them
 * stops a query from *using* a hidden column in WHERE. Database permissions
 * are the only full guarantee.
 */

import { SQLSTATE_NAMES } from './sqlstate.js';

export const REDACTED_COLUMN = '[REDACTED:column]';
export const REDACTED_NOT_ALLOWED = '[REDACTED:not_allowed]';
const RULE_PATTERN = /^[^.\s,]+(\.[^.\s,]+){0,2}$/;

/** [schema, table, column] */
export type Source = [string, string, string];

export interface RedactionPolicy {
  pii: boolean;
  /** Deny list. */
  columns: string[];
  /** Allow list; empty means not in use. */
  allowed: string[];
}

export const NO_REDACTION: RedactionPolicy = { pii: false, columns: [], allowed: [] };

export function policyEnabled(policy: RedactionPolicy): boolean {
  return policy.pii || policy.columns.length > 0 || policy.allowed.length > 0;
}

/** Whether column rules apply, so result columns need their sources. */
export function policyNeedsSources(policy: RedactionPolicy): boolean {
  return policy.columns.length > 0 || policy.allowed.length > 0;
}

/** Validate column rules given as a comma-separated string or a list. */
export function parseColumnRules(value: unknown, where: string): string[] {
  if (value === undefined || value === null || value === '') return [];
  let items: unknown[];
  if (typeof value === 'string') {
    items = value.split(',');
  } else if (Array.isArray(value)) {
    items = value;
  } else {
    throw new Error(`${where} must be a list of column rules`);
  }
  const rules: string[] = [];
  for (const item of items) {
    if (typeof item !== 'string') {
      throw new Error(`${where} must contain only strings`);
    }
    const rule = item.trim().toLowerCase();
    if (!rule) continue;
    if (!RULE_PATTERN.test(rule)) {
      throw new Error(
        `${where} has an invalid rule "${item}": use column, table.column or schema.table.column`
      );
    }
    rules.push(rule);
  }
  return rules;
}

// ==================== COLUMN RULES ====================

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function glob(pattern: string, value: string): boolean {
  const regex = new RegExp('^' + pattern.split('*').map(escapeRegex).join('.*') + '$', 's');
  return regex.test(value.toLowerCase());
}

/**
 * Whether a rule covers a source column. Result names are not consulted: the
 * query author chooses them, so an allow list must not trust them.
 */
export function sourceMatches(rule: string, source: Source): boolean {
  const parts = rule.split('.');
  const targets = source.slice(-parts.length);
  return parts.every((part, index) => glob(part, targets[index]));
}

/** Whether one rule covers a result column. */
export function ruleMatches(rule: string, name: string, source: Source | null): boolean {
  const parts = rule.split('.');
  if (parts.length === 1) {
    if (glob(parts[0], name)) return true;
    return source !== null && glob(parts[0], source[2]);
  }
  return source !== null && sourceMatches(rule, source);
}

export interface ColumnMeta {
  name: string;
  source: Source | null;
  /** Columns of a whole-row reference (SELECT c FROM customers c). */
  rowOf?: Source[] | null;
}

function denied(column: ColumnMeta, rules: string[]): boolean {
  if (rules.some((rule) => ruleMatches(rule, column.name, column.source))) return true;
  // A whole-row reference carries every column of the table.
  return (column.rowOf ?? []).some((member) => rules.some((rule) => sourceMatches(rule, member)));
}

function allowed(column: ColumnMeta, rules: string[]): boolean {
  const source = column.source;
  return source !== null && rules.some((rule) => sourceMatches(rule, source));
}

/**
 * Result column name -> replacement token, for every column to mask. Rows are
 * keyed by name, so a name is masked when any column carrying it must be.
 */
export function columnsToMask(columns: ColumnMeta[], policy: RedactionPolicy): Map<string, string> {
  const masked = new Map<string, string>();
  for (const column of columns) {
    if (policy.columns.length > 0 && denied(column, policy.columns)) {
      masked.set(column.name, REDACTED_COLUMN);
    } else if (policy.allowed.length > 0 && !allowed(column, policy.allowed)) {
      if (!masked.has(column.name)) masked.set(column.name, REDACTED_NOT_ALLOWED);
    }
  }
  return masked;
}

// ==================== PATTERN DETECTORS ====================

const DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';

const VERHOEFF_D = [
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
];
const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

// Issuer prefixes of the major card networks. Luhn alone passes one random
// number in ten.
const CARD_PREFIX = /^(?:4|5[1-5]|2[2-7]|3[47]|3(?:0[0-5]|[68])|35|6(?:011|5|4[4-9]))/;

const digits = (text: string): string => text.replace(/\D/g, '');
const separatorSet = (text: string, chars: RegExp): Set<string> =>
  new Set(text.match(chars) ?? []);

function luhn(number: string): boolean {
  let total = 0;
  [...number].reverse().forEach((char, index) => {
    let digit = Number(char);
    if (index % 2) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    total += digit;
  });
  return total % 10 === 0;
}

function verhoeff(number: string): boolean {
  let check = 0;
  [...number].reverse().forEach((char, index) => {
    check = VERHOEFF_D[check][VERHOEFF_P[index % 8][Number(char)]];
  });
  return check === 0;
}

function validIban(match: RegExpExecArray): boolean {
  const iban = match[0].replace(/ /g, '');
  if (iban.length < 15 || iban.length > 34) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    const value = parseInt(char, 36).toString();
    for (const d of value) remainder = (remainder * 10 + Number(d)) % 97;
  }
  return remainder === 1;
}

function validCard(match: RegExpExecArray): boolean {
  const text = match[0];
  if (separatorSet(text, /[ -]/g).size > 1) return false;
  const number = digits(text);
  return number.length >= 13 && number.length <= 19 && CARD_PREFIX.test(number) && luhn(number);
}

function validSsn(match: RegExpExecArray): boolean {
  const [, area, group, serial] = match;
  return area !== '000' && area !== '666' && !area.startsWith('9') && group !== '00' && serial !== '0000';
}

function validDni(match: RegExpExecArray): boolean {
  const prefix = match[1];
  let number = match[2];
  const letter = match[3];
  if (prefix) {
    if (number.length !== 7) return false;
    number = String('XYZ'.indexOf(prefix.toUpperCase())) + number;
  } else if (number.length !== 8) {
    return false;
  }
  return DNI_LETTERS[Number(number) % 23] === letter.toUpperCase();
}

function validAadhaar(match: RegExpExecArray): boolean {
  const text = match[0];
  if (separatorSet(text, /[ -]/g).size > 1) return false;
  return verhoeff(digits(text));
}

function isIpv4(groups: string[]): boolean {
  return groups.length === 4 && groups.every((g) => g.length <= 3 && Number(g) <= 255);
}

function validPhone(match: RegExpExecArray): boolean {
  const text = match[0];
  const count = digits(text).length;
  if (text.startsWith('+')) return count >= 8 && count <= 15;
  if (text.includes('(')) return count >= 9 && count <= 12;
  const separators = separatorSet(text, /[ .-]/g);
  if (separators.size !== 1) return false;
  if (count < 9 || count > 12) return false;
  const groups = text.split(/[ .-]/);
  // 3-2-4 with dashes is the SSN shape; the SSN detector owns it.
  if (separators.has('-') && groups.map((g) => g.length).join(',') === '3,2,4') return false;
  return !(separators.has('.') && isIpv4(groups));
}

const always = (): boolean => true;

// Lookarounds use explicit ASCII classes so that they behave exactly like the
// Python patterns (Python's \w is Unicode-aware, JavaScript's is not).
const DETECTORS: Array<[string, RegExp, (match: RegExpExecArray) => boolean]> = [
  [
    'email',
    /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![A-Za-z0-9-])/g,
    always,
  ],
  [
    'iban',
    /(?<![A-Za-z0-9])[A-Z]{2}[0-9]{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?(?![A-Za-z0-9])/g,
    validIban,
  ],
  ['credit_card', /(?<![A-Za-z0-9_+])[0-9](?:[ -]?[0-9]){12,18}(?![A-Za-z0-9_])/g, validCard],
  ['us_ssn', /(?<![A-Za-z0-9_-])([0-9]{3})-([0-9]{2})-([0-9]{4})(?![A-Za-z0-9_]|-[0-9])/g, validSsn],
  ['es_dni', /(?<![A-Za-z0-9_])([XYZxyz]?)([0-9]{7,8})-?([A-Za-z])(?![A-Za-z0-9_])/g, validDni],
  [
    'in_aadhaar',
    /(?<![A-Za-z0-9_+-])[2-9][0-9]{3}[ -]?[0-9]{4}[ -]?[0-9]{4}(?![A-Za-z0-9_])/g,
    validAadhaar,
  ],
  ['in_pan', /(?<![A-Za-z0-9_])[A-Z]{3}[ABCFGHLJPT][A-Z][0-9]{4}[A-Z](?![A-Za-z0-9_])/g, always],
  [
    'phone',
    /(?<![A-Za-z0-9_./:+-])(?:\+[0-9]{1,3}[ .-]?)?(?:\([0-9]{1,4}\)[ .-]?)?[0-9]{1,14}(?:[ .-][0-9]{1,14}){0,5}(?![A-Za-z0-9_/]|[.:-][0-9])/g,
    validPhone,
  ],
];

export type Counts = Record<string, number>;

function tally(counts: Counts, kind: string): void {
  counts[kind] = (counts[kind] ?? 0) + 1;
}

/** Replace every detected identifier in `text`; tally them in `counts`. */
export function redactText(text: string, counts: Counts): string {
  for (const [kind, pattern, isValid] of DETECTORS) {
    // Same semantics as Python's re.sub: non-overlapping matches, scanning
    // resumes after a rejected candidate too.
    let out = '';
    let last = 0;
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0;
      out += text.slice(last, start);
      if (isValid(match as RegExpExecArray)) {
        tally(counts, kind);
        out += `[REDACTED:${kind}]`;
      } else {
        out += match[0];
      }
      last = start + match[0].length;
    }
    text = out + text.slice(last);
  }
  return text;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Pattern-redact strings, including those nested in JSON values. */
export function redactValue(value: unknown, counts: Counts): unknown {
  if (typeof value === 'string') return redactText(value, counts);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, counts));
  if (isPlainObject(value)) {
    // Keys too: {"ana@corp.es": "owner"} is personal data in the key.
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [redactText(key, counts), redactValue(item, counts)])
    );
  }
  return value;
}

/** Apply `policy` to result rows. Returns the new rows and the tallies. */
export function redactRows(
  rows: Record<string, unknown>[],
  columns: ColumnMeta[],
  policy: RedactionPolicy
): { rows: Record<string, unknown>[]; counts: Counts } {
  const counts: Counts = {};
  if (!policyEnabled(policy)) return { rows, counts };
  const masked = columnsToMask(columns, policy);
  const result = rows.map((row) => {
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      const token = masked.get(key);
      if (token !== undefined) {
        if (value !== null && value !== undefined) {
          tally(counts, token.slice('[REDACTED:'.length, -1));
          next[key] = token;
        } else {
          next[key] = value;
        }
      } else if (policy.pii) {
        next[key] = redactValue(value, counts);
      } else {
        next[key] = value;
      }
    }
    return next;
  });
  return { rows: result, counts };
}

// ==================== ERROR MESSAGES ====================

// PostgreSQL repeats values in error messages in more shapes than any rewriter
// can enumerate (current_setting(col) dumps a column into "unrecognized
// configuration parameter", numbers appear unquoted in range errors). So with
// an allow list an error names only its condition; otherwise only the primary
// message is kept, with every quoted string masked, newlines included. See
// the Python module for the full list of shapes.
// From the first quote to the last: a value can itself contain quotes
// ("Ana "La Jefa" Garcia"), so pairing them would leak its middle.
const QUOTED = /"[\s\S]*"/g;
// (?![\s\S]) is end-of-input in both Python and JavaScript ($ is not).
const KEY_VALUES =
  /(Key \([^)]*\)=\().*?(\)(?: already exists| is not present| is still referenced|\.|(?![\s\S])))/gs;
const FAILING_ROW = /(Failing row contains \().*(\))/gs;

/** PostgreSQL condition name for a SQLSTATE, e.g. 42P01 -> undefined_table. */
export function conditionName(sqlstate?: string): string | undefined {
  return sqlstate ? SQLSTATE_NAMES[sqlstate] : undefined;
}

function condition(sqlstate?: string): string {
  const name = conditionName(sqlstate);
  if (name && sqlstate) return `${name}, SQLSTATE ${sqlstate}`;
  return sqlstate ? `SQLSTATE ${sqlstate}` : 'unknown condition';
}

/**
 * Make a database error safe to show the model under `policy`. `message` must
 * be the primary message only. Returned unchanged when the policy is disabled.
 */
export function redactError(message: string, policy: RedactionPolicy, sqlstate?: string): string {
  if (!policyEnabled(policy)) return message;
  if (policy.allowed.length > 0) {
    return `${condition(sqlstate)} (error details hidden because an allow list is active)`;
  }
  message = message.replace(KEY_VALUES, '$1[REDACTED]$2');
  message = message.replace(FAILING_ROW, '$1[REDACTED]$2');
  message = message.replace(QUOTED, '"[REDACTED]"');
  if (policy.pii) message = redactText(message, {});
  return sqlstate ? `${message} (${condition(sqlstate)})` : message;
}
