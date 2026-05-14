#!/usr/bin/env python3
"""
Monolith decomposition: build module-level dependency graph + SCC + DAG layers + LOC.
Pure data extractor (L1) for the project-decomposition skill — no grouping (LLM does that in L2).
Also provides --validate (L3) to score an agent-produced grouping (4 dimensions: outlier ratio, SCC integrity, group cycles, coverage).

Supported: Python, Java, C#, JavaScript/TypeScript (workspace monorepo, single package).
Requirements: pure stdlib only.

Usage:
  python decompose.py <project_root> [--json output.json]
  python decompose.py <project_root> --validate 'G1:ModA,ModB|G2:ModC,...'
"""
import os, re, sys, json, statistics, glob
from collections import defaultdict

# Pure stdlib — no external packages required

# ─── LOC counting helpers (formerly loc.py) ───

# ─── Skip patterns (universal + caller-supplied) ───
# SKIP_DIRS: only the universally-broken-when-counted directory.
# All other build/cache/vendor patterns are PASSED IN by the caller via --exclude,
# so the same exclusion list is used by classify-stage `find` AND fan-out skill.
# This avoids two competing skip-rule sources (script vs caller) drifting apart.
SKIP_DIRS = {'.git', 'node_modules'}

# Default empty — populated from --exclude argument at runtime (see decompose.main()).
# Format: list of path substrings; if substring matches any segment of the path
# RELATIVE to the walk root, the subtree is skipped.
SKIP_PATH_SUBSTRINGS = ()

# ─── Target-language source extensions ───
# LOC = lines of code in source files of the target language(s) ONLY.
# Static assets, generated content, data, and config files are 0 LOC.
# This is the SINGLE source of truth for "what is code" — used by module LOC,
# sub-dir LOC breakdown, coverage numerator/denominator.
# Map kept in sync with LANG_ALIASES canonical set (python/java/csharp/javascript).
LANG_EXTENSIONS = {
    'python':     {'.py', '.pyi'},
    'java':       {'.java'},
    'csharp':     {'.cs', '.cshtml', '.razor'},
    'javascript': {'.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx'},
}

# Default empty — populated from --lang in decompose.main(). When non-empty,
# only files whose extension (lowercase) is in this set count toward LOC.
TARGET_EXTS = frozenset()


# ─── LOC counting ───

def count_loc(filepath, comment_prefix='#'):
    """Count non-blank, non-comment lines."""
    try:
        loc = 0
        for line in open(filepath):
            s = line.strip()
            if s and not s.startswith(comment_prefix):
                loc += 1
        return loc
    except:
        return 0


# All code file extensions → comment prefix for LOC counting
# Source: derived from cloc/linguist language databases, covering 50+ common languages
_CODE_EXT_COMMENT = {
    # C-family (// comments)
    '.c': '//', '.cpp': '//', '.cc': '//', '.cxx': '//', '.h': '//', '.hpp': '//',
    '.hxx': '//', '.inl': '//', '.ipp': '//',
    '.cs': '//', '.m': '//', '.mm': '//',  # C#, Obj-C
    '.java': '//', '.kt': '//', '.kts': '//', '.scala': '//',
    '.go': '//', '.rs': '//', '.swift': '//', '.dart': '//',
    '.js': '//', '.jsx': '//', '.ts': '//', '.tsx': '//', '.mjs': '//', '.cjs': '//',
    '.php': '//', '.groovy': '//', '.gradle': '//',
    '.d': '//', '.v': '//',  # D, Verilog/V
    # Hash comments (#)
    '.py': '#', '.pyx': '#', '.pxd': '#',  # Python, Cython
    '.rb': '#', '.rake': '#', '.gemspec': '#',
    '.pl': '#', '.pm': '#',  # Perl
    '.sh': '#', '.bash': '#', '.zsh': '#', '.fish': '#',
    '.r': '#', '.R': '#',
    '.yaml': '#', '.yml': '#',
    '.toml': '#', '.cfg': '#', '.ini': '#', '.conf': '#',
    '.dockerfile': '#', '.tf': '#', '.hcl': '#',  # Docker, Terraform
    '.cmake': '#', '.mk': '#',
    '.ps1': '#', '.psm1': '#',  # PowerShell
    '.ex': '#', '.exs': '#',  # Elixir
    '.cr': '#',  # Crystal
    '.nim': '#',
    # Template/markup languages
    '.cshtml': '@*', '.razor': '@*',
    '.jsp': '<%--', '.jspx': '<%--',
    '.ftl': '<#--',
    '.erb': '<%#',
    '.ejs': '<%#',
    '.html': '<!--', '.htm': '<!--', '.xhtml': '<!--',
    '.vue': '<!--', '.svelte': '<!--',
    '.xml': '<!--', '.xsl': '<!--', '.xslt': '<!--',
    '.svg': '<!--', '.xaml': '<!--', '.csproj': '<!--', '.fsproj': '<!--',
    '.pom': '<!--',  # Maven POM (non-standard ext)
    # Style languages
    '.css': '/*', '.scss': '//', '.less': '//', '.sass': '//', '.styl': '//',
    # SQL
    '.sql': '--', '.plsql': '--', '.pgsql': '--',
    # Config/data (counted but typically small)
    '.json': '//',  # JSON has no comments, // won't match = counts all lines
    '.graphql': '#', '.gql': '#', '.proto': '//',
    # Lisp-family (;)
    '.clj': ';', '.cljs': ';', '.cljc': ';', '.el': ';', '.lisp': ';',
    '.scm': ';', '.rkt': ';',
    # Haskell-family (--)
    '.hs': '--', '.lhs': '--', '.elm': '--', '.purs': '--',
    # Lua
    '.lua': '--',
    # Erlang/Elixir
    '.erl': '%', '.hrl': '%',
    # Fortran
    '.f': 'C', '.f90': '!', '.f95': '!', '.f03': '!',
    # Other
    '.asm': ';', '.s': ';',  # Assembly
    '.bat': 'REM', '.cmd': 'REM',
    '.clojure': ';',
}
_SKIP_FILE_SUFFIXES = {'.min.js', '.min.css', '.bundle.js', '.bundle.css',
                       '.d.ts', '.designer.cs', '.g.cs', '.generated.cs'}
_BINARY_EXTS = {
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg', '.webp', '.tiff',
    '.woff', '.woff2', '.ttf', '.eot', '.otf',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.zip', '.gz', '.tar', '.rar', '.7z', '.bz2', '.xz',
    '.jar', '.war', '.ear', '.dll', '.exe', '.so', '.dylib', '.o', '.a', '.lib',
    '.class', '.pyc', '.pyo', '.pdb', '.obj',
    '.mp3', '.mp4', '.wav', '.avi', '.mov', '.flv', '.ogg', '.webm',
    '.sqlite', '.db', '.mdb',
    '.bin', '.dat', '.iso', '.img',
    '.lock',  # package lock files (often huge, not code)
    '.po', '.pot', '.mo',  # gettext translation files (not code)
}


def _is_text_file(filepath):
    """Check if a file is likely a text file by reading first 512 bytes."""
    ext = os.path.splitext(filepath)[1].lower()
    if ext in _BINARY_EXTS:
        return False
    try:
        with open(filepath, 'rb') as fh:
            chunk = fh.read(512)
            if b'\x00' in chunk:  # null byte = binary
                return False
        return True
    except:
        return False


def count_loc_any(filepath):
    """Count non-blank lines for any text file. Uses comment prefix if known, else counts all non-blank."""
    ext = os.path.splitext(filepath)[1]
    cp = _CODE_EXT_COMMENT.get(ext)
    if cp:
        return count_loc(filepath, cp)
    # Unknown ext: count all non-blank lines (no comment stripping)
    try:
        loc = 0
        for line in open(filepath):
            if line.strip():
                loc += 1
        return loc
    except:
        return 0


def count_all_code_loc(dir_path):
    """Count LOC of source files (extension in TARGET_EXTS) under a directory.
    Skips vendor/asset directories (SKIP_DIRS exact name + SKIP_PATH_SUBSTRINGS path match).
    Path-substring matching is done on the path RELATIVE to dir_path, so a module whose
    own root happens to match (e.g. a top-level App_Data module) is not skipped.
    Files whose extension is NOT in TARGET_EXTS contribute 0 LOC (assets, data, config)."""
    total_loc = 0
    total_files = 0
    base = os.path.abspath(dir_path)
    for r, dirs, files in os.walk(dir_path):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        # Path-substring filter on path RELATIVE to dir_path (so own root never matches)
        rel = os.path.relpath(os.path.abspath(r), base).replace(os.sep, '/')
        rel_norm = '/' + rel + '/' if rel != '.' else '/'
        if any(s in rel_norm for s in SKIP_PATH_SUBSTRINGS):
            dirs[:] = []
            continue
        for f in files:
            ext = os.path.splitext(f)[1].lower()
            if ext not in TARGET_EXTS:
                continue
            if any(f.endswith(s) for s in _SKIP_FILE_SUFFIXES):
                continue
            fp = os.path.join(r, f)
            total_loc += count_loc_any(fp)
            total_files += 1
    return total_loc, total_files


def count_loc_java(filepath):
    """Count LOC for Java (skip // and * comments)."""
    try:
        loc = 0
        for line in open(filepath):
            s = line.strip()
            if s and not s.startswith('//') and not s.startswith('*') and not s.startswith('/*'):
                loc += 1
        return loc
    except:
        return 0




# ─── Test Path Detection ───

_TEST_DIR_NAMES = {'test', 'tests', '__tests__'}
_TEST_FILE_PATTERNS = [
    r'.*Test\.java$', r'.*Tests\.cs$', r'.*_test\.py$', r'^test_.*\.py$',
    r'.*\.test\.[tj]sx?$', r'.*\.spec\.[tj]sx?$',
]
_TEST_FILE_RES = [re.compile(p) for p in _TEST_FILE_PATTERNS]

def _is_test_path(filepath):
    """Return True if filepath should be excluded as test code."""
    parts = filepath.replace('\\', '/').split('/')
    fname = parts[-1]
    # Check directory components
    for i, part in enumerate(parts[:-1]):
        if part in _TEST_DIR_NAMES:
            return True
        # src/test pattern
        if part == 'src' and i + 1 < len(parts) - 1 and parts[i+1] == 'test':
            return True
    # Check filename patterns
    for pat in _TEST_FILE_RES:
        if pat.match(fname):
            return True
    return False

def _is_test_module_name(name):
    """Return True if a module name looks like a test module."""
    # Case-sensitive checks
    parts = name.replace('\\', '/').split('/')
    for p in parts:
        for seg in p.split('.'):
            if seg in ('Test', 'Tests', 'test', 'tests', 'e2e', 'example', 'examples'):
                return True
    return False

# ─── Python Extraction ───

def extract_python(root):
    # Strategy 1: Odoo-style __manifest__.py / __openerp__.py
    manifests = {}
    for r, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        if '__manifest__.py' in files or '__openerp__.py' in files:
            mf = '__manifest__.py' if '__manifest__.py' in files else '__openerp__.py'
            mod_name = os.path.basename(r)
            manifests[mod_name] = os.path.join(r, mf)
    if len(manifests) > 5:  # Likely Odoo-style project
        return _extract_python_manifest(root, manifests)

    # Strategy 2: modules.txt (Frappe/ERPNext)
    modules_txt = None
    for r, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        if 'modules.txt' in files:
            modules_txt = os.path.join(r, 'modules.txt')
            break
    if modules_txt:
        return _extract_python_frappe(root, modules_txt)

    # Strategy 3: Standard Python package imports
    return _extract_python_packages(root)

