#!/usr/bin/env pwsh
#
# Helper tools for the `assessment-report-converter` skill (PowerShell).
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
# This is a PowerShell port of report_tools.sh; the two must stay behaviourally
# identical (same output data, same exit codes: 0 valid, 1 invalid, 2 error).

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$MappingPath = Join-Path $ScriptDir 'solution-mapping.json'

# Enums — mirror the `enum` arrays in assessment-report.schema.json. The schema
# is the source of truth; the skill tests fail if the two drift apart.
$RULE_SEVERITY_ENUM     = @('mandatory', 'potential', 'optional', 'information')
$SECURITY_SEVERITY_ENUM = @('mandatory', 'potential', 'optional')
$STATUS_ENUM            = @('pending', 'running', 'completed', 'failed', 'cancelled')
$MODE_ENUM              = @('issue-only', 'full')
$DOMAIN_ENUM            = @('cloud-readiness', 'java-upgrade', 'security')

function Die([string]$msg) {
    [Console]::Error.WriteLine("ERROR: $msg")
    exit 2
}

function Read-Mapping {
    if (-not (Test-Path -LiteralPath $MappingPath)) {
        Die "solution-mapping.json not found next to this script ($MappingPath)."
    }
    try {
        return (Get-Content -LiteralPath $MappingPath -Raw -Encoding UTF8 | ConvertFrom-Json)
    } catch {
        Die "solution-mapping.json is not valid JSON ($MappingPath)."
    }
}

function Test-IsObject($v) { $v -is [System.Management.Automation.PSCustomObject] }
function Test-IsArray($v)  { ($v -is [System.Array]) -or ($v -is [System.Collections.ArrayList]) }
function Test-IsNumber($v) {
    ($v -is [int] -or $v -is [long] -or $v -is [double] -or $v -is [decimal] -or $v -is [single]) -and ($v -isnot [bool])
}
function Test-Uint($v)   { (Test-IsNumber $v) -and ([double]$v -eq [math]::Floor([double]$v)) -and ([double]$v -ge 0) }
function Test-PosInt($v) { (Test-IsNumber $v) -and ([double]$v -eq [math]::Floor([double]$v)) -and ([double]$v -ge 1) }

function Has($obj, [string]$key) {
    if (-not (Test-IsObject $obj)) { return $false }
    return ($null -ne $obj.PSObject.Properties[$key])
}
function Get-Prop($obj, [string]$key) {
    if (-not (Has $obj $key)) { return $null }
    $val = $obj.$key
    # Wrap only arrays with the unary comma so the pipeline doesn't unroll them
    # (a single-element array would otherwise collapse to a scalar). Scalars are
    # returned as-is so fields like ruleId/sourceCategory keep their scalar shape
    # and string casts/comparisons behave the same as the bash implementation.
    if (Test-IsArray $val) { return ,$val }
    return $val
}

# jq `tojson` for a scalar used inside a message (strings become double-quoted,
# $null becomes null, numbers/bools render bare).
function Fmt($v) {
    if ($null -eq $v) { return 'null' }
    if ($v -is [bool]) { if ($v) { return 'true' } else { return 'false' } }
    if ($v -is [string]) { return ($v | ConvertTo-Json -Compress) }
    if (Test-IsNumber $v) { return ([string]$v) }
    return ($v | ConvertTo-Json -Compress -Depth 20)
}

# Render an array (possibly empty / single element) as a JSON array string.
function ConvertTo-JsonArray($arr) {
    $items = New-Object System.Collections.Generic.List[object]
    if ($null -ne $arr) { foreach ($x in $arr) { $items.Add($x) } }
    if ($items.Count -eq 0) { return '[]' }
    return ($items.ToArray() | ConvertTo-Json -Depth 20 -AsArray)
}

# --------------------------------------------------------------------------- #
# Shared helper: ordered {ruleId, sourceCategory} list for a solution id.
# --------------------------------------------------------------------------- #
function Get-RulesForSolution($mapping, [string]$solutionId) {
    $out = New-Object System.Collections.Generic.List[object]
    $rules = Get-Prop $mapping 'rules'
    if (Test-IsArray $rules) {
        foreach ($entry in $rules) {
            if ((Get-Prop $entry 'solution') -eq $solutionId) {
                $out.Add([ordered]@{
                    ruleId         = (Get-Prop $entry 'ruleId')
                    sourceCategory = (Get-Prop $entry 'sourceCategory')
                })
            }
        }
    }
    return $out
}

