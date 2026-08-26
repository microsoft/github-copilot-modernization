#!/usr/bin/env python3
"""CLI tests for the assessment-report-converter helper scripts.

The skill ships two interchangeable implementations of the same helper CLI:

  * ``scripts/report_tools.sh``  — bash + jq
  * ``scripts/report_tools.ps1`` — PowerShell 7+

Both MUST behave identically (same output data, same exit codes: 0 valid,
1 invalid, 2 read/parse error). This harness drives whichever interpreters are
available on the machine and runs the full assertion battery against each one,
skipping an interpreter that is not installed. There is no Python implementation
any more, so every check goes through a subprocess.

Run from anywhere with stdlib only::

    python -m unittest discover -s skills/assessment-report-converter/tests -v

On Linux/CI ``bash``+``jq`` and ``pwsh`` are both present. On Windows ``bash``
is the WSL launcher (paths are converted to ``/mnt/...``) and ``pwsh`` is
PowerShell 7. These tests are developer-only and are excluded from the shipped
plugin via ``copilot-cli-plugin/.syncignore``.
"""

import json
import os
import shutil
import subprocess
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS_DIR = os.path.abspath(os.path.join(HERE, "..", "scripts"))
SH_PATH = os.path.join(SCRIPTS_DIR, "report_tools.sh")
PS1_PATH = os.path.join(SCRIPTS_DIR, "report_tools.ps1")
SCHEMA_PATH = os.path.join(SCRIPTS_DIR, "assessment-report.schema.json")
IS_WIN = os.name == "nt"


# --------------------------------------------------------------------------- #
# Path helper (Windows -> WSL)
# --------------------------------------------------------------------------- #
def _win_to_wsl(path):
    """Convert C:\\a\\b to /mnt/c/a/b without spawning wslpath."""
    drive, rest = os.path.splitdrive(os.path.abspath(path))
    return "/mnt/" + drive[0].lower() + rest.replace("\\", "/")


def _shq(value):
    return "'" + value.replace("'", "'\\''") + "'"


# --------------------------------------------------------------------------- #
# Interpreter runners — each exposes .run(*args) and .path(p)
# --------------------------------------------------------------------------- #
class _Runner:
    name = "?"

    def run(self, *args):
        raise NotImplementedError

    def path(self, p):
        return p


class BashRunner(_Runner):
    name = "bash"

    def __init__(self):
        self.script = _win_to_wsl(SH_PATH) if IS_WIN else SH_PATH

    @staticmethod
    def available():
        if not shutil.which("bash"):
            return False
        probe = subprocess.run(
            ["bash", "-lc", "command -v jq >/dev/null 2>&1 && echo JQ_OK"],
            capture_output=True, text=True,
        )
        return "JQ_OK" in probe.stdout

    def path(self, p):
        return _win_to_wsl(p) if IS_WIN else p

    def run(self, *args):
        if IS_WIN:
            inner = " ".join(["bash", _shq(self.script)] + [_shq(a) for a in args])
            return subprocess.run(["bash", "-lc", inner], capture_output=True, text=True)
        return subprocess.run(["bash", self.script, *args], capture_output=True, text=True)


class PwshRunner(_Runner):
    name = "pwsh"

    def __init__(self):
        # Require PowerShell 7+ (`pwsh`): the script uses `ConvertTo-Json -AsArray`,
        # which Windows PowerShell 5.1 (`powershell.exe`) does not support.
        self.exe = shutil.which("pwsh")

    @staticmethod
    def available():
        return bool(shutil.which("pwsh"))

    def run(self, *args):
        return subprocess.run(
            [self.exe, "-NoProfile", "-File", PS1_PATH, *args],
            capture_output=True, text=True,
        )


def _discover_runners():
    runners = []
    if BashRunner.available():
        runners.append(BashRunner())
    if PwshRunner.available():
        runners.append(PwshRunner())
    return runners


RUNNERS = _discover_runners()