def _extract_python_manifest(root, manifests):
    """Odoo-style: __manifest__.py with 'depends' list."""
    import ast
    modules = {}; edges = set()
    for mod_name, mf_path in manifests.items():
        mod_dir = os.path.dirname(mf_path)
        try:
            mf_content = open(mf_path, encoding='utf-8', errors='replace').read()
            mf_dict = ast.literal_eval(mf_content)
            deps = mf_dict.get('depends', [])
        except:
            deps = []
        loc, fc = count_all_code_loc(mod_dir)
        modules[mod_name] = {'loc': loc, 'files': fc, '_dir': mod_dir}
        for dep in deps:
            if dep in manifests and dep != mod_name:
                edges.add((mod_name, dep))
    return modules, edges

def _extract_python_frappe(root, modules_txt):
    """Frappe/ERPNext: modules.txt lists official modules, deps via import."""
    official = []
    try:
        for line in open(modules_txt, encoding='utf-8', errors='replace'):
            line = line.strip()
            if line:
                official.append(line.lower().replace(' ', '_'))
    except:
        pass

    if not official:
        return _extract_python_packages(root)

    pkg_root = os.path.dirname(modules_txt)
    pkg_name = os.path.basename(pkg_root)
    mod_set = set(official)

    modules = {}; edges = set()
    for mod in official:
        mod_path = os.path.join(pkg_root, mod)
        if not os.path.isdir(mod_path): continue
        loc, fc = count_all_code_loc(mod_path)
        modules[mod] = {'loc': loc, 'files': fc, 'package': pkg_name, '_dir': mod_path}
        for r, _, files in os.walk(mod_path):
            for f in files:
                if not f.endswith('.py'): continue
                try: content = open(os.path.join(r, f), encoding='utf-8', errors='replace').read()
                except: continue
                for imp in re.findall(rf'(?:from|import)\s+{re.escape(pkg_name)}\.(\w+)', content):
                    if imp in mod_set and imp != mod:
                        edges.add((mod, imp))
    return modules, edges

def _extract_python_packages(root):
    top_pkgs = [d for d in os.listdir(root)
                if os.path.isdir(os.path.join(root,d)) and
                os.path.exists(os.path.join(root,d,'__init__.py'))]
    if not top_pkgs: return None, None

    modules = {}; edges = set()
    for pkg in top_pkgs:
        pkg_path = os.path.join(root, pkg)
        sub_mods = [d for d in os.listdir(pkg_path)
                    if os.path.isdir(os.path.join(pkg_path,d)) and
                    os.path.exists(os.path.join(pkg_path,d,'__init__.py'))]

        for mod in sub_mods:
            mod_path = os.path.join(pkg_path, mod)
            loc, fc = count_all_code_loc(mod_path)
            modules[mod] = {'loc':loc,'files':fc,'package':pkg,'_dir':mod_path}

        mod_set = set(modules.keys())
        for mod in [m for m in modules if modules[m].get('package')==pkg]:
            for r,_,files in os.walk(os.path.join(pkg_path,mod)):
                for f in files:
                    if not f.endswith('.py'): continue
                    try: content = open(os.path.join(r,f), encoding='utf-8', errors='replace').read()
                    except: continue
                    for imp in re.findall(rf'(?:from|import)\s+{re.escape(pkg)}\.(\w+)', content):
                        if imp in mod_set and imp != mod: edges.add((mod,imp))
    return modules, edges

# ─── Java Extraction ───

def extract_java(root):
    # Strategy 1: Maven/Gradle multi-module
    maven_modules = {}
    for item in os.listdir(root):
        item_path = os.path.join(root, item)
        if not os.path.isdir(item_path): continue
        has_build = (os.path.exists(os.path.join(item_path,'pom.xml')) or
                     os.path.exists(os.path.join(item_path,'build.gradle')) or
                     os.path.exists(os.path.join(item_path,'build.gradle.kts')))
        has_java = os.path.exists(os.path.join(item_path,'src'))
        if not has_java:
            for r,_,files in os.walk(item_path):
                if any(f.endswith('.java') for f in files):
                    has_java = True; break
                if r.count(os.sep) - item_path.count(os.sep) > 3: break
        if has_build and has_java:
            maven_modules[item] = item_path

    # Handle nested Maven modules (aggregator POMs without direct Java source)
    nested_modules = {}
    for item in os.listdir(root):
        item_path = os.path.join(root, item)
        if not os.path.isdir(item_path): continue
        if item in maven_modules: continue  # Already discovered as a leaf module
        has_build = (os.path.exists(os.path.join(item_path,'pom.xml')) or
                     os.path.exists(os.path.join(item_path,'build.gradle')) or
                     os.path.exists(os.path.join(item_path,'build.gradle.kts')))
        if not has_build: continue
        # Check if this is an aggregator POM with sub-modules
        for sub in os.listdir(item_path):
            sub_path = os.path.join(item_path, sub)
            if not os.path.isdir(sub_path): continue
            sub_has_build = (os.path.exists(os.path.join(sub_path,'pom.xml')) or
                             os.path.exists(os.path.join(sub_path,'build.gradle')) or
                             os.path.exists(os.path.join(sub_path,'build.gradle.kts')))
            sub_has_java = os.path.exists(os.path.join(sub_path,'src'))
            if not sub_has_java:
                for r,_,files in os.walk(sub_path):
                    if any(f.endswith('.java') for f in files):
                        sub_has_java = True; break
                    if r.count(os.sep) - sub_path.count(os.sep) > 3: break
            if sub_has_build and sub_has_java:
                nested_modules[sub] = sub_path
    maven_modules.update(nested_modules)

    if len(maven_modules) >= 2:
        return _extract_java_maven(root, maven_modules)

    # Strategy 2: Component-based (ofbiz-component.xml in subdirectories)
    components = {}
    for subdir in ['framework', 'applications', 'plugins', 'themes', 'components']:
        sd = os.path.join(root, subdir)
        if not os.path.isdir(sd): continue
        for item in os.listdir(sd):
            item_path = os.path.join(sd, item)
            if os.path.isdir(item_path) and os.path.exists(os.path.join(item_path,'ofbiz-component.xml')):
                components[item] = item_path
    if components:
        return _extract_java_components(root, components)

    # Strategy 3: Package-level analysis (true single-module)
    return _extract_java_packages(root)

def _collect_java_files(root_path):
    """Collect all .java files under a path, preferring src/main/java."""
    src_main = os.path.join(root_path, 'src', 'main', 'java')
    search_root = src_main if os.path.isdir(src_main) else root_path
    results = []
    for r, dirs, files in os.walk(search_root):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for f in files:
            if f.endswith('.java'):
                fpath = os.path.join(r, f)
                try:
                    content = open(fpath, encoding='utf-8', errors='replace').read()
                    results.append((fpath, content))
                except:
                    pass
    return results

def _build_pkg_to_mod(mod_files):
    """Build package -> module reverse map from collected files.

    Split-package handling: when multiple modules declare classes under the
    same package name (legal but anti-pattern, e.g. openmrs api+web both in
    org.openmrs), assign ownership to the module with the most classes in
    that package. Falls back to first-seen on ties.
    """
    # Count classes per (pkg, mod)
    pkg_mod_counts = {}  # {pkg: {mod_name: class_count}}
    for mod_name, files in mod_files.items():
        for _, content in files:
            pkg_m = re.search(r'package\s+([\w.]+)\s*;', content)
            if pkg_m:
                pkg = pkg_m.group(1)
                pkg_mod_counts.setdefault(pkg, {}).setdefault(mod_name, 0)
                pkg_mod_counts[pkg][mod_name] += 1

    pkg_to_mod = {}
    for pkg, mod_counts in pkg_mod_counts.items():
        # Owner = module with most classes; ties broken by first insertion order
        pkg_to_mod[pkg] = max(mod_counts.items(), key=lambda kv: kv[1])[0]
    return pkg_to_mod

def _resolve_import_to_module(imp, pkg_to_mod, source_mod):
    """Given an import like 'org.openmrs.api.PatientService', find which module owns it."""
    parts = imp.split('.')
    for i in range(len(parts), 0, -1):
        candidate = '.'.join(parts[:i])
        if candidate in pkg_to_mod:
            target = pkg_to_mod[candidate]
            if target != source_mod:
                return target
            return None
    return None

def _extract_java_maven(root, maven_modules):
    modules = {}; edges = set()
    mod_files = {}

    for mod_name, mod_path in maven_modules.items():
        java_files = _collect_java_files(mod_path)
        mod_files[mod_name] = java_files
        mod_loc, mod_fc = count_all_code_loc(mod_path)
        modules[mod_name] = {'loc': mod_loc, 'files': mod_fc, '_dir': mod_path}

    pkg_to_mod = _build_pkg_to_mod(mod_files)

    for mod_name, files in mod_files.items():
        for _, content in files:
            for imp in re.findall(r'import\s+(?:static\s+)?([\w.]+)\s*;', content):
                target = _resolve_import_to_module(imp, pkg_to_mod, mod_name)
                if target:
                    edges.add((mod_name, target))

    return modules, edges

def _extract_java_components(root, components):
    modules = {}; edges = set()
    mod_files = {}

    for comp_name, comp_path in components.items():
        java_files = _collect_java_files(comp_path)
        if not java_files:
            for sub in ['src', 'groovyScripts']:
                sp = os.path.join(comp_path, sub)
                if os.path.isdir(sp):
                    for r, dirs, files in os.walk(sp):
                        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
                        for f in files:
                            if f.endswith('.java') or f.endswith('.groovy'):
                                fpath = os.path.join(r, f)
                                try:
                                    content = open(fpath, encoding='utf-8', errors='replace').read()
                                    java_files.append((fpath, content))
                                except:
                                    pass

        mod_files[comp_name] = java_files
        comp_loc, comp_fc = count_all_code_loc(comp_path)
        modules[comp_name] = {'loc': comp_loc, 'files': comp_fc, '_dir': comp_path}

    pkg_to_mod = _build_pkg_to_mod(mod_files)

    for comp_name, files in mod_files.items():
        for _, content in files:
            for imp in re.findall(r'import\s+(?:static\s+)?([\w.]+)\s*;', content):
                target = _resolve_import_to_module(imp, pkg_to_mod, comp_name)
                if target:
                    edges.add((comp_name, target))

    return modules, edges

