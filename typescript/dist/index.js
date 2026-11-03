#!/usr/bin/env node

// src/index.ts
import { serveStdio } from "@modelcontextprotocol/server/stdio";

// src/settings.ts
import { z } from "zod";

// src/sqlstate.ts
var SQLSTATE_NAMES = {
  "00000": "successful_completion",
  "01000": "warning",
  "01003": "null_value_eliminated_in_set_function",
  "01004": "string_data_right_truncation",
  "01006": "privilege_not_revoked",
  "01007": "privilege_not_granted",
  "01008": "implicit_zero_bit_padding",
  "0100C": "dynamic_result_sets_returned",
  "01P01": "deprecated_feature",
  "02000": "no_data",
  "02001": "no_additional_dynamic_result_sets_returned",
  "03000": "sql_statement_not_yet_complete",
  "08000": "connection_exception",
  "08001": "sqlclient_unable_to_establish_sqlconnection",
  "08003": "connection_does_not_exist",
  "08004": "sqlserver_rejected_establishment_of_sqlconnection",
  "08006": "connection_failure",
  "08007": "transaction_resolution_unknown",
  "08P01": "protocol_violation",
  "09000": "triggered_action_exception",
  "0A000": "feature_not_supported",
  "0B000": "invalid_transaction_initiation",
  "0F000": "locator_exception",
  "0F001": "invalid_locator_specification",
  "0L000": "invalid_grantor",
  "0LP01": "invalid_grant_operation",
  "0P000": "invalid_role_specification",
  "0Z000": "diagnostics_exception",
  "0Z002": "stacked_diagnostics_accessed_without_active_handler",
  "10608": "invalid_argument_for_xquery",
  "20000": "case_not_found",
  "21000": "cardinality_violation",
  "22000": "data_exception",
  "22001": "string_data_right_truncation",
  "22002": "null_value_no_indicator_parameter",
  "22003": "numeric_value_out_of_range",
  "22004": "null_value_not_allowed",
  "22005": "error_in_assignment",
  "22007": "invalid_datetime_format",
  "22008": "datetime_field_overflow",
  "22009": "invalid_time_zone_displacement_value",
  "2200B": "escape_character_conflict",
  "2200C": "invalid_use_of_escape_character",
  "2200D": "invalid_escape_octet",
  "2200F": "zero_length_character_string",
  "2200G": "most_specific_type_mismatch",
  "2200H": "sequence_generator_limit_exceeded",
  "2200L": "not_an_xml_document",
  "2200M": "invalid_xml_document",
  "2200N": "invalid_xml_content",
  "2200S": "invalid_xml_comment",
  "2200T": "invalid_xml_processing_instruction",
  "22010": "invalid_indicator_parameter_value",
  "22011": "substring_error",
  "22012": "division_by_zero",
  "22013": "invalid_preceding_or_following_size",
  "22014": "invalid_argument_for_ntile_function",
  "22015": "interval_field_overflow",
  "22016": "invalid_argument_for_nth_value_function",
  "22018": "invalid_character_value_for_cast",
  "22019": "invalid_escape_character",
  "2201B": "invalid_regular_expression",
  "2201E": "invalid_argument_for_logarithm",
  "2201F": "invalid_argument_for_power_function",
  "2201G": "invalid_argument_for_width_bucket_function",
  "2201W": "invalid_row_count_in_limit_clause",
  "2201X": "invalid_row_count_in_result_offset_clause",
  "22020": "invalid_limit_value",
  "22021": "character_not_in_repertoire",
  "22022": "indicator_overflow",
  "22023": "invalid_parameter_value",
  "22024": "unterminated_c_string",
  "22025": "invalid_escape_sequence",
  "22026": "string_data_length_mismatch",
  "22027": "trim_error",
  "2202E": "array_subscript_error",
  "2202G": "invalid_tablesample_repeat",
  "2202H": "invalid_tablesample_argument",
  "22030": "duplicate_json_object_key_value",
  "22031": "invalid_argument_for_sql_json_datetime_function",
  "22032": "invalid_json_text",
  "22033": "invalid_sql_json_subscript",
  "22034": "more_than_one_sql_json_item",
  "22035": "no_sql_json_item",
  "22036": "non_numeric_sql_json_item",
  "22037": "non_unique_keys_in_a_json_object",
  "22038": "singleton_sql_json_item_required",
  "22039": "sql_json_array_not_found",
  "2203A": "sql_json_member_not_found",
  "2203B": "sql_json_number_not_found",
  "2203C": "sql_json_object_not_found",
  "2203D": "too_many_json_array_elements",
  "2203E": "too_many_json_object_members",
  "2203F": "sql_json_scalar_required",
  "2203G": "sql_json_item_cannot_be_cast_to_target_type",
  "22P01": "floating_point_exception",
  "22P02": "invalid_text_representation",
  "22P03": "invalid_binary_representation",
  "22P04": "bad_copy_file_format",
  "22P05": "untranslatable_character",
  "22P06": "nonstandard_use_of_escape_character",
  "23000": "integrity_constraint_violation",
  "23001": "restrict_violation",
  "23502": "not_null_violation",
  "23503": "foreign_key_violation",
  "23505": "unique_violation",
  "23514": "check_violation",
  "23P01": "exclusion_violation",
  "24000": "invalid_cursor_state",
  "25000": "invalid_transaction_state",
  "25001": "active_sql_transaction",
  "25002": "branch_transaction_already_active",
  "25003": "inappropriate_access_mode_for_branch_transaction",
  "25004": "inappropriate_isolation_level_for_branch_transaction",
  "25005": "no_active_sql_transaction_for_branch_transaction",
  "25006": "read_only_sql_transaction",
  "25007": "schema_and_data_statement_mixing_not_supported",
  "25008": "held_cursor_requires_same_isolation_level",
  "25P01": "no_active_sql_transaction",
  "25P02": "in_failed_sql_transaction",
  "25P03": "idle_in_transaction_session_timeout",
  "25P04": "transaction_timeout",
  "26000": "invalid_sql_statement_name",
  "27000": "triggered_data_change_violation",
  "28000": "invalid_authorization_specification",
  "28P01": "invalid_password",
  "2B000": "dependent_privilege_descriptors_still_exist",
  "2BP01": "dependent_objects_still_exist",
  "2D000": "invalid_transaction_termination",
  "2F000": "sql_routine_exception",
  "2F002": "modifying_sql_data_not_permitted",
  "2F003": "prohibited_sql_statement_attempted",
  "2F004": "reading_sql_data_not_permitted",
  "2F005": "function_executed_no_return_statement",
  "34000": "invalid_cursor_name",
  "38000": "external_routine_exception",
  "38001": "containing_sql_not_permitted",
  "38002": "modifying_sql_data_not_permitted",
  "38003": "prohibited_sql_statement_attempted",
  "38004": "reading_sql_data_not_permitted",
  "39000": "external_routine_invocation_exception",
  "39001": "invalid_sqlstate_returned",
  "39004": "null_value_not_allowed",
  "39P01": "trigger_protocol_violated",
  "39P02": "srf_protocol_violated",
  "39P03": "event_trigger_protocol_violated",
  "3B000": "savepoint_exception",
  "3B001": "invalid_savepoint_specification",
  "3D000": "invalid_catalog_name",
  "3F000": "invalid_schema_name",
  "40000": "transaction_rollback",
  "40001": "serialization_failure",
  "40002": "transaction_integrity_constraint_violation",
  "40003": "statement_completion_unknown",
  "40P01": "deadlock_detected",
  "42000": "syntax_error_or_access_rule_violation",
  "42501": "insufficient_privilege",
  "42601": "syntax_error",
  "42602": "invalid_name",
  "42611": "invalid_column_definition",
  "42622": "name_too_long",
  "42701": "duplicate_column",
  "42702": "ambiguous_column",
  "42703": "undefined_column",
  "42704": "undefined_object",
  "42710": "duplicate_object",
  "42712": "duplicate_alias",
  "42723": "duplicate_function",
  "42725": "ambiguous_function",
  "42803": "grouping_error",
  "42804": "datatype_mismatch",
  "42809": "wrong_object_type",
  "42830": "invalid_foreign_key",
  "42846": "cannot_coerce",
  "42883": "undefined_function",
  "428C9": "generated_always",
  "42939": "reserved_name",
  "42P01": "undefined_table",
  "42P02": "undefined_parameter",
  "42P03": "duplicate_cursor",
  "42P04": "duplicate_database",
  "42P05": "duplicate_prepared_statement",
  "42P06": "duplicate_schema",
  "42P07": "duplicate_table",
  "42P08": "ambiguous_parameter",
  "42P09": "ambiguous_alias",
  "42P10": "invalid_column_reference",
  "42P11": "invalid_cursor_definition",
  "42P12": "invalid_database_definition",
  "42P13": "invalid_function_definition",
  "42P14": "invalid_prepared_statement_definition",
  "42P15": "invalid_schema_definition",
  "42P16": "invalid_table_definition",
  "42P17": "invalid_object_definition",
  "42P18": "indeterminate_datatype",
  "42P19": "invalid_recursion",
  "42P20": "windowing_error",
  "42P21": "collation_mismatch",
  "42P22": "indeterminate_collation",
  "44000": "with_check_option_violation",
  "53000": "insufficient_resources",
  "53100": "disk_full",
  "53200": "out_of_memory",
  "53300": "too_many_connections",
  "53400": "configuration_limit_exceeded",
  "54000": "program_limit_exceeded",
  "54001": "statement_too_complex",
  "54011": "too_many_columns",
  "54023": "too_many_arguments",
  "55000": "object_not_in_prerequisite_state",
  "55006": "object_in_use",
  "55P02": "cant_change_runtime_param",
  "55P03": "lock_not_available",
  "55P04": "unsafe_new_enum_value_usage",
  "57000": "operator_intervention",
  "57014": "query_canceled",
  "57P01": "admin_shutdown",
  "57P02": "crash_shutdown",
  "57P03": "cannot_connect_now",
  "57P04": "database_dropped",
  "57P05": "idle_session_timeout",
  "58000": "system_error",
  "58030": "io_error",
  "58P01": "undefined_file",
  "58P02": "duplicate_file",
  "58P03": "file_name_too_long",
  "72000": "snapshot_too_old",
  "F0000": "config_file_error",
  "F0001": "lock_file_exists",
  "HV000": "fdw_error",
  "HV001": "fdw_out_of_memory",
  "HV002": "fdw_dynamic_parameter_value_needed",
  "HV004": "fdw_invalid_data_type",
  "HV005": "fdw_column_name_not_found",
  "HV006": "fdw_invalid_data_type_descriptors",
  "HV007": "fdw_invalid_column_name",
  "HV008": "fdw_invalid_column_number",
  "HV009": "fdw_invalid_use_of_null_pointer",
  "HV00A": "fdw_invalid_string_format",
  "HV00B": "fdw_invalid_handle",
  "HV00C": "fdw_invalid_option_index",
  "HV00D": "fdw_invalid_option_name",
  "HV00J": "fdw_option_name_not_found",
  "HV00K": "fdw_reply_handle",
  "HV00L": "fdw_unable_to_create_execution",
  "HV00M": "fdw_unable_to_create_reply",
  "HV00N": "fdw_unable_to_establish_connection",
  "HV00P": "fdw_no_schemas",
  "HV00Q": "fdw_schema_not_found",
  "HV00R": "fdw_table_not_found",
  "HV010": "fdw_function_sequence_error",
  "HV014": "fdw_too_many_handles",
  "HV021": "fdw_inconsistent_descriptor_information",
  "HV024": "fdw_invalid_attribute_value",
  "HV090": "fdw_invalid_string_length_or_buffer_length",
  "HV091": "fdw_invalid_descriptor_field_identifier",
  "P0000": "plpgsql_error",
  "P0001": "raise_exception",
  "P0002": "no_data_found",
  "P0003": "too_many_rows",
  "P0004": "assert_failure",
  "XX000": "internal_error",
  "XX001": "data_corrupted",
  "XX002": "index_corrupted"
};