# --------------------------------------------------------------------------- #
# Subcommand: list-solutions
# --------------------------------------------------------------------------- #
function Invoke-ListSolutions([string[]]$rest) {
    $query = ''
    $typeFilter = ''
    $idsOnly = $false
    for ($i = 0; $i -lt $rest.Count; $i++) {
        switch -Wildcard ($rest[$i]) {
            '--query'   { $query = $rest[++$i]; break }
            '--query=*' { $query = $rest[$i].Substring(8); break }
            '--type'    { $typeFilter = $rest[++$i]; break }
            '--type=*'  { $typeFilter = $rest[$i].Substring(7); break }
            '--ids-only' { $idsOnly = $true; break }
            default     { Die "list-solutions: unexpected argument '$($rest[$i])'" }
        }
    }
    $mapping = Read-Mapping
    $solutions = Get-Prop $mapping 'solutions'
    if (-not (Test-IsArray $solutions)) { $solutions = @() }

    $q = ($query).Trim().ToLowerInvariant()
    $t = ($typeFilter).Trim().ToLowerInvariant()

    $selected = New-Object System.Collections.Generic.List[object]
    foreach ($sol in $solutions) {
        if ($t -ne '') {
            $solType = ([string](Get-Prop $sol 'type')).ToLowerInvariant()
            if ($solType -ne $t) { continue }
        }
        if ($q -ne '') {
            $parts = @('solutionId', 'name', 'tooltip') | ForEach-Object { [string](Get-Prop $sol $_) }
            $haystack = ($parts -join ' ').ToLowerInvariant()
            if (-not $haystack.Contains($q)) { continue }
        }
        $selected.Add($sol)
    }

    if ($idsOnly) {
        foreach ($sol in $selected) { [Console]::Out.WriteLine([string](Get-Prop $sol 'solutionId')) }
        return 0
    }

    [Console]::Out.WriteLine((ConvertTo-JsonArray $selected))
    if ($q -ne '') {
        [Console]::Error.WriteLine("# $($selected.Count) solution(s) matching $(Fmt $query)")
    } else {
        [Console]::Error.WriteLine("# $($selected.Count) solution(s)")
    }
    return 0
}

# --------------------------------------------------------------------------- #
# Subcommand: rules-for-solution
# --------------------------------------------------------------------------- #
function Invoke-RulesForSolution([string[]]$rest) {
    if ($rest.Count -lt 1) { Die 'rules-for-solution: SOLUTION_ID is required.' }
    $solutionId = $rest[0]
    $mapping = Read-Mapping
    $rules = @(Get-RulesForSolution $mapping $solutionId)
    $preferred = $null
    if ($rules.Count -gt 0) { $preferred = $rules[0].ruleId }

    $result = [ordered]@{
        solutionId      = $solutionId
        ruleCount       = $rules.Count
        rules           = @($rules)
        preferredRuleId = $preferred
    }
    [Console]::Out.WriteLine(($result | ConvertTo-Json -Depth 20))
    if ($rules.Count -eq 0) {
        [Console]::Error.WriteLine("# no rule maps to $(Fmt $solutionId) (likely a security-only solution; do not invent a ruleId)")
    }
    return 0
}