def _extract_java_packages(root):
    """Single-module Java: infer modules from top-level package segments."""
    all_pkgs = []
    all_files = []
    for r, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for f in files:
            if not f.endswith('.java'): continue
            fpath = os.path.join(r, f)
            try: content = open(fpath, encoding='utf-8', errors='replace').read()
            except: continue
            pkg_m = re.search(r'package\s+([\w.]+)\s*;', content)
            if pkg_m:
                all_pkgs.append(pkg_m.group(1))
                all_files.append((fpath, content, pkg_m.group(1)))

    if not all_pkgs: return None, None

    from os.path import commonprefix
    prefix = commonprefix(all_pkgs)
    if prefix.endswith('.'): prefix = prefix[:-1]
    elif '.' in prefix: prefix = prefix[:prefix.rindex('.')]

    modules = defaultdict(lambda: {'loc':0,'files':0})
    mod_files = defaultdict(list)
    mod_dirs = {}  # Track directory for each module

    for fpath, content, pkg in all_files:
        if not pkg.startswith(prefix):
            continue
        remainder = pkg[len(prefix):]
        if remainder.startswith('.'): remainder = remainder[1:]
        mod_name = remainder.split('.')[0] if remainder else '_root'

        modules[mod_name]['loc'] += count_loc_java(fpath)
        modules[mod_name]['files'] += 1
        mod_files[mod_name].append((fpath, content))

        # Infer module directory from file path
        if mod_name not in mod_dirs and mod_name != '_root':
            # Find the directory named mod_name in the path
            parts = fpath.replace('\\', '/').split('/')
            for i, p in enumerate(parts):
                if p == mod_name and i < len(parts) - 1:
                    mod_dirs[mod_name] = '/'.join(parts[:i+1])
                    break

    # Set _dir on modules and recalculate LOC using all text files
    for mod_name in modules:
        if mod_name in mod_dirs:
            # Ensure _dir is under the project root (avoid escaping to parent dirs)
            candidate = os.path.abspath(mod_dirs[mod_name])
            if not candidate.startswith(os.path.abspath(root) + os.sep):
                continue
            modules[mod_name]['_dir'] = mod_dirs[mod_name]
            loc, fc = count_all_code_loc(mod_dirs[mod_name])
            modules[mod_name]['loc'] = loc
            modules[mod_name]['files'] = fc

    pkg_to_mod = {}
    for mod_name, files in mod_files.items():
        for _, content in files:
            pkg_m = re.search(r'package\s+([\w.]+)\s*;', content)
            if pkg_m:
                pkg_to_mod[pkg_m.group(1)] = mod_name

    edges = set()
    for mod_name, files in mod_files.items():
        for _, content in files:
            for imp in re.findall(r'import\s+(?:static\s+)?([\w.]+)\s*;', content):
                target = _resolve_import_to_module(imp, pkg_to_mod, mod_name)
                if target:
                    edges.add((mod_name, target))

    return dict(modules), edges

# ─── JavaScript/TypeScript Extraction ───

def _parse_pnpm_workspace(filepath):
    """Parse pnpm-workspace.yaml for package patterns (no yaml lib needed)."""
    patterns = []
    try:
        in_packages = False
        for line in open(filepath, encoding='utf-8', errors='replace'):
            stripped = line.strip()
            if stripped.startswith('packages:'):
                in_packages = True
                continue
            if in_packages:
                if stripped.startswith('-'):
                    val = stripped.lstrip('- ').strip().strip("'\"")
                    if val:
                        patterns.append(val)
                elif stripped and not stripped.startswith('#'):
                    break
    except:
        pass
    return patterns


def _read_json(filepath):
    """Read a JSON file, return dict or None."""
    try:
        return json.loads(open(filepath, encoding='utf-8', errors='replace').read())
    except:
        return None


def _js_extensions():
    return ('.js', '.ts', '.tsx', '.jsx')


def _is_js_file(f):
    """Check if file is a countable JS/TS file."""
    if f.endswith('.d.ts') or f.endswith('.min.js'):
        return False
    return f.endswith(_js_extensions())


def extract_javascript(root):
    """Extract JS/TS modules. Strategy 1: workspace monorepo, Strategy 2: single package."""
    workspace_patterns = []
    
    # Try pnpm-workspace.yaml
    pnpm_ws = os.path.join(root, 'pnpm-workspace.yaml')
    if os.path.exists(pnpm_ws):
        workspace_patterns = _parse_pnpm_workspace(pnpm_ws)
    
    # Try package.json workspaces
    if not workspace_patterns:
        pkg = _read_json(os.path.join(root, 'package.json'))
        if pkg:
            ws = pkg.get('workspaces', None)
            if isinstance(ws, list):
                workspace_patterns = ws
            elif isinstance(ws, dict):
                workspace_patterns = ws.get('packages', [])
    
    # Try lerna.json
    if not workspace_patterns:
        lerna = _read_json(os.path.join(root, 'lerna.json'))
        if lerna:
            workspace_patterns = lerna.get('packages', [])
    
    if workspace_patterns:
        return _extract_js_workspaces(root, workspace_patterns)
    
    # Strategy 2: Single package with src/
    if os.path.exists(os.path.join(root, 'package.json')) and os.path.isdir(os.path.join(root, 'src')):
        return _extract_js_single(root)
    
    return None, None


def _extract_js_workspaces(root, patterns):
    """Extract modules from workspace monorepo."""
    # Expand glob patterns to find workspace package directories
    ws_dirs = {}  # name -> path
    
    for pattern in patterns:
        # Expand glob
        expanded = glob.glob(os.path.join(root, pattern))
        for dirpath in expanded:
            if not os.path.isdir(dirpath):
                continue
            pkg_json_path = os.path.join(dirpath, 'package.json')
            if not os.path.exists(pkg_json_path):
                continue
            pkg = _read_json(pkg_json_path)
            if pkg:
                name = pkg.get('name', os.path.basename(dirpath))
            else:
                name = os.path.basename(dirpath)
            ws_dirs[name] = dirpath
    
    if not ws_dirs:
        return None, None
    
    # Remove parent workspace dirs that contain child workspaces (avoid double-counting)
    abs_dirs = {name: os.path.abspath(p) for name, p in ws_dirs.items()}
    to_remove_parents = set()
    for n1, p1 in abs_dirs.items():
        for n2, p2 in abs_dirs.items():
            if n1 != n2 and p2.startswith(p1 + os.sep):
                to_remove_parents.add(n1)
    for name in to_remove_parents:
        del ws_dirs[name]
    
    modules = {}
    name_set = set(ws_dirs.keys())
    
    for name, dirpath in ws_dirs.items():
        loc, fc = count_all_code_loc(dirpath)
        modules[name] = {
            'loc': loc,
            'files': fc,
            '_dir': dirpath,
        }
    
    # Extract edges from dependencies
    edges = set()
    for name, dirpath in ws_dirs.items():
        pkg = _read_json(os.path.join(dirpath, 'package.json'))
        if not pkg:
            continue
        all_deps = {}
        all_deps.update(pkg.get('dependencies', {}))
        all_deps.update(pkg.get('devDependencies', {}))
        for dep_name in all_deps:
            if dep_name in name_set and dep_name != name:
                edges.add((name, dep_name))
    
    # Filter out test-only modules
    to_remove = []
    for name, info in modules.items():
        if _is_test_module_name(name) and info['loc'] == 0:
            to_remove.append(name)
    for name in to_remove:
        del modules[name]
        edges = {(s, t) for s, t in edges if s != name and t != name}
    
    # Also filter modules with 0 effective LOC that are test modules
    to_remove = []
    for name in list(modules.keys()):
        if _is_test_module_name(name):
            to_remove.append(name)
    for name in to_remove:
        del modules[name]
        edges = {(s, t) for s, t in edges if s != name and t != name}
    
    # Remove modules with 0 LOC entirely
    to_remove = [n for n, info in modules.items() if info['loc'] == 0 and info['files'] == 0]
    for name in to_remove:
        del modules[name]
        edges = {(s, t) for s, t in edges if s != name and t != name}
    
    # Clean edges to only reference existing modules
    edges = {(s, t) for s, t in edges if s in modules and t in modules}
    
    return modules, edges


def _extract_js_single(root):
    """Extract modules from single package with src/ directory."""
    src_dir = os.path.join(root, 'src')
    modules = {}
    
    for item in sorted(os.listdir(src_dir)):
        item_path = os.path.join(src_dir, item)
        if not os.path.isdir(item_path) or item in SKIP_DIRS:
            continue
        loc, fc = count_all_code_loc(item_path)
        if fc > 0:
            modules[item] = {
                'loc': loc,
                'files': fc,
                '_dir': item_path,
            }
    
    if not modules:
        return None, None
    
    # Filter test modules
    to_remove = [n for n in modules if _is_test_module_name(n)]
    for name in to_remove:
        del modules[name]
    
    # Extract edges from import/require cross-references
    mod_set = set(modules.keys())
    edges = set()
    import_re = re.compile(r'''(?:import\s+.*?from\s+['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\))''')
    
    for mod_name in list(modules.keys()):
        mod_dir = modules[mod_name]['_dir']
        for r, dirs, files in os.walk(mod_dir):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
            for f in files:
                if not _is_js_file(f):
                    continue
                fpath = os.path.join(r, f)
                try:
                    content = open(fpath, encoding='utf-8', errors='replace').read()
                except:
                    continue
                for m in import_re.finditer(content):
                    imp = m.group(1) or m.group(2)
                    if not imp or not imp.startswith('.'):
                        continue
                    # Resolve relative to file's location within src/
                    rel = os.path.relpath(os.path.dirname(fpath), src_dir)
                    resolved = os.path.normpath(os.path.join(rel, imp))
                    top_dir = resolved.split(os.sep)[0]
                    if top_dir in mod_set and top_dir != mod_name:
                        edges.add((mod_name, top_dir))
    
    return modules, edges


# ─── C# Extraction ───

def extract_csharp(root):
    """C#: use .csproj files as module boundaries, scan ProjectReference + .props chains."""
    csproj_files = {}
    for r, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for f in files:
            if f.endswith('.csproj'):
                mod_name = os.path.splitext(f)[0]
                csproj_files[mod_name] = os.path.join(r, f)

    if not csproj_files:
        return None, None

    modules = {}
    edges = set()

    # Extract direct ProjectReference edges
    for mod_name, csproj_path in csproj_files.items():
        mod_dir = os.path.dirname(csproj_path)
        loc, fc = count_all_code_loc(mod_dir)
        modules[mod_name] = {'loc': loc, 'files': fc, '_dir': mod_dir}

        try:
            csproj_content = open(csproj_path, encoding='utf-8', errors='replace').read()
            for ref in re.findall(r'<ProjectReference\s+Include="([^"]+)"', csproj_content):
                ref_name = os.path.splitext(os.path.basename(ref.replace('\\', '/')))[0]
                if ref_name in csproj_files and ref_name != mod_name:
                    edges.add((mod_name, ref_name))
        except:
            pass

    # Collect ALL props/targets files
    props_files = {}
    for r, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for f in files:
            if f.endswith('.props') or f.endswith('.targets'):
                fpath = os.path.abspath(os.path.join(r, f))
                try:
                    props_files[fpath] = open(fpath, encoding='utf-8', errors='replace').read()
                except:
                    pass

    def _get_refs_from_props(content):
        return [os.path.splitext(os.path.basename(ref.replace('\\', '/')))[0]
                for ref in re.findall(r'<ProjectReference\s+Include="([^"]+)"', content)]

    def _resolve_imports(filepath, content, visited=None):
        """Recursively resolve all ProjectReferences through Import chains."""
        if visited is None:
            visited = set()
        if filepath in visited:
            return set()
        visited.add(filepath)

        refs = set()
        for ref_name in _get_refs_from_props(content):
            refs.add(ref_name)

        file_dir = os.path.dirname(filepath)
        for imp in re.findall(r'<Import\s+Project="([^"]+)"', content):
            imp_path = os.path.normpath(os.path.join(file_dir, imp.replace('\\', '/')))
            imp_abs = os.path.abspath(imp_path)
            if imp_abs in props_files:
                refs.update(_resolve_imports(imp_abs, props_files[imp_abs], visited))
            imp_name = os.path.basename(imp.replace('\\', '/'))
            for known_path, known_content in props_files.items():
                if os.path.basename(known_path) == imp_name and known_path not in visited:
                    refs.update(_resolve_imports(known_path, known_content, visited))

        return refs

    # Resolve implicit refs via Directory.Build.props chain
    for mod_name, csproj_path in csproj_files.items():
        mod_dir = os.path.dirname(os.path.abspath(csproj_path))
        all_refs = set()

        check_dir = mod_dir
        root_abs = os.path.abspath(root)
        while check_dir and len(check_dir) >= len(root_abs):
            dbp = os.path.join(check_dir, 'Directory.Build.props')
            if dbp in props_files:
                all_refs.update(_resolve_imports(dbp, props_files[dbp]))
            check_dir = os.path.dirname(check_dir)

        try:
            cc = open(csproj_path, encoding='utf-8', errors='replace').read()
            csproj_abs = os.path.abspath(csproj_path)
            all_refs.update(_resolve_imports(csproj_abs, cc))
        except:
            pass

        for ref_name in all_refs:
            if ref_name in csproj_files and ref_name != mod_name:
                edges.add((mod_name, ref_name))

    return modules, edges

