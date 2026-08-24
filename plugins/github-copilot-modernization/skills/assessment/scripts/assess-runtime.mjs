import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const JAVA_MINIMUM_VERSION = "7.7.0.8";
const DOTNET_APPCAT_MINIMUM_VERSION = "1.0.1127";
const NCU_VERSION = "19.6.3";
const JAVA_APPCAT_ARCHIVE_MAX_BYTES = 256 * 1024 * 1024;
const JAVA_APPCAT_DOWNLOAD_HOSTS = new Set([
  "aka.ms",
  "download.visualstudio.microsoft.com",
]);
const DEFAULT_JAVA_TARGETS = [
  "azure-aks",
  "azure-appservice",
  "azure-container-apps",
];
const IGNORED_DIRECTORIES = new Set(["bin", "obj"]);

function executableName(name) {
  return process.platform === "win32" ? `${name}.exe` : name;
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: options.env ?? process.env,
    shell: false,
    windowsHide: true,
  });
  if (result.error) {
    throw new Error(`Failed to start ${command}: ${result.error.message}`, {
      cause: result.error,
    });
  }
  const allowedStatuses = options.allowedStatuses ?? [0];
  if (!allowedStatuses.includes(result.status)) {
    const detail = (result.stderr || result.stdout || "no output").trim();
    throw new Error(
      `${command} ${args.join(" ")} failed with exit code ${result.status}: ${detail}`,
    );
  }
  return {
    command,
    args: [...args],
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function parseVersion(value) {
  const match = String(value).match(/\d+(?:\.\d+){1,3}/);
  return match ? match[0] : null;
}

export function compareVersions(left, right) {
  const leftParts = String(left).split(".").map(Number);
  const rightParts = String(right).split(".").map(Number);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) {
      return Math.sign(difference);
    }
  }
  return 0;
}

export function findFilesRecursively(root, predicate, options = {}) {
  const ignored = new Set(options.ignoreDirectories ?? []);
  const matches = [];
  if (!fs.existsSync(root)) {
    return matches;
  }
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (!ignored.has(entry.name.toLowerCase())) {
        matches.push(
          ...findFilesRecursively(entryPath, predicate, {
            ignoreDirectories: ignored,
          }),
        );
      }
    } else if (entry.isFile() && predicate(entryPath, entry)) {
      matches.push(entryPath);
    }
  }
  return matches;
}

export function checkJavaAppcat({
  homeDir = os.homedir(),
  minimumVersion = JAVA_MINIMUM_VERSION,
} = {}) {
  const executablePath = path.join(
    homeDir,
    ".appcat",
    executableName("appcat"),
  );
  if (!fs.existsSync(executablePath)) {
    return {
      installed: false,
      compatible: false,
      executablePath,
      version: null,
      minimumVersion,
      reason: "AppCAT executable was not found",
    };
  }

  try {
    const result = runCommand(executablePath, ["version", "--disable-telemetry"]);
    const version = parseVersion(`${result.stdout}\n${result.stderr}`);
    if (!version) {
      return {
        installed: true,
        compatible: false,
        executablePath,
        version: null,
        minimumVersion,
        reason: "AppCAT did not return a recognizable version",
      };
    }
    return {
      installed: true,
      compatible: compareVersions(version, minimumVersion) >= 0,
      executablePath,
      version,
      minimumVersion,
      reason:
        compareVersions(version, minimumVersion) >= 0
          ? null
          : `AppCAT ${version} is older than ${minimumVersion}`,
    };
  } catch (error) {
    return {
      installed: true,
      compatible: false,
      executablePath,
      version: null,
      minimumVersion,
      reason: error.message,
    };
  }
}

export function getJavaAppcatArchive({
  platform = process.platform,
  architecture = process.arch,
} = {}) {
  const platformName =
    platform === "win32" ? "windows" : platform === "darwin" ? "macos" : "linux";
  const architectureName = architecture === "arm64" ? "arm64" : "amd64";
  const extension = platform === "win32" ? "zip" : "tar.gz";
  const url = `https://aka.ms/appcat/azure-migrate-appcat-for-java-cli-${platformName}-${architectureName}.${extension}`;
  return { url, extension, platform: platformName, architecture: architectureName };
}