# --------------------------------------------------------------------------- #
# Subcommand: upgrade-solutions
# --------------------------------------------------------------------------- #
function Invoke-UpgradeSolutions([string[]]$rest) {
    $components = [ordered]@{
        'jdk'              = @{ solution = 'java-version-upgrade';     label = 'Java runtime (JDK / Java SE)'; fallback = 'azure-java-version-01000' }
        'spring-boot'      = @{ solution = 'spring-boot-upgrade';      label = 'Spring Boot';                  fallback = 'spring-boot-to-azure-spring-boot-version-01000' }
        'spring-framework' = @{ solution = 'spring-framework-upgrade'; label = 'Spring Framework';             fallback = 'spring-framework-version-01000' }
        'jakarta-ee'       = @{ solution = 'jakarta-ee-upgrade';       label = 'Java EE / Jakarta EE';         fallback = 'jakarta-ee-version-01000' }
    }

    $mapping = $null
    if (Test-Path -LiteralPath $MappingPath) {
        try { $mapping = Get-Content -LiteralPath $MappingPath -Raw -Encoding UTF8 | ConvertFrom-Json } catch { $mapping = $null }
    }

    $out = [ordered]@{}
    foreach ($component in $components.Keys) {
        $spec = $components[$component]
        $sid = $spec.solution
        $ruleIds = @()
        if ($null -ne $mapping) {
            $ruleIds = @(Get-RulesForSolution $mapping $sid | ForEach-Object { $_.ruleId })
        }
        $preferred = if ($ruleIds.Count -gt 0) { $ruleIds[0] } else { $spec.fallback }
        $out[$component] = [ordered]@{
            label           = $spec.label
            solutionId      = $sid
            ruleIds         = $ruleIds
            preferredRuleId = $preferred
        }
    }
    [Console]::Out.WriteLine(($out | ConvertTo-Json -Depth 20))
    return 0
}

