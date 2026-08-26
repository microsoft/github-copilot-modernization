#!/usr/bin/env bash
#
# Helper tools for the `assessment-report-converter` skill (bash + jq).
#
# This skill is LLM-driven: the agent reads the CSV, understands its columns,
# classifies every row, and authors report.json by hand against the schema. This
# script does NOT parse CSVs and makes NO assumptions about CSV columns. It only
# provides the deterministic lookups and validation the agent needs:
#
#   list-solutions [--query KW] [--type Formula|Chat] [--ids-only]
#       Print known migration solutions from solution-mapping.json, optionally
#       filtered by a keyword/type. Use this to pick the right migration
#       solution for an ordinary issue.
#
#   rules-for-solution SOLUTION_ID
#       Print the ruleId(s) mapped to a solutionId (with sourceCategory). Put a
#       returned ruleId on the incident and in rules{} so the solution resolves
#       downstream. An empty list means the solution has no rule.
#
#   upgrade-solutions
#       Print the canonical major-component upgrade solutions (jdk / spring-boot
#       / spring-framework / jakarta-ee), each resolved to its ruleId.
#
#   validate REPORT_JSON [--schema PATH]
#       Validate a finished report.json. Runs structural + cross-field
#       consistency checks (required fields, enums, every incident.ruleId exists
#       in rules{}, security findings unique by id, domain/security consistency).
#       --schema is accepted for CLI compatibility but ignored — these checks
#       are self-contained and do not load an external JSON Schema.
#
# Requires: bash + jq.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAPPING_PATH="$SCRIPT_DIR/solution-mapping.json"

# Enums — mirror the `enum` arrays in assessment-report.schema.json. The schema
# is the source of truth; the skill tests fail if the two drift apart.
RULE_SEVERITY_ENUM='["mandatory","potential","optional","information"]'
SECURITY_SEVERITY_ENUM='["mandatory","potential","optional"]'
STATUS_ENUM='["pending","running","completed","failed","cancelled"]'
MODE_ENUM='["issue-only","full"]'
DOMAIN_ENUM='["cloud-readiness","java-upgrade","security"]'

die() { echo "ERROR: $*" >&2; exit 2; }

require_jq() {
  command -v jq >/dev/null 2>&1 || die "jq is required but was not found on PATH (install jq)."
}

load_mapping() {
  [ -f "$MAPPING_PATH" ] || die "solution-mapping.json not found next to this script ($MAPPING_PATH)."
}

hr() { printf '%.0s-' $(seq 1 60); echo; }