# --------------------------------------------------------------------------- #
# Mock data
# --------------------------------------------------------------------------- #
def valid_report():
    """A minimal report that passes the structural + consistency checks.

    Tests deep-copy this via json round-trip and mutate a single field to
    exercise one failure at a time, so every negative test stays isolated.
    """
    return {
        "version": "1.0.0",
        "producer": "CSV import",
        "metadata": {
            "id": "report-test-001",
            "name": "Test Report",
            "status": "completed",
            "analysisStartTime": "2026-01-01T00:00:00Z",
            "mode": "full",
            "domains": ["java-upgrade", "security"],
            "targetIds": ["azure-appservice"],
        },
        "projects": [
            {
                "path": "app",
                "properties": {"appName": "demo-app"},
                "incidents": [
                    {
                        "ruleId": "spring-boot-upgrade",
                        "incidentId": "inc-1",
                        "location": "pom.xml",
                        "locationKind": "file",
                        "line": 12,
                        "column": 3,
                    }
                ],
            }
        ],
        "rules": {
            "spring-boot-upgrade": {
                "id": "spring-boot-upgrade",
                "title": "Upgrade Spring Boot to a supported version",
                "severity": "mandatory",
                "effort": 5,
                "domain": "java-upgrade",
                "category": "spring-boot",
            }
        },
        "security": [
            {
                "id": "CVE-2024-0001",
                "title": "Vulnerable dependency",
                "category": "dependency-vulnerability",
                "severity": "mandatory",
                "description": "A vulnerable library version is in use.",
                "storyPoint": 3,
                "evidence": {
                    "files": ["pom.xml"],
                    "explanation": "commons-x 1.0 is affected.",
                },
            }
        ],
    }


def _clone(report):
    return json.loads(json.dumps(report))


def _load_schema():
    with open(SCHEMA_PATH, "r", encoding="utf-8") as fh:
        return json.load(fh)


# --------------------------------------------------------------------------- #
# Subprocess helpers
# --------------------------------------------------------------------------- #
def _run_validate(runner, report_obj):
    """Write report_obj to a temp file, validate it, return (rc, stdout, errors)."""
    fd, path = tempfile.mkstemp(suffix=".json")
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        json.dump(report_obj, fh)
    try:
        cp = runner.run("validate", runner.path(path))
    finally:
        os.remove(path)
    errors = [line[4:] for line in cp.stdout.splitlines() if line.startswith("  - ")]
    return cp.returncode, cp.stdout, errors


@unittest.skipUnless(RUNNERS, "no report_tools interpreter (bash+jq or pwsh) available")
class _MultiInterpreterCase(unittest.TestCase):
    """Base class: subclasses iterate their body over every available runner."""

    def for_each_runner(self):
        for runner in RUNNERS:
            yield runner


# --------------------------------------------------------------------------- #
# Deterministic lookups (against the real solution-mapping.json)
# --------------------------------------------------------------------------- #
class TestLookups(_MultiInterpreterCase):
    def test_upgrade_solutions_resolves_all_components(self):
        for runner in self.for_each_runner():
            with self.subTest(interp=runner.name):
                cp = runner.run("upgrade-solutions")
                self.assertEqual(cp.returncode, 0, cp.stderr)
                data = json.loads(cp.stdout)
                for component in ("jdk", "spring-boot", "spring-framework", "jakarta-ee"):
                    self.assertIn(component, data)
                    self.assertTrue(data[component]["preferredRuleId"],
                                    f"{component} needs a ruleId")

    def test_list_solutions_ids_only(self):
        for runner in self.for_each_runner():
            with self.subTest(interp=runner.name):
                cp = runner.run("list-solutions", "--type", "Formula", "--ids-only")
                self.assertEqual(cp.returncode, 0, cp.stderr)
                ids = [line for line in cp.stdout.splitlines() if line.strip()]
                self.assertGreater(len(ids), 0)

    def test_list_solutions_query_filters(self):
        for runner in self.for_each_runner():
            with self.subTest(interp=runner.name):
                cp = runner.run("list-solutions", "--query", "spring")
                self.assertEqual(cp.returncode, 0, cp.stderr)
                selected = json.loads(cp.stdout)
                self.assertTrue(selected, "expected at least one 'spring' solution")
                for sol in selected:
                    haystack = " ".join(
                        str(sol.get(k, "")) for k in ("solutionId", "name", "tooltip")
                    ).lower()
                    self.assertIn("spring", haystack)

    def test_list_solutions_no_match_is_empty_array(self):
        for runner in self.for_each_runner():
            with self.subTest(interp=runner.name):
                cp = runner.run("list-solutions", "--query", "zzz-no-such-solution")
                self.assertEqual(cp.returncode, 0, cp.stderr)
                self.assertEqual(json.loads(cp.stdout), [])

    def test_rules_for_known_solution(self):
        for runner in self.for_each_runner():
            with self.subTest(interp=runner.name):
                cp = runner.run("rules-for-solution", "spring-boot-upgrade")
                self.assertEqual(cp.returncode, 0, cp.stderr)
                data = json.loads(cp.stdout)
                self.assertEqual(data["solutionId"], "spring-boot-upgrade")
                self.assertGreater(data["ruleCount"], 0)
                self.assertTrue(data["preferredRuleId"])
                self.assertEqual(data["rules"][0]["ruleId"], data["preferredRuleId"])

    def test_rules_for_unknown_solution_is_empty(self):
        for runner in self.for_each_runner():
            with self.subTest(interp=runner.name):
                cp = runner.run("rules-for-solution", "does-not-exist")
                self.assertEqual(cp.returncode, 0, cp.stderr)
                data = json.loads(cp.stdout)
                self.assertEqual(data["ruleCount"], 0)
                self.assertEqual(data["rules"], [])
                self.assertIsNone(data["preferredRuleId"])


