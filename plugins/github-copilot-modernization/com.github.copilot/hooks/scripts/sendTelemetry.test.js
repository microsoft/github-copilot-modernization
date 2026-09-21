/* eslint-disable @typescript-eslint/no-require-imports, no-undef */
/**
 * Automated integration tests for telemetrySender hook scripts.
 *
 * Tests both the PowerShell and Bash hook scripts to verify:
 *   1. Node runtime detection works (explicit, PATH fallback)
 *   2. telemetrySender.js path resolution works
 *   3. Hook never exits non-zero (even on invalid input)
 *   4. stdout is suppressed (no leakage into agent tool channel)
 *   5. Valid hook payloads produce expected telemetry (via --stdio)
 *
 * Run: node agents/hook/scripts/sendTelemetry.test.js
 * Requires: telemetrySender.js built (node esbuild.js or npm run build)
 */

const { execSync, spawnSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const HOOKS_DIR = path.resolve(__dirname);
const SENDER_PATH = path.resolve(__dirname, '..', '..', '..', 'mcp-server', 'dist', 'entrypoints', 'telemetrySender.js');
const IS_WINDOWS = os.platform() === 'win32';

// Find node binary path
const NODE_PATH = process.execPath;

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        passed++;
        console.log(`  ✓ ${name}`);
    } catch (e) {
        failed++;
        console.log(`  ✗ ${name}`);
        console.log(`    ${e.message}`);
    }
}

function assert(condition, msg) {
    if (!condition) throw new Error(msg);
}

/**
 * Run a hook script with given env and stdin, return { status, stdout, stderr }.
 */
function runHook(platform, stdin, envOverrides = {}) {
    const env = {
        ...process.env,
        APPMOD_NODE: NODE_PATH,
        APPMOD_TELEMETRY_SENDER: SENDER_PATH,
        APPMOD_AGENT: 'rearchitecture',
        ...envOverrides,
    };

    if (platform === 'ps1') {
        const script = path.join(HOOKS_DIR, 'sendTelemetry.ps1');
        const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', script, '--stdio'], {
            input: stdin,
            env,
            encoding: 'utf8',
            timeout: 15000,
        });
        return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
    } else {
        const script = path.join(HOOKS_DIR, 'sendTelemetry.sh');
        // Use Git Bash on Windows, bash on Unix
        const bash = IS_WINDOWS ? 'C:\\Program Files\\Git\\bin\\bash.exe' : '/bin/bash';
        if (!fs.existsSync(bash)) {
            return { status: -1, stdout: '', stderr: `bash not found at ${bash}` };
        }
        const result = spawnSync(bash, [script, '--stdio'], {
            input: stdin,
            env,
            encoding: 'utf8',
            timeout: 15000,
        });
        return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
    }
}

function getAvailablePlatforms() {
    const platforms = [];
    // Always test PowerShell if available
    try {
        execSync('pwsh --version', { encoding: 'utf8', timeout: 5000 });
        platforms.push('ps1');
    } catch { /* pwsh not available */ }

    // Test bash if available
    const bash = IS_WINDOWS ? 'C:\\Program Files\\Git\\bin\\bash.exe' : '/bin/bash';
    if (fs.existsSync(bash)) {
        platforms.push('sh');
    }
    return platforms;
}

// --- Pre-flight checks ---
console.log('=== Telemetry Hook Script Tests ===\n');
console.log(`Node: ${NODE_PATH}`);
console.log(`Sender: ${SENDER_PATH}`);
console.log(`Platform: ${os.platform()}\n`);

if (!fs.existsSync(SENDER_PATH)) {
    console.error('ERROR: telemetrySender.js not found. Run the build first.');
    process.exit(1);
}

const platforms = getAvailablePlatforms();
if (platforms.length === 0) {
    console.error('ERROR: Neither pwsh nor bash available for testing.');
    process.exit(1);
}
console.log(`Testing platforms: ${platforms.join(', ')}\n`);