function validateJavaAppcatDownloadUrl(value) {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || !JAVA_APPCAT_DOWNLOAD_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error(`AppCAT download resolved to an untrusted URL: ${parsed.origin}`);
  }
}

function validateJavaAppcatArchiveHeader(archive, extension) {
  const valid = extension === "zip"
    ? archive.length >= 4
      && archive[0] === 0x50
      && archive[1] === 0x4b
      && [0x03, 0x05, 0x07].includes(archive[2])
      && [0x04, 0x06, 0x08].includes(archive[3])
    : extension === "tar.gz"
      && archive.length >= 2
      && archive[0] === 0x1f
      && archive[1] === 0x8b;
  if (!valid) {
    throw new Error(`AppCAT download is not a valid ${extension} archive`);
  }
}

async function readBoundedResponseBody(response, maxBytes) {
  const contentLengthValue = response.headers.get("content-length");
  if (contentLengthValue !== null) {
    const contentLength = Number(contentLengthValue);
    if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
      throw new Error("AppCAT download returned an invalid Content-Length");
    }
    if (contentLength > maxBytes) {
      throw new Error(`AppCAT download exceeds the ${maxBytes}-byte limit`);
    }
  }
  if (!response.body) {
    throw new Error("AppCAT download returned no response body");
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new Error(`AppCAT download exceeds the ${maxBytes}-byte limit`);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, totalBytes);
}

export async function downloadJavaAppcatArchive({
  url,
  extension,
  fetchImpl = globalThis.fetch,
  maxBytes = JAVA_APPCAT_ARCHIVE_MAX_BYTES,
} = {}) {
  validateJavaAppcatDownloadUrl(url);
  const response = await fetchImpl(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`AppCAT download failed: HTTP ${response.status}`);
  }
  validateJavaAppcatDownloadUrl(response.url || url);
  const archive = await readBoundedResponseBody(response, maxBytes);
  validateJavaAppcatArchiveHeader(archive, extension);
  return archive;
}