// src/redaction.ts
var REDACTED_COLUMN = "[REDACTED:column]";
var REDACTED_NOT_ALLOWED = "[REDACTED:not_allowed]";
var RULE_PATTERN = /^[^.\s,]+(\.[^.\s,]+){0,2}$/;
function policyEnabled(policy) {
  return policy.pii || policy.columns.length > 0 || policy.allowed.length > 0;
}
function policyNeedsSources(policy) {
  return policy.columns.length > 0 || policy.allowed.length > 0;
}
function parseColumnRules(value, where) {
  if (value === void 0 || value === null || value === "") return [];
  let items;
  if (typeof value === "string") {
    items = value.split(",");
  } else if (Array.isArray(value)) {
    items = value;
  } else {
    throw new Error(`${where} must be a list of column rules`);
  }
  const rules = [];
  for (const item of items) {
    if (typeof item !== "string") {
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
function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function glob(pattern, value) {
  const regex = new RegExp("^" + pattern.split("*").map(escapeRegex).join(".*") + "$", "s");
  return regex.test(value.toLowerCase());
}
function sourceMatches(rule, source) {
  const parts = rule.split(".");
  const targets = source.slice(-parts.length);
  return parts.every((part, index) => glob(part, targets[index]));
}
function ruleMatches(rule, name, source) {
  const parts = rule.split(".");
  if (parts.length === 1) {
    if (glob(parts[0], name)) return true;
    return source !== null && glob(parts[0], source[2]);
  }
  return source !== null && sourceMatches(rule, source);
}
function denied(column, rules) {
  if (rules.some((rule) => ruleMatches(rule, column.name, column.source))) return true;
  return (column.rowOf ?? []).some((member) => rules.some((rule) => sourceMatches(rule, member)));
}
function allowed(column, rules) {
  const source = column.source;
  return source !== null && rules.some((rule) => sourceMatches(rule, source));
}
function columnsToMask(columns, policy) {
  const masked = /* @__PURE__ */ new Map();
  for (const column of columns) {
    if (policy.columns.length > 0 && denied(column, policy.columns)) {
      masked.set(column.name, REDACTED_COLUMN);
    } else if (policy.allowed.length > 0 && !allowed(column, policy.allowed)) {
      if (!masked.has(column.name)) masked.set(column.name, REDACTED_NOT_ALLOWED);
    }
  }
  return masked;
}
var DNI_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";
var VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]
];
var VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8]
];
var CARD_PREFIX = /^(?:4|5[1-5]|2[2-7]|3[47]|3(?:0[0-5]|[68])|35|6(?:011|5|4[4-9]))/;
var digits = (text) => text.replace(/\D/g, "");
var separatorSet = (text, chars) => new Set(text.match(chars) ?? []);
function luhn(number) {
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
function verhoeff(number) {
  let check = 0;
  [...number].reverse().forEach((char, index) => {
    check = VERHOEFF_D[check][VERHOEFF_P[index % 8][Number(char)]];
  });
  return check === 0;
}
function validIban(match) {
  const iban = match[0].replace(/ /g, "");
  if (iban.length < 15 || iban.length > 34) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    const value = parseInt(char, 36).toString();
    for (const d of value) remainder = (remainder * 10 + Number(d)) % 97;
  }
  return remainder === 1;
}
function validCard(match) {
  const text = match[0];
  if (separatorSet(text, /[ -]/g).size > 1) return false;
  const number = digits(text);
  return number.length >= 13 && number.length <= 19 && CARD_PREFIX.test(number) && luhn(number);
}
function validSsn(match) {
  const [, area, group, serial] = match;
  return area !== "000" && area !== "666" && !area.startsWith("9") && group !== "00" && serial !== "0000";
}
function validDni(match) {
  const prefix = match[1];
  let number = match[2];
  const letter = match[3];
  if (prefix) {
    if (number.length !== 7) return false;
    number = String("XYZ".indexOf(prefix.toUpperCase())) + number;
  } else if (number.length !== 8) {
    return false;
  }
  return DNI_LETTERS[Number(number) % 23] === letter.toUpperCase();
}
function validAadhaar(match) {
  const text = match[0];
  if (separatorSet(text, /[ -]/g).size > 1) return false;
  return verhoeff(digits(text));
}
function isIpv4(groups) {
  return groups.length === 4 && groups.every((g) => g.length <= 3 && Number(g) <= 255);
}
function validPhone(match) {
  const text = match[0];
  const count = digits(text).length;
  if (text.startsWith("+")) return count >= 8 && count <= 15;
  if (text.includes("(")) return count >= 9 && count <= 12;
  const separators = separatorSet(text, /[ .-]/g);
  if (separators.size !== 1) return false;
  if (count < 9 || count > 12) return false;
  const groups = text.split(/[ .-]/);
  if (separators.has("-") && groups.map((g) => g.length).join(",") === "3,2,4") return false;
  return !(separators.has(".") && isIpv4(groups));
}
var always = () => true;
var DETECTORS = [
  [
    "email",
    /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![A-Za-z0-9-])/g,
    always
  ],
  [
    "iban",
    /(?<![A-Za-z0-9])[A-Z]{2}[0-9]{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?(?![A-Za-z0-9])/g,
    validIban
  ],
  ["credit_card", /(?<![A-Za-z0-9_+])[0-9](?:[ -]?[0-9]){12,18}(?![A-Za-z0-9_])/g, validCard],
  ["us_ssn", /(?<![A-Za-z0-9_-])([0-9]{3})-([0-9]{2})-([0-9]{4})(?![A-Za-z0-9_]|-[0-9])/g, validSsn],
  ["es_dni", /(?<![A-Za-z0-9_])([XYZxyz]?)([0-9]{7,8})-?([A-Za-z])(?![A-Za-z0-9_])/g, validDni],
  [
    "in_aadhaar",
    /(?<![A-Za-z0-9_+-])[2-9][0-9]{3}[ -]?[0-9]{4}[ -]?[0-9]{4}(?![A-Za-z0-9_])/g,
    validAadhaar
  ],
  ["in_pan", /(?<![A-Za-z0-9_])[A-Z]{3}[ABCFGHLJPT][A-Z][0-9]{4}[A-Z](?![A-Za-z0-9_])/g, always],
  [
    "phone",
    /(?<![A-Za-z0-9_./:+-])(?:\+[0-9]{1,3}[ .-]?)?(?:\([0-9]{1,4}\)[ .-]?)?[0-9]{1,14}(?:[ .-][0-9]{1,14}){0,5}(?![A-Za-z0-9_/]|[.:-][0-9])/g,
    validPhone
  ]
];
function tally(counts, kind) {
  counts[kind] = (counts[kind] ?? 0) + 1;
}
function redactText(text, counts) {
  for (const [kind, pattern, isValid] of DETECTORS) {
    let out = "";
    let last = 0;
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0;
      out += text.slice(last, start);
      if (isValid(match)) {
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
function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
function redactValue(value, counts) {
  if (typeof value === "string") return redactText(value, counts);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, counts));
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [redactText(key, counts), redactValue(item, counts)])
    );
  }
  return value;
}
function redactRows(rows, columns, policy) {
  const counts = {};
  if (!policyEnabled(policy)) return { rows, counts };
  const masked = columnsToMask(columns, policy);
  const result = rows.map((row) => {
    const next = {};
    for (const [key, value] of Object.entries(row)) {
      const token = masked.get(key);
      if (token !== void 0) {
        if (value !== null && value !== void 0) {
          tally(counts, token.slice("[REDACTED:".length, -1));
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
var QUOTED = /"[\s\S]*"/g;
var KEY_VALUES = /(Key \([^)]*\)=\().*?(\)(?: already exists| is not present| is still referenced|\.|(?![\s\S])))/gs;
var FAILING_ROW = /(Failing row contains \().*(\))/gs;
function conditionName(sqlstate) {
  return sqlstate ? SQLSTATE_NAMES[sqlstate] : void 0;
}
function condition(sqlstate) {
  const name = conditionName(sqlstate);
  if (name && sqlstate) return `${name}, SQLSTATE ${sqlstate}`;
  return sqlstate ? `SQLSTATE ${sqlstate}` : "unknown condition";
}
function redactError(message, policy, sqlstate) {
  if (!policyEnabled(policy)) return message;
  if (policy.allowed.length > 0) {
    return `${condition(sqlstate)} (error details hidden because an allow list is active)`;
  }
  message = message.replace(KEY_VALUES, "$1[REDACTED]$2");
  message = message.replace(FAILING_ROW, "$1[REDACTED]$2");
  message = message.replace(QUOTED, '"[REDACTED]"');
  if (policy.pii) message = redactText(message, {});
  return sqlstate ? `${message} (${condition(sqlstate)})` : message;
}

// src/settings.ts
var DEFAULT_ALIAS = "default";
var SSL_MODES = ["disable", "allow", "prefer", "require", "verify-ca", "verify-full"];
var globalSettingsSchema = z.object({
  allowWriteOperations: z.boolean().default(false),
  queryTimeout: z.number().min(1).max(300).default(30),
  maxRows: z.number().min(1).max(1e4).default(1e3)
});
var connectionInputSchema = z.object({
  alias: z.string().min(1, "alias is required").regex(
    /^[A-Za-z0-9_-]+$/,
    "alias may only contain letters, digits, hyphens and underscores"
  ),
  url: z.string().min(1).optional(),
  host: z.string().min(1).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  user: z.string().min(1).optional(),
  password: z.string().optional(),
  database: z.string().min(1).optional(),
  sslmode: z.enum(SSL_MODES).optional(),
  /** Overrides ALLOW_WRITE_OPERATIONS for this connection only. */
  allowWrite: z.boolean().optional(),
  /** Marks the connection used when a tool call omits `database`. */
  default: z.boolean().optional(),
  /** Override REDACT_PII, REDACT_COLUMNS and ALLOWED_COLUMNS for this connection. */
  redactPii: z.boolean().optional(),
  redactColumns: z.union([z.string(), z.array(z.string())]).nullable().optional(),
  allowedColumns: z.union([z.string(), z.array(z.string())]).nullable().optional()
}).refine((c) => c.url !== void 0 || c.user !== void 0 && c.database !== void 0, {
  message: 'each connection needs either "url" or both "user" and "database"'
});
var cachedSettings = null;
var cachedConnections = null;
function parseIntEnv(value, fallback) {
  if (value === void 0 || value === "") return fallback;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}
function getSettings() {
  if (cachedSettings) {
    return cachedSettings;
  }
  const result = globalSettingsSchema.safeParse({
    allowWriteOperations: process.env.ALLOW_WRITE_OPERATIONS === "true",
    queryTimeout: parseIntEnv(process.env.QUERY_TIMEOUT, 30),
    maxRows: parseIntEnv(process.env.MAX_ROWS, 1e3)
  });
  if (!result.success) {
    const errors = result.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ");
    throw new Error(`Configuration error: ${errors}`);
  }
  cachedSettings = result.data;
  listConnections();
  return cachedSettings;
}
function fromUrl(alias, url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Configuration error: connection "${alias}" has an unparseable url`);
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error(
      `Configuration error: connection "${alias}" must use a postgres:// or postgresql:// url, got "${parsed.protocol}//"`
    );
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!database) {
    throw new Error(`Configuration error: connection "${alias}" url has no database name`);
  }
  const sslmode = parsed.searchParams.get("sslmode") ?? void 0;
  if (sslmode !== void 0 && !SSL_MODES.includes(sslmode)) {
    throw new Error(`Configuration error: connection "${alias}" has an unknown sslmode "${sslmode}"`);
  }
  return {
    host: parsed.hostname || "localhost",
    port: parsed.port ? parseInt(parsed.port, 10) : 5432,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database,
    sslmode
  };
}
function parseBoolean(value, name) {
  if (value === void 0) return false;
  const normalized = value.trim().toLowerCase();
  if (["1", "on", "t", "true", "y", "yes"].includes(normalized)) return true;
  if (["0", "off", "f", "false", "n", "no"].includes(normalized)) return false;
  throw new Error(`${name} must be true or false, got "${value}"`);
}
function globalRedaction() {
  try {
    return {
      pii: parseBoolean(process.env.REDACT_PII, "REDACT_PII"),
      columns: parseColumnRules(process.env.REDACT_COLUMNS, "REDACT_COLUMNS"),
      allowed: parseColumnRules(process.env.ALLOWED_COLUMNS, "ALLOWED_COLUMNS")
    };
  } catch (error) {
    throw new Error(`Configuration error: ${error.message}`);
  }
}
function singleConnectionFromEnv(defaultAllowWrite) {
  const schema = z.object({
    host: z.string().default("localhost"),
    port: z.number().min(1).max(65535).default(5432),
    user: z.string().min(1, "POSTGRES_USER is required"),
    password: z.string().min(1, "POSTGRES_PASSWORD is required"),
    database: z.string().min(1, "POSTGRES_DB is required"),
    sslmode: z.enum(SSL_MODES).default("prefer")
  });
  const result = schema.safeParse({
    host: process.env.POSTGRES_HOST || "localhost",
    port: parseIntEnv(process.env.POSTGRES_PORT, 5432),
    user: process.env.POSTGRES_USER || "",
    password: process.env.POSTGRES_PASSWORD || "",
    database: process.env.POSTGRES_DB || "",
    sslmode: process.env.POSTGRES_SSLMODE || "prefer"
  });
  if (!result.success) {
    const errors = result.error.issues.map((e) => e.message).join(", ");
    throw new Error(`Configuration error: ${errors}`);
  }
  return {
    alias: DEFAULT_ALIAS,
    ...result.data,
    allowWrite: defaultAllowWrite,
    isDefault: true,
    redaction: globalRedaction()
  };
}
function connectionsFromJson(raw, defaultAllowWrite) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Configuration error: POSTGRES_CONNECTIONS is not valid JSON");
  }
  const result = z.array(connectionInputSchema).safeParse(parsed);
  if (!result.success) {
    const errors = result.error.issues.map((e) => `${["POSTGRES_CONNECTIONS", ...e.path].join(".")}: ${e.message}`).join(", ");
    throw new Error(`Configuration error: ${errors}`);
  }
  if (result.data.length === 0) {
    throw new Error("Configuration error: POSTGRES_CONNECTIONS is empty \u2014 declare at least one connection");
  }
  const seen = /* @__PURE__ */ new Set();
  for (const entry of result.data) {
    if (seen.has(entry.alias)) {
      throw new Error(`Configuration error: duplicate connection alias "${entry.alias}"`);
    }
    seen.add(entry.alias);
  }
  const explicitDefaults = result.data.filter((c) => c.default === true);
  if (explicitDefaults.length > 1) {
    const aliases = explicitDefaults.map((c) => c.alias).join(", ");
    throw new Error(`Configuration error: more than one default connection: ${aliases}`);
  }
  const defaultAlias = (explicitDefaults[0] ?? result.data[0]).alias;
  const defaults = globalRedaction();
  return result.data.map((entry) => {
    const fromDsn = entry.url ? fromUrl(entry.alias, entry.url) : void 0;
    const host = entry.host ?? fromDsn?.host ?? "localhost";
    const port = entry.port ?? fromDsn?.port ?? 5432;
    const user = entry.user ?? fromDsn?.user ?? "";
    const password = entry.password ?? fromDsn?.password ?? "";
    const database = entry.database ?? fromDsn?.database ?? "";
    const sslmode = entry.sslmode ?? fromDsn?.sslmode ?? "prefer";
    if (!user || !database) {
      throw new Error(
        `Configuration error: connection "${entry.alias}" is missing a user or a database name`
      );
    }
    return {
      alias: entry.alias,
      host,
      port,
      user,
      password,
      database,
      sslmode,
      allowWrite: entry.allowWrite ?? defaultAllowWrite,
      isDefault: entry.alias === defaultAlias,
      redaction: redactionFor(entry, defaults)
    };
  });
}
function redactionFor(entry, defaults) {
  try {
    return {
      pii: entry.redactPii ?? defaults.pii,
      columns: entry.redactColumns === void 0 ? defaults.columns : parseColumnRules(entry.redactColumns, `connection "${entry.alias}" redactColumns`),
      allowed: entry.allowedColumns === void 0 ? defaults.allowed : parseColumnRules(entry.allowedColumns, `connection "${entry.alias}" allowedColumns`)
    };
  } catch (error) {
    throw new Error(`Configuration error: ${error.message}`);
  }
}
function getConnections() {
  if (cachedConnections) {
    return cachedConnections;
  }
  const defaultAllowWrite = process.env.ALLOW_WRITE_OPERATIONS === "true";
  const raw = process.env.POSTGRES_CONNECTIONS;
  cachedConnections = raw ? connectionsFromJson(raw, defaultAllowWrite) : [singleConnectionFromEnv(defaultAllowWrite)];
  return cachedConnections;
}
function listConnections() {
  return getConnections().map(({ alias, host, port, database, allowWrite, isDefault }) => ({
    alias,
    host,
    port,
    database,
    allowWrite,
    isDefault
  }));
}
function resolveAlias(alias) {
  const connections = getConnections();
  if (alias === void 0 || alias === "") {
    const fallback = connections.find((c) => c.isDefault) ?? connections[0];
    return fallback;
  }
  const found = connections.find((c) => c.alias === alias);
  if (!found) {
    const available = connections.map((c) => c.alias).join(", ");
    throw new Error(`Unknown database "${alias}". Configured connections: ${available}`);
  }
  return found;
}
function getConnectionConfig(alias) {
  const connection = resolveAlias(alias);
  const settings = getSettings();
  const config = {
    host: connection.host,
    port: connection.port,
    user: connection.user,
    password: connection.password,
    database: connection.database,
    statement_timeout: settings.queryTimeout * 1e3
  };
  if (connection.sslmode !== "disable") {
    config.ssl = {
      rejectUnauthorized: ["verify-ca", "verify-full"].includes(connection.sslmode)
    };
  }
  return config;
}

// src/server.ts
import { Server } from "@modelcontextprotocol/server";

// src/client.ts
import pg from "pg";

// src/security.ts
var SQLValidationError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "SQLValidationError";
  }
};
var DANGEROUS_PATTERNS = [
  /;\s*DROP\s+/i,
  /;\s*DELETE\s+/i,
  /;\s*TRUNCATE\s+/i,
  /;\s*ALTER\s+/i,
  /;\s*CREATE\s+/i,
  /;\s*GRANT\s+/i,
  /;\s*REVOKE\s+/i,
  /--.*$/gm,
  // SQL comments
  /\/\*[\s\S]*?\*\//g,
  // Block comments
  /xp_cmdshell/i,
  /exec\s*\(/i,
  /execute\s*\(/i
];
var WRITE_KEYWORDS = ["INSERT", "UPDATE", "DELETE", "TRUNCATE", "DROP", "ALTER", "CREATE", "GRANT", "REVOKE"];
function validateQuery(query, allowWrite = false) {
  if (!query || typeof query !== "string") {
    throw new SQLValidationError("Query must be a non-empty string");
  }
  const trimmedQuery = query.trim();
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(trimmedQuery)) {
      throw new SQLValidationError("Query contains potentially dangerous patterns");
    }
  }
  if (!allowWrite) {
    const upperQuery = trimmedQuery.toUpperCase();
    for (const keyword of WRITE_KEYWORDS) {
      if (upperQuery.startsWith(keyword) || new RegExp(`^\\s*${keyword}\\s`, "i").test(trimmedQuery)) {
        throw new SQLValidationError(
          `Write operation '${keyword}' is not allowed. Set ALLOW_WRITE_OPERATIONS=true to enable.`
        );
      }
    }
  }
  const validStartKeywords = ["SELECT", "WITH", "EXPLAIN", "SHOW", "DESCRIBE", "SET"];
  if (allowWrite) {
    validStartKeywords.push(...WRITE_KEYWORDS);
  }
  const startsWithValid = validStartKeywords.some(
    (keyword) => trimmedQuery.toUpperCase().startsWith(keyword)
  );
  if (!startsWithValid) {
    throw new SQLValidationError(
      `Query must start with one of: ${validStartKeywords.join(", ")}`
    );
  }
  return trimmedQuery;
}
function validateIdentifier(identifier) {
  if (!identifier || typeof identifier !== "string") {
    throw new SQLValidationError("Identifier must be a non-empty string");
  }
  const identifierPattern = /^[a-zA-Z_][a-zA-Z0-9_$]*$/;
  if (!identifierPattern.test(identifier)) {
    throw new SQLValidationError(
      `Invalid identifier '${identifier}'. Must start with a letter or underscore and contain only letters, digits, underscores, or dollar signs.`
    );
  }
  if (identifier.length > 63) {
    throw new SQLValidationError(
      `Identifier '${identifier}' exceeds maximum length of 63 characters`
    );
  }
  return true;
}
function escapeLikePattern(value) {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

// src/client.ts
var { Pool } = pg;
var PostgresClientError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "PostgresClientError";
  }
};
var RedactionFailedError = class extends PostgresClientError {
  constructor() {
    super("Query failed: the result was withheld because redaction could not be applied");
  }
};
var PostgresClient = class {
  pool;
  /** Which configured connection this client talks to. */
  alias;
  /** Write permission for this connection specifically, not globally. */
  allowWrite;
  /** What to redact from this connection's results. */
  redaction;
  constructor(alias) {
    const connection = resolveAlias(alias);
    this.alias = connection.alias;
    this.allowWrite = connection.allowWrite;
    this.redaction = connection.redaction;
    this.pool = new Pool(getConnectionConfig(connection.alias));
  }
  /**
   * Close the connection pool
   */
  async close() {
    await this.pool.end();
  }
  // ==================== QUERY EXECUTION ====================
  /**
   * Execute a SQL query
   */
  async executeQuery(query, params, options = {}) {
    const settings = getSettings();
    const { allowWrite = false, maxRows = settings.maxRows } = options;
    const validatedQuery = validateQuery(query, allowWrite);
    const client = await this.pool.connect();
    let inTransaction = false;
    let broken = false;
    try {
      if (!allowWrite && policyEnabled(this.redaction)) {
        await client.query("BEGIN READ ONLY");
        inTransaction = true;
      }
      const result = await this.runStatement(client, validatedQuery, params);
      const isSelect = validatedQuery.toUpperCase().trim().startsWith("SELECT");
      let response;
      if (isSelect) {
        const rows = result.rows.slice(0, maxRows);
        const truncated = result.rows.length > maxRows;
        response = {
          success: true,
          rows,
          row_count: rows.length,
          columns: result.fields?.map((f) => f.name) || [],
          truncated
        };
        if (policyEnabled(this.redaction)) {
          try {
            const meta = await this.columnSources(client, result.fields ?? []);
            const redacted = redactRows(rows, meta, this.redaction);
            response.rows = redacted.rows;
            response.redacted = redacted.counts;
          } catch (error) {
            console.error(`Redaction failed: ${error?.name ?? "unknown"}`);
            throw new RedactionFailedError();
          }
        }
      } else {
        response = {
          success: true,
          rows: [],
          row_count: result.rowCount || 0,
          columns: [],
          message: `${result.rowCount} rows affected`
        };
      }
      if (inTransaction) {
        await client.query("COMMIT");
        inTransaction = false;
      }
      return response;
    } catch (error) {
      if (inTransaction) {
        await client.query("ROLLBACK").catch(() => {
          broken = true;
        });
      }
      if (error instanceof RedactionFailedError) throw error;
      throw new PostgresClientError(`Query failed: ${this.errorText(error)}`);
    } finally {
      client.release(broken);
    }
  }
  /**
   * Run the caller's SQL. With redaction on it goes over the extended
   * protocol, where PostgreSQL itself refuses more than one command: otherwise
   * "SELECT 1; COMMIT; UPDATE ..." would end the READ ONLY transaction from
   * inside the string. (@types/pg does not declare queryMode, hence the cast.)
   */
  runStatement(client, text, params) {
    if (!policyEnabled(this.redaction)) return client.query(text, params);
    return client.query({ text, values: params, queryMode: "extended" });
  }
  /**
   * An error as the model may see it. node-postgres puts only the primary
   * message in `message` (DETAIL and CONTEXT live in other fields, never read
   * here) and the SQLSTATE in `code`.
   */
  errorText(error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const code = error?.code;
    return redactError(message, this.redaction, typeof code === "string" ? code : void 0);
  }
  /**
   * Resolve each result column to the table column it was read from.
   *
   * PostgreSQL reports a table OID and attribute number per result column when
   * the value is a plain column reference (also through aliases, subqueries,
   * CTEs and joins); expressions, aggregates and UNIONs report none. Attribute
   * number 0 is a whole-row reference.
   */
  async columnSources(client, fields) {
    const oids = [...new Set(fields.map((f) => f.tableID).filter((oid) => oid))];
    const catalog = /* @__PURE__ */ new Map();
    if (oids.length > 0 && policyNeedsSources(this.redaction)) {
      const result = await client.query(
        `SELECT a.attrelid::bigint AS oid, a.attnum, n.nspname, c.relname, a.attname
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE a.attrelid = ANY($1::oid[]) AND a.attnum > 0 AND NOT a.attisdropped
           -- A temporary table can shadow a permanent one of the same name,
           -- so it is never a trusted source.
           AND c.relpersistence <> 't'`,
        [oids]
      );
      for (const row of result.rows) {
        const oid = Number(row.oid);
        if (!catalog.has(oid)) catalog.set(oid, /* @__PURE__ */ new Map());
        catalog.get(oid).set(Number(row.attnum), [row.nspname, row.relname, row.attname]);
      }
    }
    return fields.map((field) => {
      const table = catalog.get(field.tableID) ?? /* @__PURE__ */ new Map();
      return {
        name: field.name,
        source: field.columnID > 0 ? table.get(field.columnID) ?? null : null,
        rowOf: field.tableID && field.columnID === 0 ? [...table.values()] : null
      };
    });
  }
  /**
   * Get EXPLAIN plan for a query
   */
  async explainQuery(query, analyze = false) {
    validateQuery(query, false);
    let explainCmd = "EXPLAIN (FORMAT JSON";
    if (analyze) {
      explainCmd += ", ANALYZE, BUFFERS";
    }
    explainCmd += `) ${query}`;
    const client = await this.pool.connect();
    const readOnly = policyEnabled(this.redaction);
    let broken = false;
    try {
      if (readOnly) await client.query("BEGIN READ ONLY");
      try {
        const result = await this.runStatement(client, explainCmd);
        if (result.rows.length > 0) {
          const plan = Object.values(result.rows[0])[0];
          return { success: true, plan };
        }
        return { success: false, error: "No plan returned" };
      } finally {
        if (readOnly) {
          await client.query("ROLLBACK").catch(() => {
            broken = true;
          });
        }
      }
    } catch (error) {
      return { success: false, error: this.errorText(error) };
    } finally {
      client.release(broken);
    }
  }
  // ==================== SCHEMA OPERATIONS ====================
  /**
   * List all schemas
   */
  async listSchemas() {
    const query = `
      SELECT schema_name, schema_owner
      FROM information_schema.schemata 
      WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast')
      ORDER BY schema_name
    `;
    const result = await this.pool.query(query);
    return result.rows;
  }
  // ==================== TABLE OPERATIONS ====================
  /**
   * List tables in a schema
   */
  async listTables(schema = "public") {
    validateIdentifier(schema);
    const query = `
      SELECT table_name, table_type, table_schema
      FROM information_schema.tables 
      WHERE table_schema = $1
      ORDER BY table_name
    `;
    const result = await this.pool.query(query, [schema]);
    return result.rows;
  }
  /**
   * Describe a table
   */
  async describeTable(tableName, schema = "public") {
    validateIdentifier(tableName);
    validateIdentifier(schema);
    const description = {
      schema,
      name: tableName,
      columns: [],
      primary_keys: [],
      foreign_keys: []
    };
    const client = await this.pool.connect();
    try {
      const columnsResult = await client.query(`
        SELECT column_name, data_type, is_nullable, column_default,
               character_maximum_length, numeric_precision, numeric_scale
        FROM information_schema.columns 
        WHERE table_schema = $1 AND table_name = $2
        ORDER BY ordinal_position
      `, [schema, tableName]);
      description.columns = columnsResult.rows;
      const pkResult = await client.query(`
        SELECT column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        WHERE tc.table_schema = $1 
          AND tc.table_name = $2
          AND tc.constraint_type = 'PRIMARY KEY'
      `, [schema, tableName]);
      description.primary_keys = pkResult.rows.map((r) => r.column_name);
      const fkResult = await client.query(`
        SELECT kcu.column_name,
               ccu.table_name AS foreign_table_name,
               ccu.column_name AS foreign_column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name
          AND ccu.table_schema = tc.table_schema
        WHERE tc.table_schema = $1 
          AND tc.table_name = $2
          AND tc.constraint_type = 'FOREIGN KEY'
      `, [schema, tableName]);
      description.foreign_keys = fkResult.rows.map((r) => ({
        column: r.column_name,
        references: `${r.foreign_table_name}.${r.foreign_column_name}`
      }));
      return description;
    } finally {
      client.release();
    }
  }
  // ==================== INDEX OPERATIONS ====================
  /**
   * List indexes for a table
   */
  async listIndexes(tableName, schema = "public") {
    validateIdentifier(tableName);
    validateIdentifier(schema);
    const query = `
      SELECT 
        i.relname AS index_name,
        t.relname AS table_name,
        ix.indisunique AS is_unique,
        ix.indisprimary AS is_primary,
        am.amname AS index_type,
        pg_get_indexdef(ix.indexrelid) AS definition,
        pg_relation_size(i.oid) AS size_bytes
      FROM pg_class t
      JOIN pg_index ix ON t.oid = ix.indrelid
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      JOIN pg_am am ON am.oid = i.relam
      WHERE n.nspname = $1
        AND t.relname = $2
      ORDER BY i.relname
    `;
    const result = await this.pool.query(query, [schema, tableName]);
    return result.rows;
  }
  // ==================== CONSTRAINT OPERATIONS ====================
  /**
   * List constraints for a table
   */
  async listConstraints(tableName, schema = "public") {
    validateIdentifier(tableName);
    validateIdentifier(schema);
    const query = `
      SELECT 
        tc.constraint_name,
        tc.constraint_type,
        tc.table_name,
        kcu.column_name,
        ccu.table_name AS references_table,
        ccu.column_name AS references_column,
        cc.check_clause
      FROM information_schema.table_constraints tc
      LEFT JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      LEFT JOIN information_schema.constraint_column_usage ccu
        ON tc.constraint_name = ccu.constraint_name
        AND tc.table_schema = ccu.table_schema
        AND tc.constraint_type = 'FOREIGN KEY'
      LEFT JOIN information_schema.check_constraints cc
        ON tc.constraint_name = cc.constraint_name
        AND tc.table_schema = cc.constraint_schema
      WHERE tc.table_schema = $1
        AND tc.table_name = $2
      ORDER BY tc.constraint_type, tc.constraint_name
    `;
    const result = await this.pool.query(query, [schema, tableName]);
    return result.rows;
  }
  // ==================== VIEW OPERATIONS ====================
  /**
   * List views in a schema
   */
  async listViews(schema = "public") {
    validateIdentifier(schema);
    const query = `
      SELECT table_name, table_schema
      FROM information_schema.views 
      WHERE table_schema = $1
      ORDER BY table_name
    `;
    const result = await this.pool.query(query, [schema]);
    return result.rows;
  }
  /**
   * Describe a view
   */
  async describeView(viewName, schema = "public") {
    validateIdentifier(viewName);
    validateIdentifier(schema);
    const description = {
      name: viewName,
      schema,
      definition: "",
      columns: []
    };
    const client = await this.pool.connect();
    try {
      const defResult = await client.query(`
        SELECT view_definition
        FROM information_schema.views
        WHERE table_schema = $1 AND table_name = $2
      `, [schema, viewName]);
      if (defResult.rows.length > 0) {
        description.definition = defResult.rows[0].view_definition;
      }
      const colsResult = await client.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns 
        WHERE table_schema = $1 AND table_name = $2
        ORDER BY ordinal_position
      `, [schema, viewName]);
      description.columns = colsResult.rows;
      return description;
    } finally {
      client.release();
    }
  }
  // ==================== FUNCTION OPERATIONS ====================
  /**
   * List functions in a schema
   */
  async listFunctions(schema = "public") {
    validateIdentifier(schema);
    const query = `
      SELECT 
        p.proname AS routine_name,
        n.nspname AS routine_schema,
        pg_get_function_result(p.oid) AS return_type,
        pg_get_function_arguments(p.oid) AS argument_types,
        CASE p.prokind
          WHEN 'f' THEN 'function'
          WHEN 'p' THEN 'procedure'
          WHEN 'a' THEN 'aggregate'
          WHEN 'w' THEN 'window'
          ELSE 'unknown'
        END AS routine_type
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = $1
        AND p.proname NOT LIKE 'pg_%'
      ORDER BY p.proname
    `;
    const result = await this.pool.query(query, [schema]);
    return result.rows;
  }
  // ==================== STATISTICS ====================
  /**
   * Get table statistics
   */
  async getTableStats(tableName, schema = "public") {
    validateIdentifier(tableName);
    validateIdentifier(schema);
    const query = `
      SELECT 
        schemaname,
        relname AS table_name,
        n_live_tup AS row_count,
        n_dead_tup AS dead_tuples,
        last_vacuum,
        last_autovacuum,
        last_analyze,
        last_autoanalyze,
        pg_total_relation_size(schemaname || '.' || relname) AS total_size,
        pg_table_size(schemaname || '.' || relname) AS table_size,
        pg_indexes_size(schemaname || '.' || relname) AS index_size
      FROM pg_stat_user_tables
      WHERE schemaname = $1 AND relname = $2
    `;
    const result = await this.pool.query(query, [schema, tableName]);
    return result.rows.length > 0 ? result.rows[0] : null;
  }
  // ==================== DATABASE INFO ====================
  /**
   * Get database information
   */
  async getDatabaseInfo() {
    const client = await this.pool.connect();
    try {
      const versionResult = await client.query("SELECT version()");
      const infoResult = await client.query(`
        SELECT 
          current_database() AS database,
          current_user AS user,
          inet_server_addr() AS host,
          inet_server_port() AS port,
          pg_encoding_to_char(encoding) AS encoding,
          current_setting('TimeZone') AS timezone,
          current_setting('max_connections')::int AS max_connections
        FROM pg_database
        WHERE datname = current_database()
      `);
      const connResult = await client.query(
        "SELECT count(*) AS current_connections FROM pg_stat_activity"
      );
      const info = infoResult.rows[0] || {};
      return {
        ...info,
        version: versionResult.rows[0]?.version || "",
        current_connections: parseInt(connResult.rows[0]?.current_connections || "0", 10)
      };
    } finally {
      client.release();
    }
  }
  // ==================== COLUMN SEARCH ====================
  /**
   * Search for columns by name
   */
  async searchColumns(searchTerm, schema) {
    const searchPattern = `%${escapeLikePattern(searchTerm)}%`;
    let query = `
      SELECT 
        table_schema,
        table_name,
        column_name,
        data_type,
        is_nullable
      FROM information_schema.columns
      WHERE column_name ILIKE $1
    `;
    const params = [searchPattern];
    if (schema) {
      validateIdentifier(schema);
      query += " AND table_schema = $2";
      params.push(schema);
    }
    query += `
      AND table_schema NOT IN ('information_schema', 'pg_catalog')
      ORDER BY table_schema, table_name, column_name
      LIMIT 100
    `;
    const result = await this.pool.query(query, params);
    return result.rows;
  }
};
var clients = /* @__PURE__ */ new Map();
function getClient(alias) {
  const resolved = resolveAlias(alias).alias;
  let client = clients.get(resolved);
  if (!client) {
    client = new PostgresClient(resolved);
    clients.set(resolved, client);
  }
  return client;
}

// src/utils.ts
function formatBytes(bytes) {
  if (bytes === null || bytes === void 0) {
    return "N/A";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let unitIndex = 0;
  let size = bytes;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(1)} ${units[unitIndex]}`;
}
function formatCount(count) {
  if (count === null || count === void 0) {
    return "N/A";
  }
  return count.toLocaleString();
}
function notFoundResponse(type, identifier) {
  return {
    error: `${type} '${identifier}' not found`,
    found: false
  };
}
function formatTimestamp(date) {
  if (!date) {
    return null;
  }
  if (date instanceof Date) {
    return date.toISOString();
  }
  return String(date);
}

// src/tools.ts
var databaseToolDefinitions = [
  // Query tools
  {
    name: "query",
    description: 'Execute a SQL query against the PostgreSQL database. This tool is READ-ONLY by default. Use the "execute" tool for write operations.',
    inputSchema: {
      type: "object",
      properties: {
        sql: { type: "string", description: "SQL query to execute (SELECT statements only)" }
      },
      required: ["sql"]
    }
  },
  {
    name: "execute",
    description: "Execute a write SQL statement (INSERT, UPDATE, DELETE). WARNING: This tool modifies data. Available only when writes are enabled globally or for the selected database.",
    inputSchema: {
      type: "object",
      properties: {
        sql: { type: "string", description: "SQL statement to execute" }
      },
      required: ["sql"]
    }
  },
  {
    name: "explain_query",
    description: "Get the execution plan for a SQL query (EXPLAIN).",
    inputSchema: {
      type: "object",
      properties: {
        sql: { type: "string", description: "SQL query to explain" },
        analyze: { type: "boolean", description: "Actually run the query to get real execution stats (EXPLAIN ANALYZE). Use with caution.", default: false }
      },
      required: ["sql"]
    }
  },
  // Schema tools
  {
    name: "list_schemas",
    description: "List all schemas in the PostgreSQL database.",
    inputSchema: {
      type: "object",
      properties: {},
      required: []
    }
  },
  // Table tools
  {
    name: "list_tables",
    description: "List all tables in a specific schema.",
    inputSchema: {
      type: "object",
      properties: {
        schema: { type: "string", description: "Schema name (default: public)", default: "public" }
      },
      required: []
    }
  },
  {
    name: "describe_table",
    description: "Describe the structure of a table including columns, types, and constraints.",
    inputSchema: {
      type: "object",
      properties: {
        table_name: { type: "string", description: "Name of the table to describe" },
        schema: { type: "string", description: "Schema name (default: public)", default: "public" }
      },
      required: ["table_name"]
    }
  },
  {
    name: "table_stats",
    description: "Get statistics for a table (row count, size, bloat).",
    inputSchema: {
      type: "object",
      properties: {
        table_name: { type: "string", description: "Name of the table" },
        schema: { type: "string", description: "Schema name (default: public)", default: "public" }
      },
      required: ["table_name"]
    }
  },
  // Index tools
  {
    name: "list_indexes",
    description: "List all indexes for a table.",
    inputSchema: {
      type: "object",
      properties: {
        table_name: { type: "string", description: "Name of the table" },
        schema: { type: "string", description: "Schema name (default: public)", default: "public" }
      },
      required: ["table_name"]
    }
  },
  // Constraint tools
  {
    name: "list_constraints",
    description: "List all constraints for a table (PK, FK, UNIQUE, CHECK).",
    inputSchema: {
      type: "object",
      properties: {
        table_name: { type: "string", description: "Name of the table" },
        schema: { type: "string", description: "Schema name (default: public)", default: "public" }
      },
      required: ["table_name"]
    }
  },
  // View tools
  {
    name: "list_views",
    description: "List all views in a schema.",
    inputSchema: {
      type: "object",
      properties: {
        schema: { type: "string", description: "Schema name (default: public)", default: "public" }
      },
      required: []
    }
  },
  {
    name: "describe_view",
    description: "Get the definition and columns of a view.",
    inputSchema: {
      type: "object",
      properties: {
        view_name: { type: "string", description: "Name of the view" },
        schema: { type: "string", description: "Schema name (default: public)", default: "public" }
      },
      required: ["view_name"]
    }
  },
  // Function tools
  {
    name: "list_functions",
    description: "List all functions and procedures in a schema.",
    inputSchema: {
      type: "object",
      properties: {
        schema: { type: "string", description: "Schema name (default: public)", default: "public" }
      },
      required: []
    }
  },
  // Database info tools
  {
    name: "get_database_info",
    description: "Get database and connection information.",
    inputSchema: {
      type: "object",
      properties: {},
      required: []
    }
  },
  // Search tools
  {
    name: "search_columns",
    description: "Search for columns by name across all tables.",
    inputSchema: {
      type: "object",
      properties: {
        search_term: { type: "string", description: "Column name pattern to search (case-insensitive)" },
        schema: { type: "string", description: "Optional schema to limit search (default: all user schemas)" }
      },
      required: ["search_term"]
    }
  }
];
var DATABASE_ARG = {
  type: "string",
  description: "Alias of the configured database to run against. Omit to use the default connection. Call list_databases to see which aliases exist."
};
function withDatabaseArg(tool) {
  return {
    ...tool,
    inputSchema: {
      ...tool.inputSchema,
      properties: {
        ...tool.inputSchema.properties ?? {},
        database: DATABASE_ARG
      }
    }
  };
}
var toolDefinitions = [
  ...databaseToolDefinitions.map(withDatabaseArg),
  {
    name: "list_databases",
    description: 'List the databases this server is configured to reach, by alias, with their host, database name, whether writes are allowed, and which one is the default. Credentials are never returned. Call this first when the user mentions a database by name, then pass the alias as the "database" argument of any other tool.',
    inputSchema: {
      type: "object",
      properties: {},
      required: []
    }
  }
];
async function handleToolCall(name, args) {
  if (name === "list_databases") {
    const connections = listConnections();
    return {
      connections,
      default: connections.find((c) => c.isDefault)?.alias,
      hint: 'Pass an alias as the "database" argument of any other tool. Omit it to use the default.'
    };
  }
  const client = getClient(args.database);
  const settings = getSettings();
  switch (name) {
    case "query": {
      const result = await client.executeQuery(args.sql, void 0, {
        allowWrite: false,
        maxRows: settings.maxRows
      });
      return {
        rows: result.rows,
        row_count: result.row_count,
        columns: result.columns,
        truncated: result.truncated || false,
        // Tells the model that [REDACTED:…] values were masked on purpose, by
        // kind, so it does not try to work around them or invent values.
        ...result.redacted ? { redacted: result.redacted } : {}
      };
    }
    case "execute": {
      if (!client.allowWrite) {
        return {
          success: false,
          error: `Write operations are disabled for database "${client.alias}". Set ALLOW_WRITE_OPERATIONS=true, or "allowWrite": true on that connection, to enable.`
        };
      }
      const result = await client.executeQuery(args.sql, void 0, {
        allowWrite: true
      });
      return {
        success: true,
        row_count: result.row_count,
        message: result.message || "Query executed successfully"
      };
    }
    case "explain_query": {
      return await client.explainQuery(args.sql, args.analyze);
    }
    case "list_schemas": {
      const schemas = await client.listSchemas();
      return {
        schemas: schemas.map((s) => ({
          name: s.schema_name,
          owner: s.schema_owner
        }))
      };
    }
    case "list_tables": {
      const schema = args.schema || "public";
      const tables = await client.listTables(schema);
      return {
        schema,
        tables: tables.map((t) => ({
          name: t.table_name,
          type: t.table_type
        }))
      };
    }
    case "describe_table": {
      const schema = args.schema || "public";
      const result = await client.describeTable(args.table_name, schema);
      if (result.columns.length === 0) {
        return notFoundResponse("Table", `${schema}.${args.table_name}`);
      }
      return {
        schema,
        table_name: args.table_name,
        columns: result.columns.map((c) => ({
          name: c.column_name,
          type: c.data_type,
          nullable: c.is_nullable === "YES",
          default: c.column_default,
          is_primary: result.primary_keys.includes(c.column_name)
        })),
        primary_keys: result.primary_keys,
        foreign_keys: result.foreign_keys
      };
    }
    case "table_stats": {
      const schema = args.schema || "public";
      const stats = await client.getTableStats(args.table_name, schema);
      if (!stats) {
        return notFoundResponse("Table", `${schema}.${args.table_name}`);
      }
      return {
        schema,
        table_name: args.table_name,
        row_count: stats.row_count,
        row_count_formatted: formatCount(stats.row_count),
        dead_tuples: stats.dead_tuples,
        total_size: stats.total_size,
        total_size_formatted: formatBytes(stats.total_size),
        table_size: stats.table_size,
        table_size_formatted: formatBytes(stats.table_size),
        index_size: stats.index_size,
        index_size_formatted: formatBytes(stats.index_size),
        last_vacuum: formatTimestamp(stats.last_vacuum),
        last_analyze: formatTimestamp(stats.last_analyze)
      };
    }
    case "list_indexes": {
      const schema = args.schema || "public";
      const indexes = await client.listIndexes(args.table_name, schema);
      return {
        table_name: args.table_name,
        schema,
        indexes: indexes.map((idx) => ({
          name: idx.index_name,
          is_unique: idx.is_unique,
          is_primary: idx.is_primary,
          type: idx.index_type,
          size: formatBytes(idx.size_bytes),
          definition: idx.definition
        }))
      };
    }
    case "list_constraints": {
      const schema = args.schema || "public";
      const constraints = await client.listConstraints(args.table_name, schema);
      const grouped = {};
      for (const c of constraints) {
        if (!grouped[c.constraint_name]) {
          grouped[c.constraint_name] = {
            name: c.constraint_name,
            type: c.constraint_type,
            columns: [],
            references_table: c.references_table,
            references_column: c.references_column,
            check_clause: c.check_clause
          };
        }
        if (c.column_name) {
          grouped[c.constraint_name].columns.push(c.column_name);
        }
      }
      return {
        table_name: args.table_name,
        schema,
        constraints: Object.values(grouped)
      };
    }
    case "list_views": {
      const schema = args.schema || "public";
      const views = await client.listViews(schema);
      return {
        schema,
        views: views.map((v) => ({ name: v.table_name }))
      };
    }
    case "describe_view": {
      const schema = args.schema || "public";
      const result = await client.describeView(args.view_name, schema);
      if (!result.definition) {
        return notFoundResponse("View", `${schema}.${args.view_name}`);
      }
      return result;
    }
    case "list_functions": {
      const schema = args.schema || "public";
      const functions = await client.listFunctions(schema);
      return {
        schema,
        functions: functions.map((f) => ({
          name: f.routine_name,
          arguments: f.argument_types,
          return_type: f.return_type,
          type: f.routine_type
        }))
      };
    }
    case "get_database_info": {
      return await client.getDatabaseInfo();
    }
    case "search_columns": {
      const columns = await client.searchColumns(
        args.search_term,
        args.schema
      );
      return {
        search_term: args.search_term,
        schema_filter: args.schema || null,
        matches: columns,
        count: columns.length
      };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// src/resources.ts
var resourceDefinitions = [
  {
    uri: "postgres://schemas",
    name: "Database Schemas",
    description: "List all schemas in the database",
    mimeType: "text/markdown"
  },
  {
    uri: "postgres://schemas/{schema}/tables",
    name: "Schema Tables",
    description: "List tables in a specific schema",
    mimeType: "text/markdown"
  },
  {
    uri: "postgres://schemas/{schema}/tables/{table}",
    name: "Table Details",
    description: "Get detailed information about a table",
    mimeType: "text/markdown"
  },
  {
    uri: "postgres://database",
    name: "Database Info",
    description: "Get database information",
    mimeType: "text/markdown"
  }
];
async function handleResourceRead(uri) {
  const client = getClient();
  if (uri === "postgres://schemas") {
    return await resourceSchemas(client);
  }
  if (uri === "postgres://database") {
    return await resourceDatabase(client);
  }
  const tablesMatch = uri.match(/^postgres:\/\/schemas\/([^/]+)\/tables$/);
  if (tablesMatch) {
    return await resourceTables(client, tablesMatch[1]);
  }
  const tableMatch = uri.match(/^postgres:\/\/schemas\/([^/]+)\/tables\/([^/]+)$/);
  if (tableMatch) {
    return await resourceTableDetail(client, tableMatch[1], tableMatch[2]);
  }
  throw new Error(`Unknown resource URI: ${uri}`);
}
async function resourceSchemas(client) {
  const schemas = await client.listSchemas();
  const lines = ["# Database Schemas", ""];
  for (const s of schemas) {
    lines.push(`- **${s.schema_name}** (owner: ${s.schema_owner})`);
  }
  return lines.join("\n");
}
async function resourceTables(client, schema) {
  const tables = await client.listTables(schema);
  const lines = [`# Tables in '${schema}'`, ""];
  if (tables.length === 0) {
    lines.push("No tables found.");
  }
  for (const t of tables) {
    const icon = t.table_type === "BASE TABLE" ? "\u{1F4CB}" : "\u{1F441}";
    lines.push(`- ${icon} **${t.table_name}** (${t.table_type})`);
  }
  return lines.join("\n");
}
async function resourceTableDetail(client, schema, table) {
  const info = await client.describeTable(table, schema);
  const lines = [`# ${schema}.${table}`, ""];
  lines.push("## Columns");
  lines.push("");
  lines.push("| Column | Type | Nullable | Default | PK |");
  lines.push("|--------|------|----------|---------|-----|");
  const pkSet = new Set(info.primary_keys);
  for (const col of info.columns) {
    const nullable = col.is_nullable === "YES" ? "\u2713" : "\u2717";
    const defaultVal = col.column_default || "-";
    const pk = pkSet.has(col.column_name) ? "\u{1F511}" : "";
    lines.push(`| ${col.column_name} | ${col.data_type} | ${nullable} | ${defaultVal} | ${pk} |`);
  }
  if (info.foreign_keys.length > 0) {
    lines.push("");
    lines.push("## Foreign Keys");
    lines.push("");
    for (const fk of info.foreign_keys) {
      lines.push(`- ${fk.column} \u2192 ${fk.references}`);
    }
  }
  return lines.join("\n");
}
async function resourceDatabase(client) {
  const info = await client.getDatabaseInfo();
  const lines = [
    `# Database: ${info.database || "unknown"}`,
    "",
    `**Version**: ${info.version || "unknown"}`,
    `**Host**: ${info.host || "localhost"}:${info.port || 5432}`,
    `**User**: ${info.user || "unknown"}`,
    `**Encoding**: ${info.encoding || "UTF8"}`,
    `**Timezone**: ${info.timezone || "unknown"}`,
    `**Connections**: ${info.current_connections}/${info.max_connections}`
  ];
  return lines.join("\n");
}

// src/prompts.ts
var promptDefinitions = [
  {
    name: "explore_database",
    description: "Explore the database structure and understand the schema",
    arguments: []
  },
  {
    name: "query_builder",
    description: "Help build SQL queries for a specific table",
    arguments: [
      {
        name: "table_name",
        description: "Table to query",
        required: true
      }
    ]
  },
  {
    name: "performance_analysis",
    description: "Analyze table performance and suggest optimizations",
    arguments: [
      {
        name: "table_name",
        description: "Table to analyze",
        required: true
      }
    ]
  },
  {
    name: "data_dictionary",
    description: "Generate a data dictionary for a schema",
    arguments: [
      {
        name: "schema",
        description: "Schema to document (default: public)",
        required: false
      }
    ]
  }
];
function handlePromptGet(name, args) {
  switch (name) {
    case "explore_database":
      return promptExploreDatabase();
    case "query_builder":
      return promptQueryBuilder(args.table_name);
    case "performance_analysis":
      return promptPerformanceAnalysis(args.table_name);
    case "data_dictionary":
      return promptDataDictionary(args.schema || "public");
    default:
      throw new Error(`Unknown prompt: ${name}`);
  }
}
function promptExploreDatabase() {
  const content = `Please explore this PostgreSQL database and provide an overview.

Use these tools to gather information:
1. get_database_info() - Get database version and connection info
2. list_schemas() - List all schemas
3. list_tables(schema="public") - List tables in each schema
4. describe_table(table_name="...") - Get details of important tables

Then provide:
- Database overview (version, size, etc.)
- Schema organization
- Key tables and their purposes (inferred from names/structure)
- Relationships between tables (foreign keys)
- Any notable patterns or concerns`;
  return {
    messages: [
      {
        role: "user",
        content: { type: "text", text: content }
      }
    ]
  };
}
function promptQueryBuilder(tableName) {
  const content = `Help me build SQL queries for the '${tableName}' table.

First, use these tools to understand the table structure:
1. describe_table(table_name="${tableName}") - Get columns and types
2. list_indexes(table_name="${tableName}") - See available indexes
3. table_stats(table_name="${tableName}") - Check table size
4. list_constraints(table_name="${tableName}") - See relationships

Then help me write efficient queries by:
- Suggesting relevant columns based on their names/types
- Using indexed columns in WHERE clauses when possible
- Adding appropriate LIMIT clauses for large tables
- Warning about potentially slow operations

Example query patterns to consider:
- Filtering by common columns
- Aggregations and GROUP BY
- JOINs with related tables`;
  return {
    messages: [
      {
        role: "user",
        content: { type: "text", text: content }
      }
    ]
  };
}
function promptPerformanceAnalysis(tableName) {
  const content = `Analyze the performance characteristics of table '${tableName}'.

Gather information using:
1. table_stats(table_name="${tableName}") - Get size and vacuum stats
2. list_indexes(table_name="${tableName}") - Review existing indexes
3. list_constraints(table_name="${tableName}") - Check constraints
4. describe_table(table_name="${tableName}") - Review column types

Then analyze:
- Table size vs expected row count (potential bloat?)
- Dead tuple percentage (needs VACUUM?)
- Index coverage for common query patterns
- Column types (appropriate for data?)
- Missing indexes on foreign key columns
- Suggestions for optimization

Provide actionable recommendations.`;
  return {
    messages: [
      {
        role: "user",
        content: { type: "text", text: content }
      }
    ]
  };
}
function promptDataDictionary(schema) {
  const content = `Generate a comprehensive data dictionary for the '${schema}' schema.

Use these tools:
1. list_tables(schema="${schema}") - Get all tables
2. For each table:
   - describe_table(table_name="...", schema="${schema}") - Get structure
   - list_indexes(table_name="...", schema="${schema}") - Get indexes
3. list_views(schema="${schema}") - Get all views
4. list_functions(schema="${schema}") - Get functions

Create documentation including:

## Tables
For each table:
- Purpose (inferred from name/columns)
- Columns with descriptions
- Primary keys
- Foreign keys and relationships
- Indexes

## Views
- Purpose and base tables

## Functions/Procedures
- Purpose and parameters

Format as markdown suitable for technical documentation.`;
  return {
    messages: [
      {
        role: "user",
        content: { type: "text", text: content }
      }
    ]
  };
}

// src/server.ts
var VERSION = "1.2.0";
function createServer() {
  const server = new Server(
    {
      name: "postgres-mcp",
      version: VERSION
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {}
      }
    }
  );
  server.setRequestHandler("tools/list", async () => {
    return {
      tools: toolDefinitions
    };
  });
  server.setRequestHandler("tools/call", async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const result = await handleToolCall(name, args || {});
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: message }, null, 2)
          }
        ],
        isError: true
      };
    }
  });
  server.setRequestHandler("resources/list", async () => {
    return {
      resources: resourceDefinitions
    };
  });
  server.setRequestHandler("resources/read", async (request) => {
    const { uri } = request.params;
    try {
      const content = await handleResourceRead(uri);
      return {
        contents: [
          {
            uri,
            mimeType: "text/markdown",
            text: content
          }
        ]
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      throw new Error(`Failed to read resource: ${message}`);
    }
  });
  server.setRequestHandler("prompts/list", async () => {
    return {
      prompts: promptDefinitions
    };
  });
  server.setRequestHandler("prompts/get", async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const result = handlePromptGet(name, args || {});
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      throw new Error(`Failed to get prompt: ${message}`);
    }
  });
  return server;
}

// src/index.ts
async function main() {
  try {
    getSettings();
  } catch (error) {
    console.error("Configuration error:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
  serveStdio(() => createServer(), {
    onerror: (error) => console.error("MCP transport error:", error.message)
  });
  console.error(`PostgreSQL MCP Server v${VERSION} started`);
}
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