# ─── Analysis ───

def _tarjan_scc(nodes, edges):
    """Tarjan's SCC algorithm — pure stdlib."""
    index_counter = [0]
    stack = []
    on_stack = set()
    index = {}
    lowlink = {}
    result = []
    adj = defaultdict(list)
    for s, t in edges:
        adj[s].append(t)

    def strongconnect(v):
        index[v] = index_counter[0]
        lowlink[v] = index_counter[0]
        index_counter[0] += 1
        stack.append(v)
        on_stack.add(v)
        for w in adj[v]:
            if w not in index:
                strongconnect(w)
                lowlink[v] = min(lowlink[v], lowlink[w])
            elif w in on_stack:
                lowlink[v] = min(lowlink[v], index[w])
        if lowlink[v] == index[v]:
            component = set()
            while True:
                w = stack.pop()
                on_stack.discard(w)
                component.add(w)
                if w == v:
                    break
            result.append(component)

    # Use iterative deepening to avoid recursion limit
    sys.setrecursionlimit(max(10000, len(nodes) * 3))
    for n in nodes:
        if n not in index:
            strongconnect(n)
    return result


def _quantile(values, p):
    """Linear-interpolated quantile p ∈ [0, 1]. Returns 0 if values empty.

    Matches the formula used by _stats() and _detect_outlier_modules — single
    source of truth so all three callers (graph stats, module-LOC outliers,
    group-LOC outliers) report identical p25/p50/p75 on the same input.
    """
    if not values:
        return 0
    s = sorted(values)
    n = len(s)
    if n == 1:
        return s[0]
    k = (n - 1) * p
    f = int(k)
    c = min(f + 1, n - 1)
    return s[f] + (s[c] - s[f]) * (k - f)