async function installJavaAppcat(homeDir) {
  const installDirectory = path.join(homeDir, ".appcat");
  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "appcat-install-"),
  );
  const { url, extension } = getJavaAppcatArchive();
  const archivePath = path.join(temporaryDirectory, `appcat.${extension}`);
  const extractDirectory = path.join(temporaryDirectory, "extract");
  fs.mkdirSync(extractDirectory, { recursive: true });

  try {
    const archive = await downloadJavaAppcatArchive({ url, extension });
    // This buffer has passed trusted-origin, size, and archive-signature validation.
    fs.writeFileSync(archivePath, archive, { flag: "wx", mode: 0o600 });
    runCommand("tar", ["-xf", archivePath, "-C", extractDirectory]);

    const binaryName = executableName("appcat").toLowerCase();
    const binaries = findFilesRecursively(
      extractDirectory,
      (filePath) => path.basename(filePath).toLowerCase() === binaryName,
    );
    if (binaries.length === 0) {
      throw new Error("The AppCAT archive did not contain an appcat executable");
    }

    fs.rmSync(installDirectory, { recursive: true, force: true });
    fs.mkdirSync(installDirectory, { recursive: true });
    fs.cpSync(path.dirname(binaries[0]), installDirectory, { recursive: true });
    if (process.platform !== "win32") {
      fs.chmodSync(path.join(installDirectory, "appcat"), 0o755);
    }
    return { url, installDirectory };
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

function checkDotnetSdk() {
  const result = runCommand("dotnet", ["--version"]);
  const version = parseVersion(result.stdout);
  const major = version ? Number.parseInt(version.split(".")[0], 10) : NaN;
  if (![8, 9, 10].includes(major)) {
    throw new Error(
      `AppCAT requires .NET SDK major 8, 9, or 10; found ${version ?? "unknown"}`,
    );
  }
  return version;
}

function dotnetAppcatPath(homeDir = os.homedir()) {
  return path.join(homeDir, ".appcat-dotnet", executableName("appcat"));
}

function getDotnetAppcatVersion(homeDir = os.homedir()) {
  const executablePath = dotnetAppcatPath(homeDir);
  if (!fs.existsSync(executablePath)) return null;
  const result = runCommand(executablePath, ["--version"]);
  return parseVersion(`${result.stdout}\n${result.stderr}`);
}

function ensureDotnetAppcat(force, homeDir = os.homedir()) {
  const sdkVersion = checkDotnetSdk();
  const toolPath = path.join(homeDir, ".appcat-dotnet");
  const executablePath = dotnetAppcatPath(homeDir);
  const installedVersion = getDotnetAppcatVersion(homeDir);
  if (!force && installedVersion && compareVersions(installedVersion, DOTNET_APPCAT_MINIMUM_VERSION) >= 0) {
    return {
      language: "dotnet",
      installed: true,
      changed: false,
      version: installedVersion,
      sdkVersion,
      executablePath,
    };
  }

  const action = installedVersion ? "update" : "install";
  const args = [
    "tool",
    action,
    "--tool-path",
    toolPath,
    installedVersion ? "--source" : "--add-source",
    "https://api.nuget.org/v3/index.json",
    "--ignore-failed-sources",
    "dotnet-appcat",
  ];
  runCommand("dotnet", args);
  const verifiedVersion = getDotnetAppcatVersion(homeDir);
  if (!verifiedVersion || compareVersions(verifiedVersion, DOTNET_APPCAT_MINIMUM_VERSION) < 0) {
    throw new Error(
      `dotnet-appcat verification failed: expected ${DOTNET_APPCAT_MINIMUM_VERSION} or later, found ${verifiedVersion ?? "nothing"}`,
    );
  }
  return {
    language: "dotnet",
    installed: true,
    changed: true,
    version: verifiedVersion,
    sdkVersion,
    executablePath,
  };
}

export async function ensureAppcat({ language, force = false, homeDir } = {}) {
  const normalizedLanguage = String(language ?? "").toLowerCase();
  if (normalizedLanguage === "dotnet" || normalizedLanguage === ".net") {
    return ensureDotnetAppcat(force, homeDir ?? os.homedir());
  }
  if (normalizedLanguage !== "java") {
    throw new Error(`Unsupported AppCAT language: ${language ?? "missing"}`);
  }

  const resolvedHome = homeDir ?? os.homedir();
  const before = checkJavaAppcat({ homeDir: resolvedHome });
  if (!force && before.compatible) {
    return { language: "java", changed: false, ...before };
  }
  await installJavaAppcat(resolvedHome);
  const after = checkJavaAppcat({ homeDir: resolvedHome });
  if (!after.compatible) {
    throw new Error(`AppCAT verification failed: ${after.reason}`);
  }
  return { language: "java", changed: true, ...after };
}

export function buildJavaAppcatArgs({
  workspacePath,
  outputPath,
  targets = DEFAULT_JAVA_TARGETS,
  capabilities = [],
  targetOs,
  mode = "issue-only",
}) {
  const args = [
    "analyze",
    "--input",
    workspacePath,
    "--output",
    outputPath,
    "--mode",
    mode,
  ];
  const targetValues = Array.isArray(targets) ? targets : [targets];
  if (targetValues.filter(Boolean).length > 0) {
    args.push("--target", targetValues.filter(Boolean).join(","));
  }
  const capabilityValues = Array.isArray(capabilities)
    ? capabilities
    : [capabilities];
  if (capabilityValues.filter(Boolean).length > 0) {
    args.push("--capability", capabilityValues.filter(Boolean).join(","));
  }
  if (targetOs) {
    const osValues = Array.isArray(targetOs) ? targetOs : [targetOs];
    args.push("--os", osValues.filter(Boolean).join(","));
  }
  args.push(
    "--overwrite",
    "--output-format",
    "json",
    "--skip-static-report",
    "--code-snips-number",
    "-1",
  );
  return args;
}

export function discoverDotnetInputs(workspacePath) {
  const files = findFilesRecursively(
    workspacePath,
    (filePath) => /\.(?:slnx?|csproj|fsproj|vbproj)$/i.test(filePath),
    { ignoreDirectories: IGNORED_DIRECTORIES },
  );
  const solutions = files.filter((filePath) => /\.slnx?$/i.test(filePath));
  return solutions.sort((left, right) => {
    const leftSlnx = left.toLowerCase().endsWith(".slnx");
    const rightSlnx = right.toLowerCase().endsWith(".slnx");
    return Number(rightSlnx) - Number(leftSlnx) || left.localeCompare(right);
  });
}

export function buildDotnetAppcatArgs({ workspacePath, runDir }) {
  const inputs = discoverDotnetInputs(workspacePath);
  if (inputs.length === 0) {
    throw new Error(`No .NET solution files (.sln or .slnx) found under ${workspacePath}`);
  }
  const reportPath = path.join(runDir, "report.json");
  return [
    "analyze",
    "--source",
    "Solution",
    "--target",
    "Any",
    "--serializer",
    "APPMODJSON",
    "--code",
    "--privacyMode",
    "Protected",
    "--non-interactive",
    "--report",
    reportPath,
    inputs[0],
  ];
}

function locateReport(searchRoot) {
  const reports = findFilesRecursively(searchRoot, (filePath) =>
    ["report.json", "assessment.json"].includes(
      path.basename(filePath).toLowerCase(),
    ),
  );
  reports.sort((left, right) => {
    const leftPreferred = path.basename(left).toLowerCase() === "report.json";
    const rightPreferred = path.basename(right).toLowerCase() === "report.json";
    return Number(rightPreferred) - Number(leftPreferred);
  });
  return reports[0] ?? null;
}

export function runAppcat({
  language,
  workspacePath,
  runDir,
  targets,
  capabilities,
  targetOs,
  mode,
}) {
  if (!workspacePath || !runDir) {
    throw new Error("workspacePath and runDir are required");
  }
  fs.mkdirSync(runDir, { recursive: true });
  const normalizedLanguage = String(language ?? "").toLowerCase();
  const destination = path.join(runDir, "report.json");

  if (normalizedLanguage === "java") {
    const check = checkJavaAppcat();
    if (!check.compatible) {
      throw new Error(`Java AppCAT is not ready: ${check.reason}`);
    }
    const temporaryOutput = fs.mkdtempSync(
      path.join(os.tmpdir(), "appcat-java-output-"),
    );
    try {
      const args = buildJavaAppcatArgs({
        workspacePath,
        outputPath: temporaryOutput,
        targets,
        capabilities,
        targetOs,
        mode,
      });
      const commandResult = runCommand(check.executablePath, args, {
        cwd: workspacePath,
      });
      const report = locateReport(temporaryOutput);
      if (!report) {
        throw new Error("Java AppCAT completed without producing report.json");
      }
      fs.copyFileSync(report, destination);
      return { language: "java", reportPath: destination, ...commandResult };
    } finally {
      fs.rmSync(temporaryOutput, { recursive: true, force: true });
    }
  }

  if (normalizedLanguage === "dotnet" || normalizedLanguage === ".net") {
    const executablePath = dotnetAppcatPath();
    const version = getDotnetAppcatVersion();
    if (!version || compareVersions(version, DOTNET_APPCAT_MINIMUM_VERSION) < 0) {
      throw new Error(`.NET AppCAT ${DOTNET_APPCAT_MINIMUM_VERSION} or later is not ready at ${executablePath}`);
    }
    const args = buildDotnetAppcatArgs({ workspacePath, runDir });
    const commandResult = runCommand(executablePath, args, { cwd: workspacePath });
    const report = locateReport(runDir);
    if (!report) {
      throw new Error(".NET AppCAT completed without producing report.json");
    }
    if (path.resolve(report) !== path.resolve(destination)) {
      fs.copyFileSync(report, destination);
    }
    return { language: "dotnet", reportPath: destination, ...commandResult };
  }
  throw new Error(`Unsupported AppCAT language: ${language ?? "missing"}`);
}

function escapeMarkdown(value) {
  return String(value).replaceAll("|", "\\|");
}

export function parseNcuOutput(output) {
  const groups = [];
  let currentGroup = null;
  for (const rawLine of String(output).split(/\r?\n/)) {
    const line = rawLine.replace(/\u001b\[[0-9;]*m/g, "").trim();
    if (!line) {
      continue;
    }
    const heading = /^(?:\[([^\]]+)\]|([^:]+):)$/.exec(line);
    if (heading) {
      currentGroup = { name: (heading[1] ?? heading[2]).trim(), updates: [] };
      groups.push(currentGroup);
      continue;
    }
    const update = /^(\S+)\s+(\S+)\s+(?:->|→)\s+(\S+)(?:\s+.*)?$/.exec(line);
    if (update) {
      currentGroup ??= { name: "Updates", updates: [] };
      if (!groups.includes(currentGroup)) {
        groups.push(currentGroup);
      }
      currentGroup.updates.push({
        package: update[1],
        current: update[2],
        latest: update[3],
      });
    }
  }
  return groups;
}

function renderNcuMarkdown(packageJsonPath, groups) {
  const lines = [
    "# JavaScript/TypeScript Dependency Assessment",
    "",
    `Package file: ${packageJsonPath}`,
    "",
  ];
  const updates = groups.flatMap((group) =>
    group.updates.map((update) => ({ group: group.name, ...update })),
  );
  if (updates.length === 0) {
    lines.push("No dependency updates were reported.", "");
    return lines.join("\n");
  }
  lines.push("| Group | Package | Current | Latest |", "| --- | --- | --- | --- |");
  for (const update of updates) {
    lines.push(
      `| ${escapeMarkdown(update.group)} | ${escapeMarkdown(update.package)} | ${escapeMarkdown(update.current)} | ${escapeMarkdown(update.latest)} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

export function buildNcuArgs(packageJsonPath) {
  return [
    "--yes",
    `npm-check-updates@${NCU_VERSION}`,
    "--format",
    "group",
    "--packageFile",
    packageJsonPath,
  ];
}

export function resolveNpxInvocation({
  platform = process.platform,
  execPath = process.execPath,
  env = process.env,
  existsSync = fs.existsSync,
} = {}) {
  if (platform !== "win32") return { command: "npx", prefixArgs: [] };
  const candidates = [
    env.npm_execpath ? path.join(path.dirname(env.npm_execpath), "npx-cli.js") : null,
    path.join(path.dirname(execPath), "node_modules", "npm", "bin", "npx-cli.js"),
    env.APPDATA ? path.join(env.APPDATA, "npm", "node_modules", "npm", "bin", "npx-cli.js") : null,
  ].filter(Boolean);
  const npxCliPath = candidates.find((candidate) => existsSync(candidate));
  if (!npxCliPath) {
    throw new Error("Unable to locate npx-cli.js for the current Windows Node.js installation");
  }
  return { command: execPath, prefixArgs: [npxCliPath] };
}

export function runNcu({
  packageJsonPath,
  outputDir,
  runId,
  findingsPath,
}) {
  if (!packageJsonPath || !outputDir) {
    throw new Error("packageJsonPath and outputDir are required");
  }
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`package.json was not found: ${packageJsonPath}`);
  }
  fs.mkdirSync(outputDir, { recursive: true });
  const { command, prefixArgs } = resolveNpxInvocation();
  const args = [...prefixArgs, ...buildNcuArgs(packageJsonPath)];
  const commandResult = runCommand(command, args, {
    cwd: path.dirname(packageJsonPath),
    allowedStatuses: [0, 1],
  });
  const groups = parseNcuOutput(commandResult.stdout);
  const reportPath = path.join(outputDir, "js-assessment-report.md");
  fs.writeFileSync(
    reportPath,
    renderNcuMarkdown(packageJsonPath, groups),
    "utf8",
  );

  let findingsIntegrated = false;
  let resultPath = null;
  if (findingsPath) {
    fs.mkdirSync(path.dirname(findingsPath), { recursive: true });
    const updates = groups.flatMap((group) =>
      group.updates.map((update) => ({ category: group.name, ...update }))
    );
    const summary = {
      input_name: "JavaScript/TypeScript dependency updates",
      analysis_method: "npm-check-updates",
      status: "success",
      result: {
        finding: `${updates.length} dependency update(s) available`,
        confidence: "high",
        evidence: [reportPath],
        values: updates,
      },
      execution_time_seconds: 0,
      timestamp: new Date().toISOString(),
      run_id: runId ?? null,
    };
    resultPath = path.join(outputDir, "js-assessment-result.json");
    fs.writeFileSync(resultPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    findingsIntegrated = true;
  }
  return {
    reportPath,
    resultPath,
    groups,
    findingsIntegrated,
    ...commandResult,
  };
}