# --------------------------------------------------------------------------- #
# validate — structural + cross-field checks (one failure per test)
# --------------------------------------------------------------------------- #
class TestValidate(_MultiInterpreterCase):
    def assertHasError(self, errors, needle):
        self.assertTrue(
            any(needle in e for e in errors),
            f"expected an error containing {needle!r}; got: {errors}",
        )

    def _assert_invalid_with(self, mutate, needle):
        for runner in self.for_each_runner():
            with self.subTest(interp=runner.name):
                report = valid_report()
                mutate(report)
                rc, stdout, errors = _run_validate(runner, report)
                self.assertEqual(rc, 1, stdout)
                self.assertIn("RESULT: INVALID", stdout)
                self.assertHasError(errors, needle)

    def test_valid_report_is_valid(self):
        for runner in self.for_each_runner():
            with self.subTest(interp=runner.name):
                rc, stdout, errors = _run_validate(runner, valid_report())
                self.assertEqual(rc, 0, stdout)
                self.assertIn("RESULT: VALID", stdout)
                self.assertEqual(errors, [])

    def test_report_must_be_object(self):
        for runner in self.for_each_runner():
            with self.subTest(interp=runner.name):
                rc, stdout, errors = _run_validate(runner, ["not", "an", "object"])
                self.assertEqual(rc, 1, stdout)
                self.assertHasError(errors, "expected a JSON object")

    def test_missing_top_level_field(self):
        self._assert_invalid_with(lambda r: r.pop("rules"),
                                  'missing required field "rules"')

    def test_invalid_metadata_status(self):
        def m(r):
            r["metadata"]["status"] = "done"
        self._assert_invalid_with(m, "metadata.status")

    def test_invalid_metadata_mode(self):
        def m(r):
            r["metadata"]["mode"] = "partial"
        self._assert_invalid_with(m, "metadata.mode")

    def test_invalid_domain_enum(self):
        def m(r):
            r["metadata"]["domains"] = ["performance"]
        self._assert_invalid_with(m, "metadata.domains: invalid value")

    def test_rule_invalid_severity(self):
        def m(r):
            r["rules"]["spring-boot-upgrade"]["severity"] = "critical"
        self._assert_invalid_with(m, "severity: invalid value")

    def test_rule_negative_effort(self):
        def m(r):
            r["rules"]["spring-boot-upgrade"]["effort"] = -1
        self._assert_invalid_with(m, "effort: must be an integer >= 0")

    def test_rule_invalid_domain(self):
        def m(r):
            r["rules"]["spring-boot-upgrade"]["domain"] = "networking"
        self._assert_invalid_with(m, "domain: invalid value")

    def test_rule_missing_field(self):
        def m(r):
            del r["rules"]["spring-boot-upgrade"]["category"]
        self._assert_invalid_with(m, 'missing required field "category"')

    def test_project_properties_missing_appname(self):
        def m(r):
            r["projects"][0]["properties"] = {}
        self._assert_invalid_with(m, 'properties: missing required field "appName"')

    def test_incident_missing_field(self):
        def m(r):
            del r["projects"][0]["incidents"][0]["locationKind"]
        self._assert_invalid_with(m, 'missing required field "locationKind"')

    def test_incident_ruleid_referential_integrity(self):
        def m(r):
            r["projects"][0]["incidents"][0]["ruleId"] = "ghost-rule"
        self._assert_invalid_with(m, "has no matching entry in rules{}")

    def test_incident_line_below_one(self):
        def m(r):
            r["projects"][0]["incidents"][0]["line"] = 0
        self._assert_invalid_with(m, "line: must be an integer >= 1")

    def test_security_invalid_severity(self):
        def m(r):
            r["security"][0]["severity"] = "information"  # not in the 3-value security scale
        self._assert_invalid_with(m, "severity: invalid value")

    def test_security_duplicate_id(self):
        def m(r):
            r["security"].append(_clone(r["security"][0]))
        self._assert_invalid_with(m, "is duplicated")

    def test_security_evidence_missing_field(self):
        def m(r):
            del r["security"][0]["evidence"]["explanation"]
        self._assert_invalid_with(m, 'evidence: missing required field "explanation"')

    def test_domains_declares_security_but_none_present(self):
        def m(r):
            r["security"] = []
        self._assert_invalid_with(m, "report.security is empty")

    def test_security_present_but_domain_not_declared(self):
        def m(r):
            r["metadata"]["domains"] = ["java-upgrade"]
        self._assert_invalid_with(m, 'does not include "security"')

    def test_missing_file_exit_two(self):
        ghost = os.path.join(tempfile.gettempdir(), "no-such-report-xyz.json")
        for runner in self.for_each_runner():
            with self.subTest(interp=runner.name):
                cp = runner.run("validate", runner.path(ghost))
                self.assertEqual(cp.returncode, 2, cp.stdout + cp.stderr)

    def test_malformed_json_exit_two(self):
        fd, path = tempfile.mkstemp(suffix=".json")
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write("{ not: valid json ")
        try:
            for runner in self.for_each_runner():
                with self.subTest(interp=runner.name):
                    cp = runner.run("validate", runner.path(path))
                    self.assertEqual(cp.returncode, 2, cp.stdout + cp.stderr)
        finally:
            os.remove(path)