# --------------------------------------------------------------------------- #
# Subcommand: validate  (structural + cross-field checks only)
# --------------------------------------------------------------------------- #
function Get-StructuralErrors($report) {
    $errors = New-Object System.Collections.Generic.List[string]

    function AddMissing($obj, [string[]]$keys, [string]$where) {
        if (-not (Test-IsObject $obj)) { $errors.Add("${where}: expected an object"); return }
        foreach ($k in $keys) {
            if (-not (Has $obj $k)) { $errors.Add("${where}: missing required field $(Fmt $k)") }
        }
    }

    if (-not (Test-IsObject $report)) {
        $errors.Add('report: expected a JSON object')
        return ,$errors
    }

    # ---- report required ----
    AddMissing $report @('version', 'producer', 'metadata', 'projects', 'rules') 'report'

    # ---- metadata ----
    $meta = Get-Prop $report 'metadata'
    if (-not (Test-IsObject $meta)) {
        $errors.Add('metadata: expected an object')
    } else {
        AddMissing $meta @('id', 'name', 'status', 'analysisStartTime', 'domains', 'targetIds') 'metadata'
        if (Has $meta 'status') {
            $status = Get-Prop $meta 'status'
            if ($STATUS_ENUM -notcontains $status) {
                $errors.Add("metadata.status: invalid value $(Fmt $status) (must be one of $($STATUS_ENUM -join ' | '))")
            }
        }
        if (Has $meta 'mode') {
            $mode = Get-Prop $meta 'mode'
            if ($MODE_ENUM -notcontains $mode) {
                $errors.Add("metadata.mode: invalid value $(Fmt $mode) (must be one of $($MODE_ENUM -join ' | '))")
            }
        }
        if (Has $meta 'domains') {
            $domains = Get-Prop $meta 'domains'
            if (-not (Test-IsArray $domains)) {
                $errors.Add('metadata.domains: expected an array')
            } else {
                foreach ($d in $domains) {
                    if ($DOMAIN_ENUM -notcontains $d) {
                        $errors.Add("metadata.domains: invalid value $(Fmt $d) (must be one of $($DOMAIN_ENUM -join ' | '))")
                    }
                }
            }
        }
    }

    # ---- rules (object keyed by ruleId) ----
    $ruleIds = @()
    $rules = Get-Prop $report 'rules'
    if (-not (Test-IsObject $rules)) {
        $errors.Add('rules: expected an object keyed by ruleId')
    } else {
        foreach ($prop in $rules.PSObject.Properties) {
            $rid = $prop.Name
            $rule = $prop.Value
            $ruleIds += $rid
            AddMissing $rule @('id', 'title', 'severity', 'effort', 'domain', 'category') "rules[$rid]"
            # Run the value checks independently of missing-field checks (guarded by
            # Has), so a rule that is both missing a field AND carries an invalid
            # value reports both — matching report_tools.sh, which concatenates.
            if (Test-IsObject $rule) {
                if ((Has $rule 'severity') -and ($RULE_SEVERITY_ENUM -notcontains (Get-Prop $rule 'severity'))) {
                    $errors.Add("rules[$rid].severity: invalid value $(Fmt (Get-Prop $rule 'severity')) (must be one of $($RULE_SEVERITY_ENUM -join ' | '))")
                }
                if ((Has $rule 'effort') -and (-not (Test-Uint (Get-Prop $rule 'effort')))) {
                    $errors.Add("rules[$rid].effort: must be an integer >= 0")
                }
                if ((Has $rule 'domain') -and ($DOMAIN_ENUM -notcontains (Get-Prop $rule 'domain'))) {
                    $errors.Add("rules[$rid].domain: invalid value $(Fmt (Get-Prop $rule 'domain')) (must be one of $($DOMAIN_ENUM -join ' | '))")
                }
            }
        }
    }

    # ---- projects + incidents ----
    $projects = Get-Prop $report 'projects'
    if (-not (Test-IsArray $projects)) {
        $errors.Add('projects: expected an array')
    } else {
        for ($pi = 0; $pi -lt @($projects).Count; $pi++) {
            $project = @($projects)[$pi]
            $pw = "projects[$pi]"
            AddMissing $project @('path', 'properties', 'incidents') $pw
            if (-not (Test-IsObject $project)) { continue }

            $props = Get-Prop $project 'properties'
            if ($null -eq $props) { $props = [PSCustomObject]@{} }
            AddMissing $props @('appName') "$pw.properties"

            $incidents = Get-Prop $project 'incidents'
            if ((Has $project 'incidents') -and (-not (Test-IsArray $incidents))) {
                $errors.Add("$pw.incidents: expected an array")
            } elseif (Test-IsArray $incidents) {
                for ($ii = 0; $ii -lt @($incidents).Count; $ii++) {
                    $inc = @($incidents)[$ii]
                    $iw = "$pw.incidents[$ii]"
                    AddMissing $inc @('ruleId', 'incidentId', 'location', 'locationKind') $iw
                    if (Test-IsObject $inc) {
                        if ((Has $inc 'ruleId') -and ($ruleIds -notcontains (Get-Prop $inc 'ruleId'))) {
                            $errors.Add("$iw.ruleId $(Fmt (Get-Prop $inc 'ruleId')) has no matching entry in rules{}")
                        }
                        if ((Has $inc 'line') -and (-not (Test-PosInt (Get-Prop $inc 'line')))) {
                            $errors.Add("$iw.line: must be an integer >= 1")
                        }
                        if ((Has $inc 'column') -and (-not (Test-PosInt (Get-Prop $inc 'column')))) {
                            $errors.Add("$iw.column: must be an integer >= 1")
                        }
                    }
                }
            }
        }
    }

    # ---- security findings ----
    $security = Get-Prop $report 'security'
    if ($null -eq $security) { $security = @() }
    if (-not (Test-IsArray $security)) {
        $errors.Add('security: expected an array')
        $security = @()
    }
    $ids = New-Object System.Collections.Generic.List[object]
    for ($si = 0; $si -lt @($security).Count; $si++) {
        $finding = @($security)[$si]
        $sw = "security[$si]"
        AddMissing $finding @('id', 'title', 'category', 'severity', 'description', 'evidence') $sw
        if (Test-IsObject $finding) {
            # Collect every object finding's id (even ones missing other fields) so
            # duplicate detection matches report_tools.sh's group_by(.id).
            $ids.Add((Get-Prop $finding 'id'))
            if ((Has $finding 'severity') -and ($SECURITY_SEVERITY_ENUM -notcontains (Get-Prop $finding 'severity'))) {
                $errors.Add("$sw.severity: invalid value $(Fmt (Get-Prop $finding 'severity')) (must be one of $($SECURITY_SEVERITY_ENUM -join ' | ') — normalize the source CVE/CWE severity)")
            }
            # Mirror bash `($finding.evidence // {})`: a missing evidence defaults to
            # {} so its own required sub-fields are reported, rather than only
            # "expected an object".
            $ev = Get-Prop $finding 'evidence'
            if ($null -eq $ev) { $ev = [PSCustomObject]@{} }
            if (-not (Test-IsObject $ev)) {
                $errors.Add("$sw.evidence: expected an object")
            } else {
                AddMissing $ev @('files', 'explanation') "$sw.evidence"
                if ((Has $ev 'files') -and (-not (Test-IsArray (Get-Prop $ev 'files')))) {
                    $errors.Add("$sw.evidence.files: must be an array")
                }
            }
        }
    }
    # duplicate ids (one message per duplicated id, in first-seen order)
    $seen = @{}
    $dupReported = @{}
    foreach ($id in $ids) {
        $key = if ($null -eq $id) { "`0null`0" } else { [string]$id }
        if ($seen.ContainsKey($key)) {
            if (-not $dupReported.ContainsKey($key)) {
                $errors.Add("security id $(Fmt $id) is duplicated (merge findings by id)")
                $dupReported[$key] = $true
            }
        } else {
            $seen[$key] = $true
        }
    }

    # ---- domain <-> security consistency ----
    $domains2 = Get-Prop $meta 'domains'
    if (-not (Test-IsArray $domains2)) { $domains2 = @() }
    $secArr = Get-Prop $report 'security'
    if (-not (Test-IsArray $secArr)) { $secArr = @() }
    if (($domains2 -contains 'security') -and (@($secArr).Count -eq 0)) {
        $errors.Add('metadata.domains includes "security" but report.security is empty')
    }
    if ((@($secArr).Count -gt 0) -and ($domains2 -notcontains 'security')) {
        $errors.Add('report.security has findings but metadata.domains does not include "security"')
    }

    return ,$errors
}