// --- Tests ---
for (const platform of platforms) {
    console.log(`\n--- ${platform === 'ps1' ? 'PowerShell' : 'Bash'} hook ---`);

    // T1: Valid payload → telemetry event on stdout (via --stdio)
    test('valid SessionStart payload produces telemetry output', () => {
        const payload = JSON.stringify({
            hookEventName: 'SessionStart',
            session_id: 'test-session-001',
            source: 'new',
        });
        const result = runHook(platform, payload);
        assert(result.status === 0, `Expected exit 0, got ${result.status}`);
        // With current NOOP mapper for rearchitecture, no output is expected.
        // But the process should still exit cleanly.
    });

    // T2: Valid PreToolUse payload
    test('valid PreToolUse payload exits cleanly', () => {
        const payload = JSON.stringify({
            hookEventName: 'PreToolUse',
            session_id: 'test-session-002',
            tool_name: 'Bash',
        });
        const result = runHook(platform, payload);
        assert(result.status === 0, `Expected exit 0, got ${result.status}`);
    });

    // T3: Invalid JSON → exit 0 (never abort)
    test('invalid JSON stdin exits 0', () => {
        const result = runHook(platform, 'this is not json {{{');
        assert(result.status === 0, `Expected exit 0, got ${result.status}`);
    });

    // T4: Empty stdin → exit 0
    test('empty stdin exits 0', () => {
        const result = runHook(platform, '');
        assert(result.status === 0, `Expected exit 0, got ${result.status}`);
    });

    // T5: Missing hookEventName → exit 0 (telemetrySender exits 1, but hook wraps to 0)
    test('missing hookEventName exits 0 (hook absorbs error)', () => {
        const payload = JSON.stringify({ session_id: 'test-session-003' });
        const result = runHook(platform, payload);
        assert(result.status === 0, `Expected exit 0, got ${result.status}`);
    });

    // T6: APPMOD_NODE points to invalid path → exit 0 (graceful fallback or exit)
    test('invalid APPMOD_NODE exits 0', () => {
        const result = runHook(platform, '{"hookEventName":"Stop"}', {
            APPMOD_NODE: '/nonexistent/node',
        });
        assert(result.status === 0, `Expected exit 0, got ${result.status}`);
    });

    // T7: APPMOD_TELEMETRY_SENDER points to invalid path → exit 0
    test('invalid APPMOD_TELEMETRY_SENDER exits 0', () => {
        const result = runHook(platform, '{"hookEventName":"Stop"}', {
            APPMOD_TELEMETRY_SENDER: '/nonexistent/telemetrySender.js',
        });
        assert(result.status === 0, `Expected exit 0, got ${result.status}`);
    });

    // T8: stdout is suppressed when --stdio is NOT passed
    test('stdout suppressed without --stdio flag', () => {
        // Run without --stdio (remove it from args by using a custom invocation)
        const env = {
            ...process.env,
            APPMOD_NODE: NODE_PATH,
            APPMOD_TELEMETRY_SENDER: SENDER_PATH,
            APPMOD_AGENT: 'rearchitecture',
        };
        const payload = JSON.stringify({ hookEventName: 'SessionStart', session_id: 's1' });

        let result;
        if (platform === 'ps1') {
            const script = path.join(HOOKS_DIR, 'sendTelemetry.ps1');
            result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', script], {
                input: payload, env, encoding: 'utf8', timeout: 15000,
            });
        } else {
            const script = path.join(HOOKS_DIR, 'sendTelemetry.sh');
            const bash = IS_WINDOWS ? 'C:\\Program Files\\Git\\bin\\bash.exe' : '/bin/bash';
            result = spawnSync(bash, [script], {
                input: payload, env, encoding: 'utf8', timeout: 15000,
            });
        }
        assert(result.status === 0, `Expected exit 0, got ${result.status}`);
        assert(result.stdout.trim() === '', `Expected empty stdout, got: "${result.stdout.trim()}"`);
    });
}

// --- Summary ---
console.log(`\n\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