# --------------------------------------------------------------------------- #
# Schema-sync guard (behavioral): the scripts hard-code the schema's enums. If
# the schema drifts, these tests fail so both scripts are updated to match — the
# schema is the source of truth. We probe `validate` with a universe of tokens
# and assert the set the script *accepts* for each field equals the schema enum.
# --------------------------------------------------------------------------- #
class TestSchemaEnumSync(_MultiInterpreterCase):
    @classmethod
    def setUpClass(cls):
        cls.schema = _load_schema()
        cls.defs = cls.schema.get("definitions", {})
        cls.meta_props = cls.schema["properties"]["metadata"]["properties"]

    def _accepted(self, runner, universe, mutate, needle):
        """Return the subset of `universe` the script does NOT flag with needle."""
        accepted = set()
        for value in universe:
            report = valid_report()
            mutate(report, value)
            _, _, errors = _run_validate(runner, report)
            if not any(needle in e for e in errors):
                accepted.add(value)
        return accepted

    def test_rule_severity_enum_matches_schema(self):
        schema_enum = set(self.defs["Severity"]["enum"])
        universe = schema_enum | {"critical", "high", "low", "info"}
        for runner in self.for_each_runner():
            with self.subTest(interp=runner.name):
                accepted = self._accepted(
                    runner, universe,
                    lambda r, v: r["rules"]["spring-boot-upgrade"].__setitem__("severity", v),
                    "rules[spring-boot-upgrade].severity: invalid value",
                )
                self.assertEqual(accepted, schema_enum)

    def test_security_severity_enum_matches_schema(self):
        schema_enum = set(self.defs["SecurityFinding"]["properties"]["severity"]["enum"])
        # "information" is valid for rules but NOT for security — a good discriminator.
        universe = schema_enum | {"information", "critical", "high"}
        for runner in self.for_each_runner():
            with self.subTest(interp=runner.name):
                accepted = self._accepted(
                    runner, universe,
                    lambda r, v: r["security"][0].__setitem__("severity", v),
                    "security[0].severity: invalid value",
                )
                self.assertEqual(accepted, schema_enum)

    def test_status_enum_matches_schema(self):
        schema_enum = set(self.meta_props["status"]["enum"])
        universe = schema_enum | {"done", "open", "closed"}
        for runner in self.for_each_runner():
            with self.subTest(interp=runner.name):
                accepted = self._accepted(
                    runner, universe,
                    lambda r, v: r["metadata"].__setitem__("status", v),
                    "metadata.status: invalid value",
                )
                self.assertEqual(accepted, schema_enum)

    def test_mode_enum_matches_schema(self):
        schema_enum = set(self.meta_props["mode"]["enum"])
        universe = schema_enum | {"partial", "quick"}
        for runner in self.for_each_runner():
            with self.subTest(interp=runner.name):
                accepted = self._accepted(
                    runner, universe,
                    lambda r, v: r["metadata"].__setitem__("mode", v),
                    "metadata.mode: invalid value",
                )
                self.assertEqual(accepted, schema_enum)

    def test_domain_enum_matches_schema(self):
        schema_enum = set(self.meta_props["domains"]["items"]["enum"])
        # Rule.domain must share the same vocabulary.
        self.assertEqual(set(self.defs["Rule"]["properties"]["domain"]["enum"]), schema_enum)
        universe = schema_enum | {"performance", "networking"}

        def mutate(r, v):
            r["metadata"]["domains"] = [v]

        for runner in self.for_each_runner():
            with self.subTest(interp=runner.name):
                accepted = self._accepted(
                    runner, universe, mutate,
                    "metadata.domains: invalid value",
                )
                self.assertEqual(accepted, schema_enum)