# --------------------------------------------------------------------------- #
# Subcommand: list-solutions
# --------------------------------------------------------------------------- #
cmd_list_solutions() {
  local query="" type_filter="" ids_only=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --query) query="${2:-}"; shift 2 ;;
      --query=*) query="${1#*=}"; shift ;;
      --type) type_filter="${2:-}"; shift 2 ;;
      --type=*) type_filter="${1#*=}"; shift ;;
      --ids-only) ids_only=1; shift ;;
      *) die "list-solutions: unexpected argument '$1'" ;;
    esac
  done
  load_mapping

  local q; q="$(printf '%s' "$query" | tr '[:upper:]' '[:lower:]' | sed -e 's/^ *//' -e 's/ *$//')"
  local t; t="$(printf '%s' "$type_filter" | tr '[:upper:]' '[:lower:]' | sed -e 's/^ *//' -e 's/ *$//')"

  local selected
  selected="$(jq --arg q "$q" --arg t "$t" '
    (.solutions // [])
    | map(select(
        (($t == "") or ((.type // "" | ascii_downcase) == $t))
        and
        (($q == "") or
          (([.solutionId, .name, .tooltip] | map(. // "" | tostring) | join(" ") | ascii_downcase) | contains($q)))
      ))
  ' "$MAPPING_PATH")"

  if [ "$ids_only" -eq 1 ]; then
    printf '%s' "$selected" | jq -r '.[].solutionId // ""'
    return 0
  fi

  printf '%s\n' "$selected" | jq '.'
  local count; count="$(printf '%s' "$selected" | jq 'length')"
  if [ -n "$q" ]; then
    printf '# %s solution(s) matching "%s"\n' "$count" "$query" >&2
  else
    printf '# %s solution(s)\n' "$count" >&2
  fi
}

# --------------------------------------------------------------------------- #
# Subcommand: rules-for-solution
# --------------------------------------------------------------------------- #
cmd_rules_for_solution() {
  [ $# -ge 1 ] || die "rules-for-solution: SOLUTION_ID is required."
  local solution_id="$1"
  load_mapping

  jq --arg sid "$solution_id" '
    [ (.rules // [])[] | select(.solution == $sid) | {ruleId: .ruleId, sourceCategory: .sourceCategory} ] as $rules
    | {
        solutionId: $sid,
        ruleCount: ($rules | length),
        rules: $rules,
        preferredRuleId: ($rules[0].ruleId // null)
      }
  ' "$MAPPING_PATH"

  local count; count="$(jq --arg sid "$solution_id" '[ (.rules // [])[] | select(.solution == $sid) ] | length' "$MAPPING_PATH")"
  if [ "$count" -eq 0 ]; then
    printf '# no rule maps to "%s" (likely a security-only solution; do not invent a ruleId)\n' "$solution_id" >&2
  fi
}

# --------------------------------------------------------------------------- #
# Subcommand: upgrade-solutions
# --------------------------------------------------------------------------- #
cmd_upgrade_solutions() {
  local mapping_json="{}"
  if [ -f "$MAPPING_PATH" ]; then
    mapping_json="$(cat "$MAPPING_PATH")"
  fi

  jq -n --argjson mapping "$mapping_json" '
    def rules_for($sid): [ ($mapping.rules // [])[] | select(.solution == $sid) | .ruleId ];
    {
      "jdk":              {solution: "java-version-upgrade",     label: "Java runtime (JDK / Java SE)", fallback: "azure-java-version-01000"},
      "spring-boot":      {solution: "spring-boot-upgrade",      label: "Spring Boot",                  fallback: "spring-boot-to-azure-spring-boot-version-01000"},
      "spring-framework": {solution: "spring-framework-upgrade", label: "Spring Framework",             fallback: "spring-framework-version-01000"},
      "jakarta-ee":       {solution: "jakarta-ee-upgrade",       label: "Java EE / Jakarta EE",         fallback: "jakarta-ee-version-01000"}
    }
    | to_entries
    | map(
        .value.solution as $sid
        | rules_for($sid) as $ids
        | {
            key: .key,
            value: {
              label: .value.label,
              solutionId: $sid,
              ruleIds: $ids,
              preferredRuleId: ($ids[0] // .value.fallback)
            }
          }
      )
    | from_entries
  '
}

# --------------------------------------------------------------------------- #
# Subcommand: validate  (structural + cross-field checks only)
# --------------------------------------------------------------------------- #
cmd_validate() {
  local report="" schema=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --schema) schema="${2:-}"; shift 2 ;;
      --schema=*) schema="${1#*=}"; shift ;;
      -*) die "validate: unexpected option '$1'" ;;
      *) if [ -z "$report" ]; then report="$1"; shift; else die "validate: unexpected argument '$1'"; fi ;;
    esac
  done
  : "${schema:-}"  # accepted for compatibility; unused
  [ -n "$report" ] || die "validate: REPORT_JSON path is required."
  [ -f "$report" ] || die "cannot read report: $report"
  jq empty "$report" >/dev/null 2>&1 || die "report is not valid JSON: $report"

  local errors
  errors="$(jq -r \
    --argjson sev "$RULE_SEVERITY_ENUM" \
    --argjson ssev "$SECURITY_SEVERITY_ENUM" \
    --argjson status "$STATUS_ENUM" \
    --argjson mode "$MODE_ENUM" \
    --argjson domain "$DOMAIN_ENUM" '
    def missing($obj; $keys; $where):
      if ($obj | type) != "object" then ["\($where): expected an object"]
      else [ $keys[] as $k | select(($obj | has($k)) | not) | "\($where): missing required field \($k|tojson)" ]
      end;
    def is_uint($v): ($v | type) == "number" and ($v == ($v | floor)) and ($v >= 0);
    def is_pos_int($v): ($v | type) == "number" and ($v == ($v | floor)) and ($v >= 1);

    . as $r
    | if ($r | type) != "object" then ["report: expected a JSON object"]
      else
        # ---- report required ----
        missing($r; ["version","producer","metadata","projects","rules"]; "report")
        +
        # ---- metadata ----
        ( ($r.metadata) as $meta
          | if ($meta | type) != "object" then ["metadata: expected an object"]
            else
              missing($meta; ["id","name","status","analysisStartTime","domains","targetIds"]; "metadata")
              + (if ($meta | has("status")) and (($status | index($meta.status)) == null)
                   then ["metadata.status: invalid value \($meta.status|tojson) (must be one of \($status|join(" | ")))"] else [] end)
              + (if ($meta | has("mode")) and (($mode | index($meta.mode)) == null)
                   then ["metadata.mode: invalid value \($meta.mode|tojson) (must be one of \($mode|join(" | ")))"] else [] end)
              + (if ($meta | has("domains")) and (($meta.domains | type) != "array")
                   then ["metadata.domains: expected an array"]
                 elif ($meta | has("domains"))
                   then [ $meta.domains[] as $d | select(($domain | index($d)) == null) | "metadata.domains: invalid value \($d|tojson) (must be one of \($domain|join(" | ")))" ]
                 else [] end)
            end )
        +
        # ---- rules ----
        ( ($r.rules) as $rules
          | if ($rules | type) != "object" then ["rules: expected an object keyed by ruleId"]
            else
              [ $rules | to_entries[]
                | .key as $rid | .value as $rule
                | (missing($rule; ["id","title","severity","effort","domain","category"]; "rules[\($rid)]")
                   + (if ($rule | type) == "object" then
                        (if ($rule | has("severity")) and (($sev | index($rule.severity)) == null)
                           then ["rules[\($rid)].severity: invalid value \($rule.severity|tojson) (must be one of \($sev|join(" | ")))"] else [] end)
                        + (if ($rule | has("effort")) and (is_uint($rule.effort) | not)
                             then ["rules[\($rid)].effort: must be an integer >= 0"] else [] end)
                        + (if ($rule | has("domain")) and (($domain | index($rule.domain)) == null)
                             then ["rules[\($rid)].domain: invalid value \($rule.domain|tojson) (must be one of \($domain|join(" | ")))"] else [] end)
                      else [] end))
              ] | add // []
            end )
        +
        # ---- projects + incidents ----
        ( ($r.rules // {} | keys) as $ruleIds
          | ($r.projects) as $projects
          | if ($projects | type) != "array" then ["projects: expected an array"]
            else
              [ $projects | to_entries[]
                | .key as $pi | .value as $project
                | "projects[\($pi)]" as $pw
                | (missing($project; ["path","properties","incidents"]; $pw)
                   + (if ($project | type) == "object" then
                        (missing(($project.properties // {}); ["appName"]; "\($pw).properties"))
                        + (if ($project | has("incidents")) and (($project.incidents | type) != "array")
                             then ["\($pw).incidents: expected an array"]
                           elif (($project.incidents // []) | type) == "array" then
                             [ ($project.incidents // []) | to_entries[]
                               | .key as $ii | .value as $inc
                               | "\($pw).incidents[\($ii)]" as $iw
                               | (missing($inc; ["ruleId","incidentId","location","locationKind"]; $iw)
                                  + (if ($inc | type) == "object" then
                                       (if ($inc | has("ruleId")) and (($ruleIds | index($inc.ruleId)) == null)
                                          then ["\($iw).ruleId \($inc.ruleId|tojson) has no matching entry in rules{}"] else [] end)
                                       + (if ($inc | has("line")) and (is_pos_int($inc.line) | not) then ["\($iw).line: must be an integer >= 1"] else [] end)
                                       + (if ($inc | has("column")) and (is_pos_int($inc.column) | not) then ["\($iw).column: must be an integer >= 1"] else [] end)
                                     else [] end))
                             ] | add // []
                           else [] end)
                      else [] end))
              ] | add // []
            end )
        +
        # ---- security findings ----
        ( ($r.security // []) as $security0
          | if ($security0 | type) != "array" then ["security: expected an array"]
            else
              ([ $security0 | to_entries[]
                | .key as $si | .value as $finding
                | "security[\($si)]" as $sw
                | (missing($finding; ["id","title","category","severity","description","evidence"]; $sw)
                   + (if ($finding | type) == "object" then
                        (if ($finding | has("severity")) and (($ssev | index($finding.severity)) == null)
                           then ["\($sw).severity: invalid value \($finding.severity|tojson) (must be one of \($ssev|join(" | ")) — normalize the source CVE/CWE severity)"] else [] end)
                        + (($finding.evidence // {}) as $ev
                           | if ($ev | type) != "object" then ["\($sw).evidence: expected an object"]
                             else missing($ev; ["files","explanation"]; "\($sw).evidence")
                                  + (if ($ev | has("files")) and (($ev.files | type) != "array") then ["\($sw).evidence.files: must be an array"] else [] end)
                             end)
                      else [] end))
              ] | add // [])
              + ( [ $security0[] | select(type=="object") ]
                  | group_by(.id) | [ .[] | select(length > 1) | .[0].id ]
                  | map("security id \(.|tojson) is duplicated (merge findings by id)") )
            end )
        +
        # ---- domain <-> security consistency ----
        ( ($r.metadata.domains // []) as $domains
          | ($r.security // []) as $sec
          | (if (($domains | type) == "array") and ($domains | index("security")) and (($sec|length) == 0)
               then ["metadata.domains includes \"security\" but report.security is empty"] else [] end)
          + (if (($sec|length) > 0) and (($domains | index("security")) == null)
               then ["report.security has findings but metadata.domains does not include \"security\""] else [] end) )
      end
    | .[]
  ' "$report")"

  echo "Report: $report"
  hr
  if [ -z "$errors" ]; then
    echo "structural + consistency checks: OK"
  else
    local n; n="$(printf '%s\n' "$errors" | grep -c .)"
    echo "structural + consistency checks: $n error(s)"
    printf '%s\n' "$errors" | while IFS= read -r line; do
      [ -n "$line" ] && echo "  - $line"
    done
  fi
  hr
  if [ -z "$errors" ]; then
    echo "RESULT: VALID"
    return 0
  else
    echo "RESULT: INVALID"
    return 1
  fi
}

# --------------------------------------------------------------------------- #
# CLI dispatch
# --------------------------------------------------------------------------- #
usage() {
  cat >&2 <<'EOF'
Usage: report_tools.sh <command> [args]

Commands:
  list-solutions [--query KW] [--type Formula|Chat] [--ids-only]
  rules-for-solution SOLUTION_ID
  upgrade-solutions
  validate REPORT_JSON [--schema PATH]
EOF
  exit 2
}

main() {
  require_jq
  [ $# -ge 1 ] || usage
  local command="$1"; shift
  case "$command" in
    list-solutions)     cmd_list_solutions "$@" ;;
    rules-for-solution) cmd_rules_for_solution "$@" ;;
    upgrade-solutions)  cmd_upgrade_solutions "$@" ;;
    validate)           cmd_validate "$@" ;;
    -h|--help|help)     usage ;;
    *) die "unknown command '$command' (see --help)" ;;
  esac
}

main "$@"