function Invoke-Validate([string[]]$rest) {
    $report = ''
    $schema = ''
    for ($i = 0; $i -lt $rest.Count; $i++) {
        switch -Wildcard ($rest[$i]) {
            '--schema'   { $schema = $rest[++$i]; break }
            '--schema=*' { $schema = $rest[$i].Substring(9); break }
            '-*'         { Die "validate: unexpected option '$($rest[$i])'" }
            default {
                if ($report -eq '') { $report = $rest[$i] }
                else { Die "validate: unexpected argument '$($rest[$i])'" }
            }
        }
    }
    $null = $schema  # accepted for compatibility; unused
    if ($report -eq '') { Die 'validate: REPORT_JSON path is required.' }
    if (-not (Test-Path -LiteralPath $report)) { Die "cannot read report: $report" }
    try {
        $data = Get-Content -LiteralPath $report -Raw -Encoding UTF8 | ConvertFrom-Json
    } catch {
        Die "report is not valid JSON: $report"
    }

    $errors = Get-StructuralErrors $data

    [Console]::Out.WriteLine("Report: $report")
    [Console]::Out.WriteLine(('-' * 60))
    if ($errors.Count -eq 0) {
        [Console]::Out.WriteLine('structural + consistency checks: OK')
    } else {
        [Console]::Out.WriteLine("structural + consistency checks: $($errors.Count) error(s)")
        foreach ($line in $errors) { [Console]::Out.WriteLine("  - $line") }
    }
    [Console]::Out.WriteLine(('-' * 60))
    if ($errors.Count -eq 0) {
        [Console]::Out.WriteLine('RESULT: VALID')
        return 0
    } else {
        [Console]::Out.WriteLine('RESULT: INVALID')
        return 1
    }
}

# --------------------------------------------------------------------------- #
# CLI dispatch
# --------------------------------------------------------------------------- #
function Show-Usage {
    [Console]::Error.WriteLine(@'
Usage: report_tools.ps1 <command> [args]

Commands:
  list-solutions [--query KW] [--type Formula|Chat] [--ids-only]
  rules-for-solution SOLUTION_ID
  upgrade-solutions
  validate REPORT_JSON [--schema PATH]
'@)
    exit 2
}

$argv = @($args)
if ($argv.Count -lt 1) { Show-Usage }
$command = $argv[0]
$rest = @()
if ($argv.Count -gt 1) { $rest = $argv[1..($argv.Count - 1)] }

switch ($command) {
    'list-solutions'     { exit (Invoke-ListSolutions $rest) }
    'rules-for-solution' { exit (Invoke-RulesForSolution $rest) }
    'upgrade-solutions'  { exit (Invoke-UpgradeSolutions $rest) }
    'validate'           { exit (Invoke-Validate $rest) }
    '-h'                 { Show-Usage }
    '--help'             { Show-Usage }
    'help'               { Show-Usage }
    default              { Die "unknown command '$command' (see --help)" }
}
