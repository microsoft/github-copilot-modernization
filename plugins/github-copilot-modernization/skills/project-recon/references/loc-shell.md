# LOC Counting — Shell Templates

Zero-dependency templates that consume `language-extensions.yaml` +
`exclude-patterns.yaml` and produce a total LOC count per language.

---

## bash / zsh (Linux, macOS)

```bash
# === Inputs (fill from YAML files) ===
EXTS="cs cshtml razor"                      # extensions, no leading dot, space-separated
EXCLUDE_DIRS=".git node_modules bin obj packages TestResults publish"
SKIP_SUFFIXES=".min.js .min.css .bundle.js .bundle.css .d.ts .designer.cs .g.cs .generated.cs"
TARGET_DIR="."

# === Build -prune clause ===
PRUNE_EXPR=""
for d in $EXCLUDE_DIRS; do
  PRUNE_EXPR="$PRUNE_EXPR -name $d -o"
done
PRUNE_EXPR="${PRUNE_EXPR% -o}"

# === Build -name clause for extensions ===
EXT_EXPR=""
for e in $EXTS; do
  EXT_EXPR="$EXT_EXPR -iname *.$e -o"
done
EXT_EXPR="${EXT_EXPR% -o}"

# === Build skip-suffix clause ===
SKIP_EXPR=""
for s in $SKIP_SUFFIXES; do
  SKIP_EXPR="$SKIP_EXPR ! -name *$s"
done

# === Count ===
find "$TARGET_DIR" \
  -type d \( $PRUNE_EXPR \) -prune -o \
  -type f \( $EXT_EXPR \) $SKIP_EXPR -print \
  | xargs -d '\n' wc -l 2>/dev/null \
  | tail -n 1
```

### Pitfalls

- `xargs -d '\n'` is GNU-only. On macOS use `gxargs` (from coreutils) or `find ... -exec wc -l {} +`.
- Symlink loops: don't add `-L` unless intentional.

---

## PowerShell (Windows, also pwsh on macOS/Linux)

```powershell
# === Inputs ===
$Exts          = @('cs','cshtml','razor')
$ExcludeDirs   = @('.git','node_modules','bin','obj','packages','TestResults','publish')
$SkipSuffixes  = @('.min.js','.min.css','.bundle.js','.bundle.css','.d.ts','.designer.cs','.g.cs','.generated.cs')
$TargetDir     = '.'

# === Build glob filter ===
$Patterns = $Exts | ForEach-Object { "*.$_" }

# === Walk, filter, count ===
$loc = Get-ChildItem -Path $TargetDir -Recurse -File -Include $Patterns -ErrorAction SilentlyContinue |
  Where-Object {
    $path = $_.FullName -replace '\\', '/'
    $excluded = $false
    foreach ($d in $ExcludeDirs) {
      if ($path -match "/$([regex]::Escape($d))/") { $excluded = $true; break }
    }
    if ($excluded) { return $false }
    foreach ($s in $SkipSuffixes) {
      if ($_.Name.EndsWith($s)) { return $false }
    }
    return $true
  } |
  Get-Content |
  Measure-Object -Line

"$($loc.Lines) total lines"
```

### Pitfalls

- `Get-Content` is slow on large repos (>50K files). Acceptable for sizing.
- `-Include` only works with `-Recurse`. Don't switch to `-Filter` (single pattern only).
- Normalize path separators before exclude matching (Windows uses `\`).