def _detect_outlier_modules(modules):
    """Outlier test (Q3 + 1.5*IQR AND > 2*median) on module LOC.

    NOTE: uses index-based Q1/Q3 (locs[n//4], locs[3n//4]) — classic boxplot
    convention. This is intentionally distinct from _quantile() which uses
    linear interpolation; changing this would shift the long-standing module
    outlier baseline. Group-LOC outliers and graph-stat percentiles use the
    interpolated _quantile() instead.
    """
    locs = sorted(info['loc'] for info in modules.values() if info['loc'] > 0)
    if len(locs) < 4:
        return []
    n = len(locs)
    median = locs[n // 2]
    q1 = locs[n // 4]
    q3 = locs[(3 * n) // 4]
    iqr = q3 - q1
    threshold = max(q3 + 1.5 * iqr, 2 * median)
    return [(m, info) for m, info in modules.items() if info['loc'] > threshold]


def analyze(modules, edges, lang=None, root=None):
    """SCC analysis and DAG-layer computation. No grouping (LLM does that).""" 

    all_nodes = list(modules.keys())

    # SCC detection
    sccs = _tarjan_scc(all_nodes, edges)
    mega_sccs = [s for s in sccs if len(s) > 1]

    # Compute topological layer for each module (longest-path from roots)
    _fwd = defaultdict(set)
    _rev = defaultdict(set)
    for s, t in edges:
        _fwd[s].add(t)
        _rev[t].add(s)
    topo_layer = {}
    roots = [n for n in all_nodes if not _rev.get(n)]
    if not roots:  # all nodes in cycles, fallback: no layer penalty
        for n in all_nodes:
            topo_layer[n] = 0
    else:
        # BFS longest-path from roots
        from collections import deque
        in_deg = {n: len(_rev.get(n, set()) & set(all_nodes)) for n in all_nodes}
        queue = deque()
        for n in all_nodes:
            topo_layer[n] = 0
        for r in roots:
            queue.append(r)
        while queue:
            n = queue.popleft()
            for nb in _fwd.get(n, set()):
                if nb in topo_layer:
                    topo_layer[nb] = max(topo_layer[nb], topo_layer[n] + 1)
                    in_deg[nb] -= 1
                    if in_deg[nb] <= 0:
                        queue.append(nb)
        # Nodes not reached (in cycles) get layer 0
        for n in all_nodes:
            if n not in topo_layer:
                topo_layer[n] = 0

    # Group modules by topological layer (informational; not a final grouping)
    layer_groups = defaultdict(list)
    for n in all_nodes:
        layer_groups[topo_layer.get(n, 0)].append(n)

    sorted_layers = sorted(layer_groups.keys())
    print(f"\n── DAG Layers ({len(sorted_layers)} layers) ──")
    for layer in sorted_layers:
        members = layer_groups[layer]
        loc = sum(modules[m]['loc'] for m in members)
        print(f"  Layer {layer}: {len(members)} modules, {loc:,} LOC")

    return sccs, mega_sccs, modules, edges, topo_layer

def _compute_graph_statistics(modules, edges, sccs, mega_sccs, topo_layer):
    """Compute graph statistics for L1 output. Pure data — no judgment.

    Returns dict with:
      modules, edges, dag_depth
      in_deg_stats, out_deg_stats: {min, p25, median, p75, max, mean}
      hub_ratio: max_in / avg_in (1.0 if no edges)
      hub_module: (name, in_degree) of highest in-degree module
      scc_count, mega_scc_count, max_scc_size
      wcc_count, wcc_sizes (sorted desc)
    """
    n = len(modules)
    in_deg = defaultdict(int)
    out_deg = defaultdict(int)
    for s, t in edges:
        out_deg[s] += 1
        in_deg[t] += 1

    in_vals = [in_deg.get(m, 0) for m in modules]
    out_vals = [out_deg.get(m, 0) for m in modules]

    def _stats(vals):
        if not vals:
            return {'min': 0, 'p25': 0, 'median': 0, 'p75': 0, 'max': 0, 'mean': 0.0}
        s = sorted(vals)
        k = len(s)
        # Quantile via shared _quantile() helper — single source of truth (see also
        # _validate_grouping). Linear-interpolated, matches numpy.quantile default.
        return {
            'min': s[0], 'p25': _quantile(s, 0.25), 'median': _quantile(s, 0.5),
            'p75': _quantile(s, 0.75), 'max': s[-1], 'mean': sum(s) / k,
        }

    in_stats = _stats(in_vals)
    out_stats = _stats(out_vals)
    avg_in = in_stats['mean']
    hub_ratio = (in_stats['max'] / avg_in) if avg_in > 0 else 0.0
    # Hub module = highest in-degree (ties → alphabetical first)
    hub_module = ('', 0)
    if in_vals:
        max_in = in_stats['max']
        candidates = sorted(m for m in modules if in_deg.get(m, 0) == max_in)
        if candidates:
            hub_module = (candidates[0], max_in)

    # Top-3 hubs by in-degree (ties → alphabetical) for hub-chain detection
    top_hubs = sorted(modules, key=lambda m: (-in_deg.get(m, 0), m))[:3]
    top_hubs_with_in = [(m, in_deg.get(m, 0)) for m in top_hubs]

    # Structural conditions for Path A promotion (a/b/c).
    # (a) external_inbound_to_hub  = |{X → H : X ∉ direct_preds(H)}|
    # (b) leaves_outbound_to_non_set = |{P → Y : P ∈ direct_preds(H), Y ∉ {H} ∪ direct_preds(H)}|
    # (c) hub-chain: top-2 hubs connected by an edge (H' → H or H → H'); pick most-depended-on as H.
    hub_struct = {
        'hub_external_inbound': 0,
        'hub_leaves_outbound_external': 0,
        'hub_chain_top2_connected': False,
        'hub_chain_top3_indegrees': [in_deg.get(m, 0) for m in top_hubs],
    }
    if hub_module[1] > 0:
        H = hub_module[0]
        leaves = {s for s, t in edges if t == H}
        member = {H} | leaves
        for s, t in edges:
            if t == H and s not in leaves:
                hub_struct['hub_external_inbound'] += 1
            if s in leaves and t not in member:
                hub_struct['hub_leaves_outbound_external'] += 1
        if len(top_hubs) >= 2:
            h1, h2 = top_hubs[0], top_hubs[1]
            if (h2, h1) in edges or (h1, h2) in edges:
                hub_struct['hub_chain_top2_connected'] = True

    # SCCs
    scc_sizes = [len(s) for s in sccs] if sccs else []
    max_scc = max(scc_sizes) if scc_sizes else 0

    # Weakly-connected components
    adj_u = defaultdict(set)
    for s, t in edges:
        adj_u[s].add(t)
        adj_u[t].add(s)
    visited = set()
    wcc_sizes = []
    for start in modules:
        if start in visited:
            continue
        comp = set()
        stack = [start]
        while stack:
            v = stack.pop()
            if v in comp:
                continue
            comp.add(v)
            for nb in adj_u.get(v, set()):
                if nb in modules and nb not in comp:
                    stack.append(nb)
        visited |= comp
        wcc_sizes.append(len(comp))
    wcc_sizes.sort(reverse=True)

    layer = topo_layer or {}
    dag_depth = (max(layer.values()) + 1) if layer else 1

    return {
        'modules': n,
        'edges': len(edges),
        'dag_depth': dag_depth,
        'in_deg_stats': in_stats,
        'out_deg_stats': out_stats,
        'hub_ratio': hub_ratio,
        'hub_module': hub_module,
        'top_hubs': top_hubs_with_in,
        'hub_struct': hub_struct,
        'scc_count': len(sccs) if sccs else 0,
        'mega_scc_count': len(mega_sccs) if mega_sccs else 0,
        'max_scc_size': max_scc,
        'wcc_count': len(wcc_sizes),
        'wcc_sizes': wcc_sizes,
    }


def _classify_topology(stats):
    """Heuristic path classification for agent anchoring. Returns ('Path X', reason).

    Rules mirror references/topology-thresholds.md (Step 1 lookup) — two paths only:
    Path A (Hub-dominated) and Path B (DAG-like). Pre-step 1 (WCC prefilter) and
    Pre-step 2 (mega-SCC lock) are caller's responsibility — they affect grouping
    strategy, not path classification of the post-prelude graph.

    Treat as a HINT — LLM may override with structural reading. Constants kept in
    sync with topology-thresholds.md.
    """
    HUB_LOW, HUB_HIGH = 3, 5
    MEGA_SCC_PCT = 0.50
    n_mod = stats.get('modules', 0) or 1
    edges_n = stats.get('edges', 0)
    hub_ratio = stats.get('hub_ratio', 0.0)
    max_scc = stats.get('max_scc_size', 0)
    wcc_sizes = stats.get('wcc_sizes', []) or []
    dag_depth = stats.get('dag_depth', 1)
    hs = stats.get('hub_struct') or {}

    # Pre-prelude advisories — emitted as part of the reason so the agent runs the prelude.
    pre = []
    if max_scc >= MEGA_SCC_PCT * n_mod:
        pre.append(f'mega-SCC detected (max SCC {max_scc} ≥ {MEGA_SCC_PCT*100:.0f}% of {n_mod}) — lock as 1 group, classify periphery')
    non_trivial_wccs = [w for w in wcc_sizes if w >= 3]
    if len(non_trivial_wccs) >= 2:
        pre.append(f'{len(non_trivial_wccs)} non-trivial WCCs — classify each independently')
    pre_msg = ('; PRELUDE: ' + ' | '.join(pre)) if pre else ''

    # Path A clear-hub
    if hub_ratio >= HUB_HIGH:
        if (hs.get('hub_external_inbound', 0) == 0
                and hs.get('hub_leaves_outbound_external', 0) == 0
                and not hs.get('hub_chain_top2_connected')):
            return ('Path A', f'hub-ratio {hub_ratio:.2f} ≥ {HUB_HIGH}; pure star (ext_in=0, leaves_out=0, no hub-chain) — single group {{H ∪ leaves}}{pre_msg}')
        flags = []
        if hs.get('hub_external_inbound', 0) > 0: flags.append('a')
        if hs.get('hub_leaves_outbound_external', 0) > 0: flags.append('b')
        if hs.get('hub_chain_top2_connected'): flags.append('c')
        return ('Path A', f'hub-ratio {hub_ratio:.2f} ≥ {HUB_HIGH}; not pure star ({",".join(flags)}) — H isolated{pre_msg}')
    # Gray zone
    if HUB_LOW < hub_ratio < HUB_HIGH:
        a = hs.get('hub_external_inbound', 0) > 0
        b = hs.get('hub_leaves_outbound_external', 0) > 0
        c = bool(hs.get('hub_chain_top2_connected'))
        if a or b or c:
            flags = ','.join(x for x, on in [('a', a), ('b', b), ('c', c)] if on)
            return ('Path A', f'gray-zone hub-ratio {hub_ratio:.2f}; structural ({flags}) holds — H isolated{pre_msg}')
        return ('Path B', f'gray-zone hub-ratio {hub_ratio:.2f}; no structural condition (a/b/c) holds → DAG-like{pre_msg}')
    # Path B default (low hub-ratio or no edges)
    if edges_n == 0 and n_mod >= 2:
        return ('Path B', f'no edges → all components disconnected; per-component DAG-like{pre_msg}')
    if dag_depth >= 2:
        return ('Path B', f'hub-ratio {hub_ratio:.2f} ≤ {HUB_LOW}; layered DAG depth={dag_depth}{pre_msg}')
    return ('Path B', f'hub-ratio {hub_ratio:.2f} ≤ {HUB_LOW}; default DAG-like{pre_msg}')


def _print_graph_statistics(stats):
    """Render graph statistics block. Raw numbers only — no PASS/FAIL/judgment."""
    print(f"\n── Graph Statistics ──")
    print(f"  Modules          = {stats['modules']}")
    print(f"  Edges            = {stats['edges']}")
    print(f"  DAG depth        = {stats['dag_depth']} layer(s)")
    ind = stats['in_deg_stats']
    out = stats['out_deg_stats']
    print(f"  In-degree        min={ind['min']} p25={ind['p25']:.1f} median={ind['median']:.1f} p75={ind['p75']:.1f} max={ind['max']} mean={ind['mean']:.2f}")
    print(f"  Out-degree       min={out['min']} p25={out['p25']:.1f} median={out['median']:.1f} p75={out['p75']:.1f} max={out['max']} mean={out['mean']:.2f}")
    hub_name, hub_in = stats['hub_module']
    print(f"  Hub-ratio        = {stats['hub_ratio']:.2f}  (max in-deg / mean in-deg; top hub: {hub_name} with in={hub_in})")
    top_hubs = stats.get('top_hubs') or []
    if top_hubs:
        top_str = ', '.join(f"{m}(in={d})" for m, d in top_hubs)
        print(f"  Top hubs (in)    = [{top_str}]")
    hs = stats.get('hub_struct') or {}
    if hs:
        chain_str = "yes" if hs.get('hub_chain_top2_connected') else "no"
        print(f"  Hub structure    = external_inbound_to_H={hs.get('hub_external_inbound', 0)}, leaves_outbound_to_non_set={hs.get('hub_leaves_outbound_external', 0)}, top2_hubs_connected={chain_str}")
        print(f"                     # Path A §Identify: gray-zone (3<hub-ratio<5) → Path A if ANY of: ext_inbound>0 (a), leaves_outbound>0 (b), top2_connected=yes (c). Clear-hub (≥5) is Path A regardless. Otherwise Path B.")
    print(f"  SCCs             = {stats['scc_count']} total, {stats['mega_scc_count']} non-trivial, max size = {stats['max_scc_size']}")
    wcc_str = ', '.join(str(s) for s in stats['wcc_sizes'][:5])
    if len(stats['wcc_sizes']) > 5:
        wcc_str += ', ...'
    print(f"  WCCs             = {stats['wcc_count']} component(s); sizes: [{wcc_str}]")
    suggested, reason = _classify_topology(stats)
    print(f"  Suggested path  = {suggested}  # {reason}")
    print(f"  (HINT only — verify by reading topology-thresholds.md against numbers above; override if your structural reading disagrees.)")


def print_results(modules, edges, sccs, mega_sccs, lang, topo_layer=None):
    total_loc = sum(m['loc'] for m in modules.values())
    bidir = sum(1 for s, t in edges if (t, s) in edges) // 2

    print(f"\n{'='*60}")
    print(f"Language: {lang}")
    print(f"Modules: {len(modules)}, Edges: {len(edges)}, Bidirectional: {bidir}")
    print(f"Total LOC: {total_loc:,}")

    # SCC info
    print(f"\nSCCs: {len(sccs)} ({len(mega_sccs)} non-trivial)")
    for scc in mega_sccs:
        scc_loc = sum(modules[m]['loc'] for m in scc if m in modules)
        print(f"  MEGA-SCC ({len(scc)}, {scc_loc:,} LOC): {sorted(scc)}")

    # DAG layers
    layer = topo_layer or {}
    if layer:
        max_layer = max(layer.values()) if layer else 0
        print(f"\nDAG depth: {max_layer + 1} layers")

    # Graph statistics block — raw numbers for LLM topology classification
    _print_graph_statistics(_compute_graph_statistics(modules, edges, sccs, mega_sccs, layer))

    # Compute in/out degree per module
    from collections import defaultdict
    in_deg = defaultdict(int)
    out_deg = defaultdict(int)
    for s, t in edges:
        out_deg[s] += 1
        in_deg[t] += 1

    # Compute statistics for annotations
    all_locs = [m['loc'] for m in modules.values()]
    median_loc = sorted(all_locs)[len(all_locs) // 2] if all_locs else 0
    small_thresh = max(0.25 * median_loc, 500)  # at least 500 LOC
    oversized_thresh = max(4 * median_loc, 50000)  # at least 50K
    n_modules = len(modules)
    target_groups = max(2, int(n_modules ** 0.5))
    ideal_group_loc = total_loc // target_groups if target_groups else total_loc

    print(f"\n── Grouping Hints ──")
    print(f"  Target group count (√N): {target_groups}")
    print(f"  Ideal group LOC: ~{ideal_group_loc:,}")
    print(f"  Median module LOC: {median_loc:,}")
    print(f"  Small threshold (<0.25×median): {small_thresh:,.0f}")
    print(f"  Oversized threshold (>4×median): {oversized_thresh:,.0f}")

    # Find same-layer affinities (modules on same layer with mutual edges)
    layer_peers = defaultdict(list)
    for m in modules:
        layer_peers[layer.get(m, 0)].append(m)

    affinities = []
    for lyr, peers in layer_peers.items():
        if len(peers) < 2:
            continue
        peer_set = set(peers)
        for i, a in enumerate(peers):
            for b in peers[i+1:]:
                mutual = sum(1 for s, t in edges if (s == a and t == b) or (s == b and t == a))
                if mutual > 0:
                    affinities.append((a, b, lyr, mutual))

    # Find disconnected subgraphs
    adj_undirected = defaultdict(set)
    for s, t in edges:
        adj_undirected[s].add(t)
        adj_undirected[t].add(s)
    visited = set()
    subgraphs = []
    for start in modules:
        if start in visited:
            continue
        component = set()
        queue = [start]
        while queue:
            node = queue.pop()
            if node in component:
                continue
            component.add(node)
            for nb in adj_undirected.get(node, []):
                if nb in modules and nb not in component:
                    queue.append(nb)
        visited |= component
        subgraphs.append(component)

    # Module table sorted by layer desc (high layer = foundation) then LOC desc
    print(f"\n── Module Table ──")
    print(f"  {'Module':<40} {'LOC':>8} {'Files':>5} {'Layer':>5} {'In':>4} {'Out':>4}  {'Flags'}")
    print(f"  {'─'*40} {'─'*8} {'─'*5} {'─'*5} {'─'*4} {'─'*4}  {'─'*30}")

    for m in sorted(modules.keys(), key=lambda x: (-layer.get(x, 0), -modules[x]['loc'])):
        info = modules[m]
        flags = []
        if info['loc'] < small_thresh:
            # Find DAG-adjacent modules for merge hint
            neighbors = set()
            for s, t in edges:
                if s == m:
                    neighbors.add(t)
                elif t == m:
                    neighbors.add(s)
            same_layer_neighbors = [n for n in neighbors if layer.get(n, 0) == layer.get(m, 0)]
            adj_layer_neighbors = [n for n in neighbors if abs(layer.get(n, 0) - layer.get(m, 0)) == 1]
            merge_targets = same_layer_neighbors or adj_layer_neighbors
            if merge_targets:
                targets_str = ', '.join(sorted(merge_targets)[:2])
                flags.append(f"⚠️ small → merge with {targets_str}")
            else:
                flags.append("⚠️ small")
        if info['loc'] > oversized_thresh:
            flags.append("⚠️ oversized → needs sub-split")
        total_deg = in_deg.get(m, 0) + out_deg.get(m, 0)
        if total_deg > 0 and total_deg >= n_modules * 0.3:
            flags.append(f"🔀 high fan-out ({total_deg}) → group boundary")
        flag_str = '; '.join(flags)
        print(f"  {m:<40} {info['loc']:>8,} {info['files']:>5} {layer.get(m,0):>5} {in_deg.get(m,0):>4} {out_deg.get(m,0):>4}  {flag_str}")

    # Same-layer affinities
    if affinities:
        print(f"\n── Same-Layer Affinities (strong grouping candidates) ──")
        for a, b, lyr, mutual in sorted(affinities, key=lambda x: -x[3]):
            combined = modules[a]['loc'] + modules[b]['loc']
            print(f"  Layer {lyr}: {a} ↔ {b} ({mutual} mutual edges, combined {combined:,} LOC)")

    # Disconnected subgraphs
    if len(subgraphs) > 1:
        print(f"\n── Disconnected Subgraphs ({len(subgraphs)}) ──")
        for i, sg in enumerate(sorted(subgraphs, key=lambda x: -sum(modules[m]['loc'] for m in x))):
            sg_loc = sum(modules[m]['loc'] for m in sg)
            print(f"  Subgraph {i}: {len(sg)} modules, {sg_loc:,} LOC — {', '.join(sorted(sg)[:5])}{'...' if len(sg) > 5 else ''}")

    # Outlier module detail (sub-directory breakdown for confirmed outliers; informational only)
    oversized = _detect_outlier_modules(modules)
    if oversized:
        print(f"\n── Outlier Modules — Sub-directory Breakdown ──")
        for m, info in sorted(oversized, key=lambda x: -x[1]['loc']):
            mod_path = info.get('_dir', '')
            if not mod_path or not os.path.isdir(mod_path):
                print(f"\n  {m} ({info['loc']:,} LOC) — path not available for breakdown")
                continue
            print(f"\n  {m} ({info['loc']:,} LOC):")
            subdirs = []
            root_files_loc = 0
            root_files_count = 0
            for entry in sorted(os.listdir(mod_path)):
                entry_path = os.path.join(mod_path, entry)
                if os.path.isdir(entry_path):
                    if entry in SKIP_DIRS:
                        continue
                    eloc, _ = count_all_code_loc(entry_path)
                    if eloc > 0:
                        subdirs.append((entry, eloc))
                elif os.path.isfile(entry_path):
                    if _is_text_file(entry_path):
                        with open(entry_path, 'r', errors='replace') as f:
                            root_files_loc += sum(1 for line in f if line.strip())
                        root_files_count += 1
            for sd, sloc in sorted(subdirs, key=lambda x: -x[1]):
                pct = sloc * 100 / info['loc'] if info['loc'] > 0 else 0
                print(f"    {sd + '/':<35} {sloc:>8,} LOC  ({pct:.0f}%)")
            if root_files_loc > 0:
                pct = root_files_loc * 100 / info['loc'] if info['loc'] > 0 else 0
                print(f"    {'(root files)':<35} {root_files_loc:>8,} LOC  ({pct:.0f}%)")

    # Edge list
    print(f"\n── Edge List ({len(edges)} edges) ──")
    for s, t in sorted(edges, key=lambda e: (layer.get(e[0], 0), e[0], e[1])):
        print(f"  {s} -> {t}")


def save_json(modules, edges, sccs, mega_sccs, lang, topo_layer, output_path):
    result = {
        'language': lang,
        'total_modules': len(modules),
        'total_edges': len(edges),
        'dag_depth': (max(topo_layer.values()) + 1) if topo_layer else 1,
        'sccs': [sorted(s) for s in mega_sccs],
        'modules': {},
        'edges': [{'source': s, 'target': t} for s, t in sorted(edges)],
    }
    from collections import defaultdict
    in_deg = defaultdict(int)
    out_deg = defaultdict(int)
    for s, t in edges:
        out_deg[s] += 1
        in_deg[t] += 1
    for m in sorted(modules.keys(), key=lambda x: (topo_layer.get(x, 0), -modules[x]['loc'])):
        result['modules'][m] = {
            'loc': modules[m]['loc'],
            'files': modules[m]['files'],
            'layer': topo_layer.get(m, 0),
            'in_degree': in_deg.get(m, 0),
            'out_degree': out_deg.get(m, 0),
        }
    with open(output_path, 'w', encoding='utf-8') as f:
        import json
        json.dump(result, f, indent=2)
    print(f"\nJSON saved to: {output_path}")



# ─── Validate (Quality Gate) ───

def _parse_groups_arg(s):
    """Parse 'G1:ModA,ModB|G2:ModC,ModD' → {'G1': ['ModA','ModB'], ...}."""
    out = {}
    for chunk in s.split('|'):
        chunk = chunk.strip()
        if not chunk:
            continue
        if ':' not in chunk:
            raise ValueError(f"Bad group spec (missing ':'): {chunk!r}")
        name, mods = chunk.split(':', 1)
        out[name.strip()] = [m.strip() for m in mods.split(',') if m.strip()]
    return out


def _scan_namespace_ownership(module_dir, lang):
    """Scan source files in module_dir and return the set of namespaces/packages declared there."""
    namespaces = set()
    if not os.path.isdir(module_dir):
        return namespaces
    if lang == 'csharp':
        ext_set = {'.cs'}
        ns_re = re.compile(r'^\s*namespace\s+([\w.]+)', re.MULTILINE)
    elif lang == 'java':
        ext_set = {'.java'}
        ns_re = re.compile(r'^\s*package\s+([\w.]+)\s*;', re.MULTILINE)
    else:
        return namespaces  # JS/Python: no namespace-based edge detection for sub-modules
    for r, dirs, files in os.walk(module_dir):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for f in files:
            if os.path.splitext(f)[1].lower() not in ext_set:
                continue
            fpath = os.path.join(r, f)
            try:
                content = open(fpath, encoding='utf-8', errors='replace').read()
                for m in ns_re.finditer(content):
                    namespaces.add(m.group(1))
            except:
                pass
    return namespaces


def _scan_import_refs(module_dir, lang):
    """Scan source files in module_dir and return the set of namespaces/packages referenced (imported/used)."""
    refs = set()
    if not os.path.isdir(module_dir):
        return refs
    if lang == 'csharp':
        ext_set = {'.cs'}
        ref_re = re.compile(r'^\s*using\s+(?:static\s+)?(?!global)([\w.]+)\s*;', re.MULTILINE)
    elif lang == 'java':
        ext_set = {'.java'}
        ref_re = re.compile(r'^\s*import\s+(?:static\s+)?([\w.]+(?:\.\*)?)\s*;', re.MULTILINE)
    else:
        return refs
    for r, dirs, files in os.walk(module_dir):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for f in files:
            if os.path.splitext(f)[1].lower() not in ext_set:
                continue
            fpath = os.path.join(r, f)
            try:
                content = open(fpath, encoding='utf-8', errors='replace').read()
                for m in ref_re.finditer(content):
                    ref = m.group(1)
                    if ref.endswith('.*'):
                        ref = ref[:-2]
                    refs.add(ref)
            except:
                pass
    return refs


def _compute_virtual_edges(all_modules, virtual_names, non_virtual_names, langs):
    """Compute real edges between virtual sub-modules (and between virtual and non-virtual)
    by scanning namespace declarations and import/using references.

    Returns a set of (source, target) edges.
    """
    # Determine which lang to use for namespace scanning
    lang = None
    for l in (langs if isinstance(langs, list) else langs.split(',')):
        if l in ('csharp', 'java'):
            lang = l
            break
    if not lang:
        return set()  # JS/Python: fall back to fan-out (no namespace-based scanning)

    # Build namespace → module ownership map for ALL modules (virtual + non-virtual)
    ns_to_module = {}
    scan_modules = list(virtual_names) + list(non_virtual_names)
    for mname in scan_modules:
        minfo = all_modules.get(mname)
        if not minfo or not minfo.get('_dir'):
            continue
        for ns in _scan_namespace_ownership(minfo['_dir'], lang):
            # Longest-prefix wins: if multiple modules declare sub-namespaces,
            # we keep the most specific (but for now, last-write-wins per exact ns)
            ns_to_module[ns] = mname

    # For each module, scan its imports and resolve to owning modules
    edges = set()
    for mname in scan_modules:
        minfo = all_modules.get(mname)
        if not minfo or not minfo.get('_dir'):
            continue
        refs = _scan_import_refs(minfo['_dir'], lang)
        for ref in refs:
            # Try exact match first, then progressively shorter prefixes
            candidate = ref
            while candidate:
                if candidate in ns_to_module:
                    target = ns_to_module[candidate]
                    if target != mname:
                        edges.add((mname, target))
                    break
                # Shorten: 'A.B.C' → 'A.B'
                dot = candidate.rfind('.')
                if dot < 0:
                    break
                candidate = candidate[:dot]

    return edges


def _expand_virtual_submodules(modules, edges, groups, langs=None):
    """Expand 'ParentMod/sub/path' entries in a grouping spec into virtual sub-modules.

    For each name containing '/', locate the parent module, compute LOC via count_all_code_loc()
    over <parent_dir>/<subpath> (honors --exclude / SKIP_DIRS).

    Edge computation: for C#/Java, scans namespace/package declarations and using/import
    references to build REAL edges between virtual sub-modules (and to/from non-virtual modules).
    For other languages, falls back to fan-out inheritance (parent edges replicated to all children).

    The parent is then removed from the working modules dict so it is not flagged as 'missing'
    nor counted twice.

    Returns (new_modules, new_edges, parent_to_children). Original arguments are NOT mutated.
    """
    virtual = {}
    for g, mods in groups.items():
        for m in mods:
            if '/' not in m or m in modules:
                continue
            parent = m.split('/', 1)[0]
            subpath = m.split('/', 1)[1]
            if parent not in modules:
                continue
            parent_dir = modules[parent].get('_dir')
            if not parent_dir:
                print(f"⚠️  Virtual sub-module '{m}': parent module has no directory; skipping.")
                continue
            sub_dir = os.path.join(parent_dir, subpath)
            if not os.path.isdir(sub_dir):
                print(f"⚠️  Virtual sub-module '{m}': directory not found ({sub_dir})")
                continue
            loc, fc = count_all_code_loc(sub_dir)
            virtual[m] = {'loc': loc, 'files': fc, '_dir': sub_dir, '_parent': parent}
    if not virtual:
        return modules, edges, {}
    parent_to_children = {}
    for vname, vinfo in virtual.items():
        parent_to_children.setdefault(vinfo['_parent'], []).append(vname)
    new_modules = {**modules, **virtual}

    # Determine non-virtual modules (real modules that are NOT being split)
    non_virtual = {m for m in modules if m not in parent_to_children}

    # Try source-level edge scanning for C#/Java
    virtual_edges = set()
    use_source_scan = False
    if langs:
        lang_list = langs if isinstance(langs, list) else langs.split(',')
        if any(l in ('csharp', 'java') for l in lang_list):
            virtual_edges = _compute_virtual_edges(new_modules, set(virtual.keys()), non_virtual, langs)
            use_source_scan = True

    if use_source_scan:
        # Source-level scan: keep edges between non-virtual modules as-is,
        # drop parent edges, add scanned edges
        new_edges = set()
        for s, t in edges:
            if s not in parent_to_children and t not in parent_to_children:
                new_edges.add((s, t))
            # Edges from non-virtual to parent → fan to children (parent is consumer/provider)
            elif s not in parent_to_children and t in parent_to_children:
                # s depends on parent — which child? Source scan handles this
                pass
            elif s in parent_to_children and t not in parent_to_children:
                # parent depends on t — which child? Source scan handles this
                pass
            # parent↔parent: source scan handles
        new_edges |= virtual_edges
    else:
        # Fallback: Cartesian fan-out (JS/Python or no lang specified)
        new_edges = set()
        for s, t in edges:
            ss = parent_to_children.get(s, [s])
            tt = parent_to_children.get(t, [t])
            for s2 in ss:
                for t2 in tt:
                    if s2 != t2:
                        new_edges.add((s2, t2))

    for p in parent_to_children:
        new_modules.pop(p, None)

    if use_source_scan:
        print(f"\n[virtual sub-modules] expanded {len(virtual)} sub-paths from {len(parent_to_children)} parent module(s) with SOURCE-LEVEL edge scanning:")
        for p, kids in parent_to_children.items():
            parent_orig_edges = sum(1 for s, t in edges if s == p or t == p)
            kid_edges = sum(1 for s, t in virtual_edges if s in kids or t in kids)
            print(f"  {p} → {len(kids)} virtual children, {parent_orig_edges} parent edge(s) → {kid_edges} scanned edge(s)")
        # Report inter-virtual edges (edges between children of same parent)
        for p, kids in parent_to_children.items():
            kid_set = set(kids)
            inter = [(s, t) for s, t in virtual_edges if s in kid_set and t in kid_set]
            if inter:
                print(f"  ⚠️  {p}: {len(inter)} intra-parent edge(s) detected between virtual children (potential cycle source)")
                for s, t in inter:
                    print(f"      {s} → {t}")
    else:
        print(f"\n[virtual sub-modules] expanded {len(virtual)} sub-paths from {len(parent_to_children)} parent module(s) with CARTESIAN fan-out (fallback):")
        for p, kids in parent_to_children.items():
            print(f"  {p} → {len(kids)} virtual children, parent's {sum(1 for s,t in edges if s==p or t==p)} edge(s) inherited")
    return new_modules, new_edges, parent_to_children


def validate_grouping(modules, edges, groups, sccs=None, original_edges=None, parent_to_children=None):
    """Compute per-group LOC, outliers, SCC violations, group cycles, coverage warnings.

    Quality scores reported (4 dimensions): Outlier ratio, SCC integrity, Group cycles,
    Coverage. The script never declares PASS/FAIL — the agent judges each dimension
    against the band tables in references/topology-thresholds.md (Path A / Path B).

    `original_edges` and `parent_to_children` are accepted for backward compatibility
    when virtual sub-module expansion occurred; they are no longer used for any
    printed metric (Cross density was removed as a quality score in v16).
    """
    # mod → group
    mod2g = {}
    for g, mods in groups.items():
        for m in mods:
            mod2g[m] = g

    # Coverage: missing / unknown / duplicates
    declared = [m for ms in groups.values() for m in ms]
    dup = sorted({m for m in declared if declared.count(m) > 1})
    unknown = sorted(set(declared) - set(modules.keys()))
    missing = sorted(set(modules.keys()) - set(declared))

    # Per-group cohesion + LOC (cohesion still printed in the per-group table for context;
    # it is NOT aggregated into a quality score — TMQ was removed in v16).
    per_group = {}
    for g, mods in groups.items():
        internal = sum(1 for s, t in edges if mod2g.get(s) == g and mod2g.get(t) == g)
        cross = sum(1 for s, t in edges
                    if (mod2g.get(s) == g) ^ (mod2g.get(t) == g))
        total = internal + cross
        cohesion = (internal / total) if total else 0.0
        loc = sum(modules[m]['loc'] for m in mods if m in modules)
        per_group[g] = {'modules': len(mods), 'loc': loc, 'internal': internal,
                        'cross': cross, 'cohesion': cohesion}

    locs = [v['loc'] for v in per_group.values()]
    max_loc = max(locs) if locs else 0

    # Outlier detection (relative): a group is an outlier if its LOC is both
    # statistically extreme (> Q3 + 1.5*IQR) AND substantially above median (> 2x median).
    outliers = []
    if len(locs) >= 4:
        sorted_locs = sorted(locs)
        q1 = _quantile(sorted_locs, 0.25)
        q3 = _quantile(sorted_locs, 0.75)
        iqr = q3 - q1
        median = _quantile(sorted_locs, 0.5)
        upper = q3 + 1.5 * iqr
        for g, v in per_group.items():
            if v['loc'] > upper and v['loc'] > 2 * median:
                outliers.append((g, v['loc']))

    # SCC violations: any non-trivial SCC whose members span >1 group → grouping broke a cycle
    scc_violations = []
    if sccs:
        for scc in sccs:
            if len(scc) <= 1:
                continue
            scc_groups = {mod2g.get(m) for m in scc if m in mod2g}
            scc_groups.discard(None)
            if len(scc_groups) > 1:
                scc_violations.append((sorted(scc), sorted(scc_groups)))

    # Group-level cycle detection: build group→group adjacency from cross edges, find SCCs.
    group_nodes = list(per_group.keys())
    group_edges = set()
    for s, t in edges:
        gs, gt = mod2g.get(s), mod2g.get(t)
        if gs and gt and gs != gt:
            group_edges.add((gs, gt))
    group_sccs = _tarjan_scc(group_nodes, group_edges)
    group_cycles = [sorted(scc) for scc in group_sccs if len(scc) > 1]

    # Print report
    print("\n=== Grouping Validation ===")
    print(f"Groups: {len(groups)}  Modules covered: {len(declared) - len(dup)}/{len(modules)}")
    if missing:
        print(f"⚠️  MISSING ({len(missing)}): {', '.join(missing)}")
    if unknown:
        print(f"⚠️  UNKNOWN modules in spec: {', '.join(unknown)}")
    if dup:
        print(f"⚠️  DUPLICATE assignments: {', '.join(dup)}")

    print(f"\n{'Group':<20} {'Mods':>5} {'LOC':>10} {'Int':>5} {'Cross':>6} {'Cohesion':>9}")
    for g in sorted(per_group):
        v = per_group[g]
        print(f"{g:<20} {v['modules']:>5} {v['loc']:>10,} {v['internal']:>5} {v['cross']:>6} {v['cohesion']:>9.3f}")

    # ── Quality Scores (raw data — no PASS/FAIL judgment by this script) ──
    # The agent judges these against path-specific bands in
    # references/topology-thresholds.md (Path A / Path B). This script never fails.
    print(f"\n=== Group Quality Scores ===")

    # Outlier ratio = max(group LOC) / median(group LOC)
    median_group_loc = 0
    if locs:
        sorted_locs = sorted(locs)
        n_l = len(sorted_locs)
        median_group_loc = sorted_locs[n_l // 2] if n_l % 2 else (sorted_locs[n_l // 2 - 1] + sorted_locs[n_l // 2]) / 2
    outlier_ratio = (max_loc / median_group_loc) if median_group_loc > 0 else 0.0
    outlier_names = ', '.join(f"{g}({l:,})" for g, l in outliers) if outliers else 'none'

    # If ratio >= 2.5 (Critical) but IQR detected no outlier, explicitly name the max group
    # so agents cannot claim "no target to split".
    ratio_flag = ""
    if outlier_ratio >= 2.5 and not outliers:
        max_group = max(per_group.items(), key=lambda kv: kv[1]['loc'])[0]
        ratio_flag = f"  ⚠️  CRITICAL: ratio ≥ 2.5 — largest group '{max_group}' ({max_loc:,} LOC) requires sub-split even though IQR found no statistical outlier."

    print(f"Outlier ratio  = {outlier_ratio:.2f}    (max={max_loc:,} / median={median_group_loc:,.0f}; statistical outliers: {outlier_names})")
    if ratio_flag:
        print(ratio_flag)
    print(f"SCC integrity  = {len(scc_violations)} violation(s)   (non-trivial module-SCCs split across groups)")
    if scc_violations:
        for scc, gs in scc_violations[:3]:
            print(f"                 SCC {{{', '.join(scc[:5])}{'...' if len(scc) > 5 else ''}}} → groups: {gs}")
    print(f"Group cycles   = {len(group_cycles)}   (non-trivial group-level SCCs)")
    if group_cycles:
        for cyc in group_cycles[:3]:
            print(f"                 cycle: {' → '.join(cyc)} → {cyc[0]}")
    cov_parts = []
    if missing: cov_parts.append(f"{len(missing)} missing")
    if unknown: cov_parts.append(f"{len(unknown)} unknown")
    if dup: cov_parts.append(f"{len(dup)} duplicate")
    cov_str = '; '.join(cov_parts) if cov_parts else 'complete (0 missing, 0 unknown, 0 duplicate)'
    print(f"Coverage       = {cov_str}")

    # No PASS/FAIL — agent judges quality against topology-thresholds.md.
    # Always exit 0 so callers see the data; agent decides whether to act.
    return 0


def module_loc_breakdown(modules, target_mod):
    """Print sub-directory LOC breakdown for a single module. Used for sub-split planning."""
    if target_mod not in modules:
        avail = ', '.join(sorted(modules.keys())[:10])
        print(f"Module '{target_mod}' not found. Available (first 10): {avail}")
        return 2
    info = modules[target_mod]
    mod_dir = info.get('_dir')
    if not mod_dir or not os.path.isdir(mod_dir):
        print(f"Module '{target_mod}' has no directory path available (loc={info['loc']})")
        return 2

    print(f"\n=== Sub-directory LOC for {target_mod} ({info['loc']:,} LOC, {info.get('files',0)} files) ===")
    print(f"Path: {mod_dir}\n")
    subdirs = []
    root_loc = 0
    root_files = 0
    for entry in sorted(os.listdir(mod_dir)):
        ep = os.path.join(mod_dir, entry)
        if os.path.isdir(ep):
            if entry in SKIP_DIRS:
                continue
            # Also honor --exclude path patterns at this top level (App_Data, wwwroot/lib, etc.).
            # Match the entry as a path segment (same convention as SKIP_PATH_SUBSTRINGS '/<seg>/').
            seg = '/' + entry + '/'
            if any(seg == s or s.endswith('/' + entry + '/') for s in SKIP_PATH_SUBSTRINGS):
                continue
            eloc, fc = count_all_code_loc(ep)
            if eloc > 0:
                subdirs.append((entry, eloc, fc))
        elif os.path.isfile(ep):
            ext = os.path.splitext(ep)[1].lower()
            if ext not in TARGET_EXTS:
                continue
            if any(ep.endswith(s) for s in _SKIP_FILE_SUFFIXES):
                continue
            root_loc += count_loc_any(ep)
            root_files += 1

    print(f"{'Sub-directory':<40} {'LOC':>10} {'Files':>7} {'%':>6}")
    print('-' * 65)
    for name, sloc, fc in sorted(subdirs, key=lambda x: -x[1]):
        pct = sloc * 100.0 / info['loc'] if info['loc'] else 0
        print(f"{name + '/':<40} {sloc:>10,} {fc:>7} {pct:>5.1f}%")
    if root_loc > 0:
        pct = root_loc * 100.0 / info['loc'] if info['loc'] else 0
        print(f"{'(root files)':<40} {root_loc:>10,} {root_files:>7} {pct:>5.1f}%")
    total = sum(s[1] for s in subdirs) + root_loc
    print('-' * 65)
    print(f"{'sum':<40} {total:>10,}")
    delta = abs(total - info['loc'])
    if info['loc'] and delta / info['loc'] > 0.05:
        print(f"⚠️  sum differs from module LOC by >5% ({delta:,}); some files may be excluded by extension filter.")
    return 0


# ─── Main ───

def main():
    global TARGET_EXTS, SKIP_PATH_SUBSTRINGS
    if len(sys.argv) < 2:
        print("Usage:")
        print("  python decompose.py <project_root> --lang '<lang>' [--exclude 'pat1,pat2,...'] [--json output.json] [--profile-json]")
        print("  python decompose.py <project_root> --lang '<lang>' --validate 'G1:ModA,ModB|G2:ModC,ModD|...' [--exclude '...']")
        print("  python decompose.py <project_root> --lang '<lang>' --module-loc <ModuleName> [--exclude '...']")
        print("")
        print("--lang:           REQUIRED. python|java|csharp|javascript (or aliases py/cs/c#/dotnet/js/ts/node).")
        print("                  Multi-language projects: comma-separated, e.g. --lang csharp,javascript")
        print("--exclude:        comma-separated path substrings to skip (e.g. 'bin,obj,node_modules,wwwroot/lib').")
        print("                  Each pattern is matched as a path SEGMENT relative to the walk root.")
        print("                  Caller is responsible for picking patterns appropriate for the project's")
        print("                  language/framework — the script ships with NO defaults beyond '.git'.")
        print("                  (.gitignore is glob-shaped, not a directory list — workflow-planning derives")
        print("                  BASELINE skip set from project type and passes it explicitly here.)")
        print("--profile-json:   instead of human-readable text, emit a structured ProjectProfile JSON to stdout")
        print("                  (scope_path, languages, skip_patterns, total_loc, modules[], dag_layers[],")
        print("                  topology_hints, scc/edge/depth summary, warnings). Suppresses normal output.")
        sys.exit(1)

    root = os.path.abspath(sys.argv[1])
    json_out = None
    validate_spec = None
    module_loc_target = None
    profile_json = '--profile-json' in sys.argv

    # In profile-json mode, suppress normal stdout (the JSON is the only output).
    # Stash the original print so we can restore it for the JSON dump.
    _real_print = print
    if profile_json:
        import builtins
        _silent = lambda *a, **k: None
        builtins.print = _silent

    if '--exclude' in sys.argv:
        idx = sys.argv.index('--exclude')
        if idx + 1 >= len(sys.argv):
            _real_print("--exclude requires a comma-separated pattern list (e.g. 'bin,obj,node_modules').")
            sys.exit(2)
        raw = sys.argv[idx + 1]
        patterns = []
        for p in raw.split(','):
            p = p.strip().strip('/')
            if not p:
                continue
            # Normalize to '/<pattern>/' so the substring match is on whole path segments
            patterns.append('/' + p + '/')
        SKIP_PATH_SUBSTRINGS = tuple(patterns)
        print(f"Excluding path patterns: {', '.join(patterns) if patterns else '(none)'}")
    if '--json' in sys.argv:
        idx = sys.argv.index('--json')
        json_out = sys.argv[idx+1] if idx+1 < len(sys.argv) else os.path.join(root, '.dependency-graph.json')
    if '--validate' in sys.argv:
        if profile_json:
            _real_print("--validate and --profile-json are mutually exclusive: --profile-json suppresses normal stdout (graph stats, hints, validation report) and emits only the ProjectProfile JSON. Run validate as a separate invocation without --profile-json.")
            sys.exit(2)
        idx = sys.argv.index('--validate')
        if idx + 1 >= len(sys.argv):
            _real_print("--validate requires a grouping spec: 'G1:ModA,ModB|G2:ModC,...'")
            sys.exit(2)
        validate_spec = sys.argv[idx + 1]
    if '--module-loc' in sys.argv:
        idx = sys.argv.index('--module-loc')
        if idx + 1 >= len(sys.argv):
            _real_print("--module-loc requires a module name")
            sys.exit(2)
        module_loc_target = sys.argv[idx + 1]

    extractors = {'python': extract_python, 'java': extract_java, 'csharp': extract_csharp,
                  'javascript': extract_javascript}
    # Canonical language names (single source of truth). Aliases normalize to these.
    LANG_ALIASES = {
        'py': 'python', 'python': 'python', 'python3': 'python',
        'java': 'java',
        'cs': 'csharp', 'csharp': 'csharp', 'c#': 'csharp', 'dotnet': 'csharp', 'net': 'csharp',
        'js': 'javascript', 'javascript': 'javascript', 'ts': 'javascript', 'typescript': 'javascript',
        'node': 'javascript', 'nodejs': 'javascript',
    }
    if '--lang' not in sys.argv:
        print(f"--lang is required. Canonical: {sorted(set(LANG_ALIASES.values()))}")
        print(f"Aliases accepted: {sorted(LANG_ALIASES.keys())}")
        print("Multi-language projects: pass comma-separated, e.g. --lang csharp,javascript")
        sys.exit(2)
    idx=sys.argv.index('--lang')
    if idx+1>=len(sys.argv):
        print("--lang requires a value"); sys.exit(2)
    raw_langs=[x.strip().lower() for x in sys.argv[idx+1].split(',') if x.strip()]
    langs=[]
    for rl in raw_langs:
        if rl not in LANG_ALIASES:
            print(f"Unknown language: '{rl}'. Canonical: {sorted(set(LANG_ALIASES.values()))}. Aliases: {sorted(LANG_ALIASES.keys())}")
            sys.exit(2)
        canon=LANG_ALIASES[rl]
        if canon not in langs:
            langs.append(canon)
    lang=','.join(langs)  # for downstream display/json
    print(f"Language(s): {lang}")

    # Populate TARGET_EXTS from --lang. SINGLE source of truth for "what is code":
    # used by module LOC, sub-dir LOC breakdown, and coverage numerator/denominator.
    exts = set()
    for L in langs:
        if L not in LANG_EXTENSIONS:
            print(f"Internal error: language '{L}' has no extension mapping in LANG_EXTENSIONS")
            sys.exit(2)
        exts |= LANG_EXTENSIONS[L]
    TARGET_EXTS = frozenset(exts)
    print(f"Target extensions: {sorted(TARGET_EXTS)}")

    modules, edges = {}, set()
    for L in langs:
        m, e = extractors[L](root)
        if not m:
            print(f"  [{L}] no modules found, skipping")
            continue
        for name, info in m.items():
            key = name if name not in modules else f"{L}:{name}"
            modules[key] = info
        if e:
            edges |= e
    if not modules:
        print("No modules found!")
        sys.exit(1)

    # Filter test modules (all languages)
    test_mods = [n for n in modules if _is_test_module_name(n)]
    if test_mods:
        print(f"\nExcluding {len(test_mods)} test module(s): {', '.join(sorted(test_mods))}")
        for n in test_mods:
            del modules[n]
        edges = {(s, t) for s, t in edges if s in modules and t in modules}

    # Coverage ratio
    total_project_loc, _ = count_all_code_loc(root)
    discovered_loc = sum(m['loc'] for m in modules.values())
    coverage = (discovered_loc / total_project_loc * 100) if total_project_loc else 0
    print(f"\nCoverage: {discovered_loc:,} / {total_project_loc:,} LOC ({coverage:.0f}%)")
    if coverage < 80:
        print(f"  ⚠️  LOW COVERAGE: {100-coverage:.0f}% of project code is outside discovered modules.")

    sccs, mega_sccs, modules, edges, topo_layer = analyze(modules, edges, lang=lang, root=root)

    if module_loc_target is not None:
        sys.exit(module_loc_breakdown(modules, module_loc_target))

    if validate_spec is not None:
        try:
            groups = _parse_groups_arg(validate_spec)
        except ValueError as e:
            _real_print(f"Error parsing --validate spec: {e}")
            sys.exit(2)
        v_modules, v_edges, parent_to_children = _expand_virtual_submodules(modules, edges, groups, langs=lang)
        # Recompute SCCs over the (possibly modified) graph so SCC-violation gate is consistent.
        v_sccs = _tarjan_scc(list(v_modules.keys()), v_edges) if v_modules is not modules else sccs
        sys.exit(validate_grouping(v_modules, v_edges, groups, sccs=v_sccs,
                                   original_edges=edges if parent_to_children else None,
                                   parent_to_children=parent_to_children))

    if profile_json:
        # Restore real print, emit ProjectProfile JSON, exit.
        import builtins, json as _json
        builtins.print = _real_print
        from collections import defaultdict
        in_deg = defaultdict(int)
        out_deg = defaultdict(int)
        for s, t in edges:
            out_deg[s] += 1
            in_deg[t] += 1
        # Topology hints (mirror _print_graph_statistics math)
        locs = sorted(m['loc'] for m in modules.values()) if modules else [0]
        n_modules = len(modules)
        total_disc = sum(modules[m]['loc'] for m in modules) if modules else 0
        median_loc = locs[len(locs)//2] if locs else 0
        small_thresh = max(0.25 * median_loc, 500)
        oversized_thresh = max(4 * median_loc, 50000)
        target_groups = max(2, int(n_modules ** 0.5)) if n_modules else 0
        ideal_group_loc = total_disc // target_groups if target_groups else total_disc
        # Modules array
        mods_list = []
        for name in sorted(modules.keys(), key=lambda x: (topo_layer.get(x, 0), -modules[x]['loc'])):
            info = modules[name]
            flags = []
            if info['loc'] > oversized_thresh:
                flags.append('oversized')
            if info['loc'] < small_thresh:
                flags.append('small')
            mods_list.append({
                'name': name,
                'loc': info['loc'],
                'files': info['files'],
                'layer': topo_layer.get(name, 0),
                'in_deg': in_deg.get(name, 0),
                'out_deg': out_deg.get(name, 0),
                'flags': flags,
            })
        # DAG layers aggregation
        layers_agg = defaultdict(lambda: {'module_count': 0, 'loc': 0})
        for name, info in modules.items():
            L = topo_layer.get(name, 0)
            layers_agg[L]['module_count'] += 1
            layers_agg[L]['loc'] += info['loc']
        dag_layers = [{'layer': L, 'module_count': layers_agg[L]['module_count'], 'loc': layers_agg[L]['loc']}
                      for L in sorted(layers_agg.keys())]
        # Total project LOC and coverage warning
        total_proj_loc, _ = count_all_code_loc(root)
        coverage = (total_disc / total_proj_loc * 100) if total_proj_loc else 0
        warnings = []
        if coverage < 80:
            warnings.append(f"LOW COVERAGE: {100-coverage:.0f}% of project code is outside discovered modules.")
        # Skip pattern surface (strip the leading/trailing '/' added for matching)
        skip_surface = [p.strip('/') for p in SKIP_PATH_SUBSTRINGS]
        profile = {
            'scope_path': root,
            'languages': langs,
            'skip_patterns': skip_surface,
            'total_loc': total_disc,
            'total_files': sum(m['files'] for m in modules.values()),
            'module_count': n_modules,
            'edge_count': len(edges),
            'scc_count': len(sccs),
            'scc_nontrivial': len(mega_sccs),
            'dag_depth': (max(topo_layer.values()) + 1) if topo_layer else 1,
            'topology_hints': {
                'target_group_count': target_groups,
                'ideal_group_loc': ideal_group_loc,
                'median_module_loc': median_loc,
                'small_threshold': int(small_thresh),
                'oversized_threshold': int(oversized_thresh),
            },
            'modules': mods_list,
            'dag_layers': dag_layers,
            'warnings': warnings,
        }
        _real_print(_json.dumps(profile, indent=2, ensure_ascii=False))
        sys.exit(0)

    print_results(modules, edges, sccs, mega_sccs, lang, topo_layer)

    if json_out:
        save_json(modules, edges, sccs, mega_sccs, lang, topo_layer, json_out)

if __name__ == '__main__':
    main()