# --------------------------------------------------------------------------- #
# Cross-interpreter parity: bash and pwsh must report identical validate errors.
# --------------------------------------------------------------------------- #
@unittest.skipUnless(len(RUNNERS) >= 2, "need both bash and pwsh for parity check")
class TestInterpreterParity(unittest.TestCase):
    def _errors(self, runner, report):
        _, _, errors = _run_validate(runner, report)
        return errors

    def test_valid_report_identical(self):
        report = valid_report()
        base = self._errors(RUNNERS[0], report)
        for other in RUNNERS[1:]:
            self.assertEqual(self._errors(other, report), base)

    def test_multi_error_report_identical(self):
        report = valid_report()
        report["metadata"]["status"] = "done"          # status enum
        report["rules"]["spring-boot-upgrade"]["severity"] = "critical"  # rule severity
        report["projects"][0]["incidents"][0]["ruleId"] = "ghost-rule"   # dangling ref
        report["security"][0]["severity"] = "information"                # security severity
        base = self._errors(RUNNERS[0], report)
        self.assertTrue(base)
        for other in RUNNERS[1:]:
            self.assertEqual(set(self._errors(other, report)), set(base))

    def test_missing_field_plus_invalid_value_identical(self):
        # An object that is BOTH missing a required field AND carries an invalid
        # value must report both errors on every interpreter. This exercises the
        # path where a naive validator could short-circuit after the missing-field
        # error and skip the value checks (bash concatenates; pwsh must too).
        report = valid_report()

        rule = report["rules"]["spring-boot-upgrade"]
        del rule["category"]          # missing required field
        rule["domain"] = "networking"  # + invalid enum on the same object

        finding = report["security"][0]
        del finding["title"]          # missing required field
        finding["severity"] = "critical"  # + invalid enum on the same object
        del finding["evidence"]       # missing object whose sub-fields must still be reported

        base = self._errors(RUNNERS[0], report)
        # Every interpreter must surface the missing-field AND the value errors.
        self.assertIn('rules[spring-boot-upgrade]: missing required field "category"', base)
        self.assertTrue(any("rules[spring-boot-upgrade].domain: invalid value" in e for e in base))
        self.assertIn('security[0]: missing required field "title"', base)
        self.assertTrue(any("security[0].severity: invalid value" in e for e in base))
        self.assertIn('security[0]: missing required field "evidence"', base)
        self.assertTrue(any("security[0].evidence: missing required field" in e for e in base))
        for other in RUNNERS[1:]:
            self.assertEqual(set(self._errors(other, report)), set(base))


if __name__ == "__main__":
    unittest.main(verbosity=2)
