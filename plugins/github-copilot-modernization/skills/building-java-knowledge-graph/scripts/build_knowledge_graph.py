#!/usr/bin/env python3
"""
Java Knowledge Graph Generator with Tree-Sitter (Self-Contained)
==================================================================

Analyzes Java/Kotlin/Scala/Groovy projects and generates knowledge graphs.

Features:
  - Tree-sitter parsing for Java/Kotlin/Scala/Groovy
  - Build system detection (Maven/Gradle/Ant/Ivy) - fully inlined
  - Module assignment and dependency tracking
  - DOT/SVG visualization
  - Self-contained: NO external imports except tree-sitter

Requirements:
  - Python 3.7+
  - tree-sitter library (pip install tree-sitter)
  - Language grammars (installed via install_grammars.py)
  - Graphviz (optional, for SVG generation)
    Mac: brew install graphviz
    Linux: apt/yum install graphviz
    Windows: choco install graphviz

Usage:
  python3 build_knowledge_graph.py <project_path> [output_dir]

Example:
  python3 build_knowledge_graph.py /path/to/project /tmp/kg-output
"""

import os
import sys
import json
import re
import shutil
import platform
from pathlib import Path
from typing import Dict, List, Set, Optional, Tuple, Any
from dataclasses import dataclass, field, asdict
from datetime import datetime
import subprocess

# Check Python version
if sys.version_info < (3, 7):
    print("Error: Python 3.7+ required")
    sys.exit(1)

# Try to import tree-sitter
try:
    from tree_sitter import Language, Parser, Node
except ImportError:
    print("Error: tree-sitter not installed")
    print("Install: pip install tree-sitter")
    sys.exit(1)

# ============================================================================
# GRAPHVIZ DETECTION
# ============================================================================

def check_graphviz() -> bool:
    """Check if Graphviz dot command is available"""
    try:
        subprocess.run(['dot', '-V'], capture_output=True, check=True)
        return True
    except (FileNotFoundError, subprocess.CalledProcessError):
        return False

GRAPHVIZ_AVAILABLE = check_graphviz()

def get_graphviz_install_instructions() -> str:
    """Get OS-specific Graphviz installation instructions"""
    system = platform.system()
    
    if system == 'Darwin':  # macOS
        return """
📦 Install Graphviz on macOS:
   brew install graphviz

🔄 Then re-run this script, or generate SVGs manually:
   dot -Tsvg <file.dot> -o <file.svg>
"""
    elif system == 'Linux':
        return """
📦 Install Graphviz on Linux:
   # Ubuntu/Debian: sudo apt install graphviz
   # Fedora/RHEL:   sudo dnf install graphviz
   # Arch:          sudo pacman -S graphviz

🔄 Then re-run this script, or generate SVGs manually:
   dot -Tsvg <file.dot> -o <file.svg>
"""
    elif system == 'Windows':
        return """
📦 Install Graphviz on Windows:
   choco install graphviz
   # Or download from: https://graphviz.org/download/

🔄 Then re-run this script, or generate SVGs manually:
   dot -Tsvg <file.dot> -o <file.svg>
"""
    else:
        return """
📦 Install Graphviz:
   Visit: https://graphviz.org/download/

🔄 Then re-run this script, or generate SVGs manually:
   dot -Tsvg <file.dot> -o <file.svg>
"""

# ============================================================================
# DATA STRUCTURES
# ============================================================================

@dataclass
class Dependency:
    """Universal dependency (Maven/Gradle/Ant/Ivy)"""
    group: str
    name: str
    version: Optional[str] = None
    scope: str = "compile"
    optional: bool = False

@dataclass
class BuildModule:
    """Universal build module"""
    name: str
    group: str = ""
    version: Optional[str] = None
    path: str = ""
    build_system: str = "unknown"  # maven, gradle, ant, ivy
    dependencies: List[Dependency] = field(default_factory=list)
    properties: Dict[str, str] = field(default_factory=dict)
    parent: Optional[Dict[str, str]] = None
    submodules: List[str] = field(default_factory=list)

@dataclass
class JavaClass:
    """Parsed class/interface/enum"""
    name: str
    package: str
    type: str = "class"  # class, interface, enum, annotation
    modifiers: List[str] = field(default_factory=list)
    annotations: List[str] = field(default_factory=list)
    fields: List[Dict] = field(default_factory=list)
    methods: List[Dict] = field(default_factory=list)
    extends: Optional[str] = None
    implements: List[str] = field(default_factory=list)

@dataclass
class ParsedFile:
    """Parsed source file"""
    file_path: str
    language: str  # java, kotlin, scala, groovy
    package: str
    imports: List[str] = field(default_factory=list)
    classes: List[JavaClass] = field(default_factory=list)

# ============================================================================
# CONSTANTS
# ============================================================================

LAYER_PATTERNS = {
    'controller': ['controller', 'web', 'api', 'rest', 'endpoint', 'resource', 'action', 'handler'],
    'service': ['service', 'business', 'application', 'manager', 'facade', 'processor'],
    'repository': ['repository', 'dao', 'persistence', 'mapper', 'store', 'accessor'],
    'model': ['model', 'entity', 'dto', 'vo', 'domain', 'pojo', 'bean', 'data', 'document'],
    'config': ['config', 'configuration', 'setting', 'properties', 'setup'],
    'util': ['util', 'utils', 'helper', 'common', 'support', 'tools'],
    'exception': ['exception', 'error', 'fault'],
    'security': ['security', 'auth', 'authentication', 'authorization', 'jwt', 'oauth'],
    'filter': ['filter', 'interceptor', 'aspect', 'aop', 'advice'],
    'converter': ['converter', 'transformer', 'adapter', 'serializer'],
    'validator': ['validator', 'validation', 'constraint'],
    'event': ['event', 'listener', 'subscriber', 'publisher'],
    'worker': ['worker', 'job', 'task', 'scheduler', 'cron', 'batch'],
}

# ============================================================================
# BUILD SYSTEM PARSERS (INLINED - NO EXTERNAL IMPORTS)
# ============================================================================

def parse_maven_pom(pom_path: Path) -> BuildModule:
    """Parse Maven pom.xml (inline XML parsing)"""
    try:
        import xml.etree.ElementTree as ET
        tree = ET.parse(pom_path)
        root = tree.getroot()
        
        ns = {'m': 'http://maven.apache.org/POM/4.0.0'}
        
        def get_text(path: str, default: str = "") -> str:
            elem = root.find(path, ns)
            return elem.text.strip() if elem is not None and elem.text else default
        
        group_id = get_text('m:groupId')
        if not group_id:
            parent = root.find('m:parent', ns)
            if parent is not None:
                group_id_elem = parent.find('m:groupId', ns)
                if group_id_elem is not None:
                    group_id = group_id_elem.text.strip()
        
        artifact_id = get_text('m:artifactId')
        version = get_text('m:version')
        
        # Parse parent
        parent_elem = root.find('m:parent', ns)
        parent_info = None
        if parent_elem is not None:
            parent_info = {
                'groupId': get_text('m:parent/m:groupId'),
                'artifactId': get_text('m:parent/m:artifactId'),
                'version': get_text('m:parent/m:version'),
            }
        
        # Parse modules
        submodules = []
        modules_elem = root.find('m:modules', ns)
        if modules_elem is not None:
            for module_elem in modules_elem.findall('m:module', ns):
                if module_elem.text:
                    submodules.append(module_elem.text.strip())
        
        # Parse properties
        properties = {}
        props_elem = root.find('m:properties', ns)
        if props_elem is not None:
            for prop in props_elem:
                key = prop.tag.replace('{' + ns['m'] + '}', '')
                properties[key] = prop.text.strip() if prop.text else ''
        
        # Parse dependencies
        dependencies = []
        deps_elem = root.find('m:dependencies', ns)
        if deps_elem is not None:
            for dep in deps_elem.findall('m:dependency', ns):
                dep_group = dep.find('m:groupId', ns)
                dep_artifact = dep.find('m:artifactId', ns)
                dep_version = dep.find('m:version', ns)
                dep_scope = dep.find('m:scope', ns)
                
                dependencies.append(Dependency(
                    group=dep_group.text.strip() if dep_group is not None and dep_group.text else '',
                    name=dep_artifact.text.strip() if dep_artifact is not None and dep_artifact.text else '',
                    version=dep_version.text.strip() if dep_version is not None and dep_version.text else None,
                    scope=dep_scope.text.strip() if dep_scope is not None and dep_scope.text else 'compile',
                ))
        
        return BuildModule(
            name=artifact_id,
            group=group_id,
            version=version,
            path=str(pom_path.parent),
            build_system='maven',
            dependencies=dependencies,
            properties=properties,
            parent=parent_info,
            submodules=submodules,
        )
    
    except Exception as e:
        print(f"⚠️  Failed to parse Maven pom.xml: {pom_path} - {e}")
        return BuildModule(
            name=pom_path.parent.name,
            path=str(pom_path.parent),
            build_system='maven',
        )

def parse_gradle_build(build_path: Path) -> BuildModule:
    """Parse Gradle build.gradle / build.gradle.kts (inline regex parsing)"""
    try:
        content = build_path.read_text(encoding='utf-8', errors='ignore')
        
        # Extract group and version
        group_match = re.search(r'group\s*=?\s*["\']([^"\']+)["\']', content)
        version_match = re.search(r'version\s*=?\s*["\']([^"\']+)["\']', content)
        
        group = group_match.group(1) if group_match else ''
        version = version_match.group(1) if version_match else None
        
        # Extract dependencies
        dependencies = []
        
        # Match: implementation "group:artifact:version" or implementation("group:artifact:version")
        dep_patterns = [
            r'(?:implementation|api|compile|testImplementation)\s*["\']([^:]+):([^:]+):([^"\']+)["\']',
            r'(?:implementation|api|compile|testImplementation)\s*\(["\']([^:]+):([^:]+):([^"\']+)["\']\)',
        ]
        
        for pattern in dep_patterns:
            for match in re.finditer(pattern, content):
                dependencies.append(Dependency(
                    group=match.group(1),
                    name=match.group(2),
                    version=match.group(3),
                    scope='compile',
                ))
        
        return BuildModule(
            name=build_path.parent.name,
            group=group,
            version=version,
            path=str(build_path.parent),
            build_system='gradle',
            dependencies=dependencies,
        )
    
    except Exception as e:
        print(f"⚠️  Failed to parse Gradle build file: {build_path} - {e}")
        return BuildModule(
            name=build_path.parent.name,
            path=str(build_path.parent),
            build_system='gradle',
        )

def parse_ant_build(build_path: Path) -> BuildModule:
    """Parse Ant build.xml (inline XML parsing)"""
    try:
        import xml.etree.ElementTree as ET
        tree = ET.parse(build_path)
        root = tree.getroot()
        
        project_name = root.get('name', build_path.parent.name)
        
        # Ant doesn't have explicit dependencies, extract from <path> elements
        dependencies = []
        
        for path_elem in root.findall('.//path'):
            for fileset in path_elem.findall('.//fileset'):
                dir_attr = fileset.get('dir', '')
                includes = fileset.get('includes', '')
                if 'lib' in dir_attr.lower() or '.jar' in includes:
                    # This is a library reference
                    # We can't extract group/version easily, just note it exists
                    pass
        
        return BuildModule(
            name=project_name,
            path=str(build_path.parent),
            build_system='ant',
            dependencies=dependencies,
        )
    
    except Exception as e:
        print(f"⚠️  Failed to parse Ant build.xml: {build_path} - {e}")
        return BuildModule(
            name=build_path.parent.name,
            path=str(build_path.parent),
            build_system='ant',
        )

def parse_ivy_xml(ivy_path: Path) -> List[Dependency]:
    """Parse Ivy ivy.xml (inline XML parsing)"""
    try:
        import xml.etree.ElementTree as ET
        tree = ET.parse(ivy_path)
        root = tree.getroot()
        
        dependencies = []
        
        deps_elem = root.find('dependencies')
        if deps_elem is not None:
            for dep in deps_elem.findall('dependency'):
                org = dep.get('org', '')
                name = dep.get('name', '')
                rev = dep.get('rev', None)
                
                dependencies.append(Dependency(
                    group=org,
                    name=name,
                    version=rev,
                    scope='compile',
                ))
        
        return dependencies
    
    except Exception as e:
        print(f"⚠️  Failed to parse Ivy ivy.xml: {ivy_path} - {e}")
        return []

def parse_properties_file(props_path: Path) -> Dict[str, str]:
    """Parse .properties file"""
    properties = {}
    try:
        with open(props_path, 'r', encoding='utf-8', errors='ignore') as f:
            for line in f:
                line = line.strip()
                # Skip comments and empty lines
                if not line or line.startswith('#') or line.startswith('!'):
                    continue
                # Parse key=value
                if '=' in line:
                    key, value = line.split('=', 1)
                    properties[key.strip()] = value.strip()
    except Exception as e:
        print(f"⚠️  Failed to parse properties file: {props_path} - {e}")
    return properties

def parse_yaml_file(yaml_path: Path) -> Dict[str, Any]:
    """Parse .yaml/.yml file (inline YAML parser - basic support)"""
    try:
        # Try to use pyyaml if available
        try:
            import yaml
            with open(yaml_path, 'r', encoding='utf-8', errors='ignore') as f:
                return yaml.safe_load(f) or {}
        except ImportError:
            # Fallback: basic key-value extraction (not full YAML)
            print(f"⚠️  PyYAML not installed - using basic parser for {yaml_path.name}")
            config = {}
            with open(yaml_path, 'r', encoding='utf-8', errors='ignore') as f:
                for line in f:
                    line = line.strip()
                    if ':' in line and not line.startswith('#'):
                        key, value = line.split(':', 1)
                        config[key.strip()] = value.strip()
            return config
    except Exception as e:
        print(f"⚠️  Failed to parse YAML file: {yaml_path} - {e}")
        return {}

def parse_settings_gradle(settings_path: Path) -> List[str]:
    """Parse settings.gradle to find subprojects"""
    subprojects = []
    try:
        content = settings_path.read_text(encoding='utf-8', errors='ignore')
        
        # Match: include 'module1', 'module2'
        # or include(':module1', ':module2')
        include_pattern = r'include\s*\(?["\']([^"\']+)["\']\)?'
        
        for match in re.finditer(include_pattern, content):
            module_name = match.group(1).lstrip(':')
            subprojects.append(module_name)
        
    except Exception as e:
        print(f"⚠️  Failed to parse settings.gradle: {settings_path} - {e}")
    
    return subprojects

def detect_build_system(project_path: Path) -> Tuple[str, List[BuildModule]]:
    """Detect build system and parse all modules (INLINE - NO EXTERNAL IMPORTS)"""
    modules = []
    build_system = 'unknown'
    
    # Maven detection
    pom_files = list(project_path.rglob('pom.xml'))
    pom_files = [p for p in pom_files if 'target' not in p.parts and 'build' not in p.parts]
    
    if pom_files:
        build_system = 'maven'
        for pom in pom_files:
            module = parse_maven_pom(pom)
            if module.name:
                # Parse application.properties/yaml in Maven module
                config_files = list(pom.parent.rglob('application*.properties')) + \
                              list(pom.parent.rglob('application*.yaml')) + \
                              list(pom.parent.rglob('application*.yml'))
                
                for config_file in config_files:
                    # Skip test resources
                    if 'test' in config_file.parts:
                        continue
                        
                    if config_file.suffix == '.properties':
                        props = parse_properties_file(config_file)
                        module.properties.update(props)
                    elif config_file.suffix in ['.yaml', '.yml']:
                        yaml_data = parse_yaml_file(config_file)
                        # Flatten YAML to properties (basic)
                        if isinstance(yaml_data, dict):
                            for k, v in yaml_data.items():
                                if isinstance(v, (str, int, float, bool)):
                                    module.properties[k] = str(v)
                
                modules.append(module)
        return build_system, modules
    
    # Gradle detection
    gradle_files = list(project_path.rglob('build.gradle')) + list(project_path.rglob('build.gradle.kts'))
    gradle_files = [g for g in gradle_files if 'build' not in g.parts and '.gradle' not in g.parts]
    
    if gradle_files:
        build_system = 'gradle'
        
        # Parse settings.gradle for subproject detection
        settings_file = project_path / 'settings.gradle'
        settings_kts = project_path / 'settings.gradle.kts'
        subproject_names = []
        
        if settings_file.exists():
            subproject_names = parse_settings_gradle(settings_file)
        elif settings_kts.exists():
            subproject_names = parse_settings_gradle(settings_kts)
        
        for gradle in gradle_files:
            module = parse_gradle_build(gradle)
            
            # Add subprojects from settings.gradle
            if gradle.parent == project_path and subproject_names:
                module.submodules = subproject_names
            
            # Parse application.properties/yaml in module
            config_files = list(gradle.parent.rglob('application*.properties')) + \
                          list(gradle.parent.rglob('application*.yaml')) + \
                          list(gradle.parent.rglob('application*.yml'))
            
            for config_file in config_files:
                # Skip test resources
                if 'test' in config_file.parts:
                    continue
                    
                if config_file.suffix == '.properties':
                    props = parse_properties_file(config_file)
                    module.properties.update(props)
                elif config_file.suffix in ['.yaml', '.yml']:
                    yaml_data = parse_yaml_file(config_file)
                    # Flatten YAML to properties (basic)
                    if isinstance(yaml_data, dict):
                        for k, v in yaml_data.items():
                            if isinstance(v, (str, int, float, bool)):
                                module.properties[k] = str(v)
            
            modules.append(module)
        
        # Check for Ivy companion
        for gradle_dir in set(g.parent for g in gradle_files):
            ivy_file = gradle_dir / 'ivy.xml'
            if ivy_file.exists():
                ivy_deps = parse_ivy_xml(ivy_file)
                # Merge into corresponding module
                for mod in modules:
                    if Path(mod.path) == gradle_dir:
                        mod.dependencies.extend(ivy_deps)
        
        return build_system, modules
    
    # Ant detection
    ant_files = list(project_path.rglob('build.xml'))
    ant_files = [a for a in ant_files if 'build' not in a.parts]
    
    if ant_files:
        build_system = 'ant'
        for ant in ant_files:
            module = parse_ant_build(ant)
            modules.append(module)
        
        # Check for Ivy companion
        for ant_dir in set(a.parent for a in ant_files):
            ivy_file = ant_dir / 'ivy.xml'
            if ivy_file.exists():
                ivy_deps = parse_ivy_xml(ivy_file)
                for mod in modules:
                    if Path(mod.path) == ant_dir:
                        mod.dependencies.extend(ivy_deps)
        
        return build_system, modules
    
    # Ivy standalone
    ivy_files = list(project_path.rglob('ivy.xml'))
    if ivy_files:
        build_system = 'ivy'
        for ivy in ivy_files:
            ivy_deps = parse_ivy_xml(ivy)
            module = BuildModule(
                name=ivy.parent.name,
                path=str(ivy.parent),
                build_system='ivy',
                dependencies=ivy_deps,
            )
            modules.append(module)
        return build_system, modules
    
    # No build system detected - create single module
    if not modules:
        modules.append(BuildModule(
            name=project_path.name,
            path=str(project_path),
            build_system='unknown',
        ))
    
    return build_system, modules

# ============================================================================
# TREE-SITTER PARSERS
# ============================================================================

def load_tree_sitter_language(lang_name: str) -> Optional[Language]:
    """Load tree-sitter language from vendor directory"""
    script_dir = Path(__file__).parent
    vendor_dir = script_dir / 'vendor'
    # Use the combined languages.so file created by install_grammars.py
    so_file = vendor_dir / 'languages.so'
    
    if not so_file.exists():
        print(f"❌ Error: Tree-sitter grammars not found: {so_file}")
        print(f"")
        print(f"📦 Install grammars first:")
        print(f"   cd {script_dir.parent}")
        print(f"   python3 scripts/install_grammars.py")
        print(f"")
        sys.exit(1)
    
    try:
        return Language(str(so_file), lang_name)
    except Exception as e:
        print(f"⚠️  Failed to load tree-sitter language {lang_name}: {e}")
        return None

def parse_package_tree_sitter(node: Node, source_code: bytes) -> str:
    """Extract package name from tree-sitter node"""
    if node.type == 'package_declaration':
        for child in node.children:
            if child.type in ['scoped_identifier', 'identifier']:
                return source_code[child.start_byte:child.end_byte].decode('utf-8')
    
    for child in node.children:
        result = parse_package_tree_sitter(child, source_code)
        if result:
            return result
    
    return ''

def parse_imports_tree_sitter(node: Node, source_code: bytes) -> List[str]:
    """Extract imports from tree-sitter node"""
    imports = []
    
    if node.type == 'import_declaration':
        for child in node.children:
            if child.type in ['scoped_identifier', 'identifier']:
                import_path = source_code[child.start_byte:child.end_byte].decode('utf-8')
                imports.append(import_path)
    
    for child in node.children:
        imports.extend(parse_imports_tree_sitter(child, source_code))
    
    return imports

def parse_class_tree_sitter(node: Node, source_code: bytes, package: str) -> Optional[JavaClass]:
    """Parse class/interface/enum from tree-sitter node"""
    if node.type not in ['class_declaration', 'interface_declaration', 'enum_declaration', 
                         'annotation_type_declaration', 'object_declaration']:
        return None
    
    class_type = {
        'class_declaration': 'class',
        'interface_declaration': 'interface',
        'enum_declaration': 'enum',
        'annotation_type_declaration': 'annotation',
        'object_declaration': 'object',  # Kotlin/Scala
    }.get(node.type, 'class')
    
    # Extract class name
    class_name = None
    modifiers = []
    annotations = []
    extends = None
    implements = []
    
    # FIRST: Check preceding siblings for annotations (they come BEFORE the class in source)
    if node.parent:
        for sibling in node.parent.children:
            # Only look at siblings that come before this node
            if sibling.start_byte >= node.start_byte:
                break
            if sibling.type in ['marker_annotation', 'annotation']:
                ann_text = source_code[sibling.start_byte:sibling.end_byte].decode('utf-8')
                ann_match = re.match(r'@(\w+)', ann_text)
                if ann_match:
                    annotations.append(ann_match.group(1))
    
    # THEN: Parse children (class body, modifiers, etc.)
    for child in node.children:
        if child.type == 'identifier':
            class_name = source_code[child.start_byte:child.end_byte].decode('utf-8')
        elif child.type == 'modifiers':
            for mod in child.children:
                mod_text = source_code[mod.start_byte:mod.end_byte].decode('utf-8')
                # Modifiers can contain annotations too (inside modifiers block)
                if mod.type in ['marker_annotation', 'annotation']:
                    ann_match = re.match(r'@(\w+)', mod_text)
                    if ann_match and ann_match.group(1) not in annotations:
                        annotations.append(ann_match.group(1))
                else:
                    modifiers.append(mod_text)
        elif child.type == 'marker_annotation' or child.type == 'annotation':
            ann_text = source_code[child.start_byte:child.end_byte].decode('utf-8')
            # Extract just annotation name (remove @ and parameters)
            ann_match = re.match(r'@(\w+)', ann_text)
            if ann_match and ann_match.group(1) not in annotations:
                annotations.append(ann_match.group(1))
        elif child.type == 'superclass':
            for subchild in child.children:
                if subchild.type == 'type_identifier':
                    extends = source_code[subchild.start_byte:subchild.end_byte].decode('utf-8')
        elif child.type == 'super_interfaces' or child.type == 'interfaces':
            for subchild in child.children:
                if subchild.type == 'type_identifier':
                    impl_name = source_code[subchild.start_byte:subchild.end_byte].decode('utf-8')
                    implements.append(impl_name)
    
    if not class_name:
        return None
    
    return JavaClass(
        name=class_name,
        package=package,
        type=class_type,
        modifiers=modifiers,
        annotations=annotations,
        extends=extends,
        implements=implements,
    )

def parse_file_tree_sitter(file_path: Path, language: str, project_root: Path) -> Optional[ParsedFile]:
    """Parse source file using tree-sitter"""
    lang_obj = load_tree_sitter_language(language)
    if not lang_obj:
        return None
    
    try:
        parser = Parser()
        parser.set_language(lang_obj)
        
        source_code = file_path.read_bytes()
        tree = parser.parse(source_code)
        root_node = tree.root_node
        
        # Extract package
        package = parse_package_tree_sitter(root_node, source_code)
        
        # Extract imports
        imports = parse_imports_tree_sitter(root_node, source_code)
        
        # Extract classes
        classes = []
        
        def extract_classes(node: Node):
            cls = parse_class_tree_sitter(node, source_code, package)
            if cls:
                classes.append(cls)
            
            for child in node.children:
                extract_classes(child)
        
        extract_classes(root_node)
        
        if not classes:
            return None
        
        return ParsedFile(
            file_path=str(file_path.relative_to(project_root)),
            language=language,
            package=package,
            imports=imports,
            classes=classes,
        )
    
    except Exception as e:
        print(f"⚠️  Failed to parse {language} file: {file_path} - {e}")
        return None

# ============================================================================
# FILE DISCOVERY
# ============================================================================

def find_source_files(project_path: Path) -> Dict[str, List[Path]]:
    """Find all source files by language"""
    source_files = {
        'java': [],
        'kotlin': [],
        'scala': [],
        'groovy': [],
    }
    
    # Java files - support multiple project structures
    for java_file in project_path.rglob('*.java'):
        file_str = str(java_file)
        
        # Skip build output directories
        if 'target' in java_file.parts or 'build' in java_file.parts or 'out' in java_file.parts:
            continue
        
        # Skip backup/temp directories
        if any(part.endswith('.backup') or part.endswith('.old') or part.endswith('~') 
               for part in java_file.parts):
            continue
            
        # Accept files in standard Maven/Gradle structure
        if '/src/main/java/' in file_str or '\\src\\main\\java\\' in file_str:
            source_files['java'].append(java_file)
        # Accept files in simple src/ structure (Ant, plain Java)
        elif '/src/' in file_str or '\\src\\' in file_str:
            # But not test files
            if '/test/' not in file_str and '\\test\\' not in file_str:
                source_files['java'].append(java_file)
        # Accept files directly in package structure (no src/ dir)
        else:
            # Check if it looks like a valid Java source file (has package structure)
            # At least 2 directories deep from project root
            relative = java_file.relative_to(project_path)
            if len(relative.parts) >= 3:  # e.g., com/company/Class.java
                source_files['java'].append(java_file)
    
    # Kotlin files
    for kt_file in project_path.rglob('*.kt'):
        file_str = str(kt_file)
        if 'build' not in kt_file.parts:
            if ('/src/main/' in file_str or '\\src\\main\\' in file_str or
                '/src/' in file_str or '\\src\\' in file_str):
                source_files['kotlin'].append(kt_file)
    
    # Scala files
    for scala_file in project_path.rglob('*.scala'):
        file_str = str(scala_file)
        if 'target' not in scala_file.parts and 'build' not in scala_file.parts:
            if ('/src/main/' in file_str or '\\src\\main\\' in file_str or
                '/src/' in file_str or '\\src\\' in file_str):
                source_files['scala'].append(scala_file)
    
    # Groovy files
    for groovy_file in project_path.rglob('*.groovy'):
        file_str = str(groovy_file)
        if 'build' not in groovy_file.parts:
            if ('/src/main/' in file_str or '\\src\\main\\' in file_str or
                '/src/' in file_str or '\\src\\' in file_str):
                source_files['groovy'].append(groovy_file)
    
    return source_files

# ============================================================================
# LAYER AND FEATURE DETECTION
# ============================================================================

def detect_layer(package: str, class_name: str) -> str:
    """Detect class layer"""
    full_name = f"{package}.{class_name}".lower()
    
    for layer, patterns in LAYER_PATTERNS.items():
        for pattern in patterns:
            if pattern in full_name:
                return layer
    
    return 'other'

def extract_feature(package: str, layer: str, class_name: str) -> str:
    """Extract business feature"""
    tech_suffixes = [
        'Controller', 'Service', 'ServiceImpl', 'Repository', 'Dao', 'Mapper',
        'Entity', 'DTO', 'VO', 'Config', 'Util', 'Exception'
    ]
    
    feature_name = class_name
    for suffix in tech_suffixes:
        if class_name.endswith(suffix):
            feature_name = class_name[:-len(suffix)]
            break
    
    if feature_name and feature_name != class_name:
        return feature_name.lower()
    
    parts = package.split('.')
    filtered = [p for p in parts if p not in ['com', 'org', 'io', 'net']]
    
    if len(filtered) > 1:
        filtered = filtered[1:]
    
    tech_keywords = ['controller', 'service', 'repository', 'dao', 'model', 'entity', 
                     'dto', 'config', 'util', 'exception', 'common']
    feature_parts = [p for p in filtered if p.lower() not in tech_keywords]
    
    return feature_parts[0] if feature_parts else 'common'

def resolve_class_name(simple_name: str, imports: list, current_package: str) -> str:
    """Resolve simple class name to fully qualified name"""
    if '.' in simple_name:
        return simple_name
    
    for imp in imports:
        if imp.endswith('.' + simple_name):
            return imp
    
    if current_package:
        return f"{current_package}.{simple_name}"
    
    return simple_name

def get_library_group_key(package_fqn: str) -> str:
    """
    Map package FQN to library group key for clustering external dependencies.
    Groups related packages together (e.g., Spring Boot, Spring Cloud, Spring Data).
    """
    # Spring ecosystem - group by sub-project
    if package_fqn.startswith('org.springframework.boot'):
        return 'spring-boot'
    elif package_fqn.startswith('org.springframework.cloud'):
        return 'spring-cloud'
    elif package_fqn.startswith('org.springframework.data'):
        return 'spring-data'
    elif package_fqn.startswith('org.springframework.security'):
        return 'spring-security'
    elif package_fqn.startswith('org.springframework.web'):
        return 'spring-web'
    elif package_fqn.startswith('org.springframework.batch'):
        return 'spring-batch'
    elif package_fqn.startswith('org.springframework.integration'):
        return 'spring-integration'
    elif package_fqn.startswith('org.springframework.session'):
        return 'spring-session'
    elif package_fqn.startswith('org.springframework.hateoas'):
        return 'spring-hateoas'
    elif package_fqn.startswith('org.springframework.modulith'):
        return 'spring-modulith'
    elif package_fqn.startswith('org.springframework.restdocs'):
        return 'spring-restdocs'
    elif package_fqn.startswith('org.springframework.ai'):
        return 'spring-ai'
    elif package_fqn.startswith('org.springframework.amqp'):
        return 'spring-amqp'
    elif package_fqn.startswith('org.springframework.kafka'):
        return 'spring-kafka'
    elif package_fqn.startswith('org.springframework.ldap'):
        return 'spring-ldap'
    elif package_fqn.startswith('org.springframework.pulsar'):
        return 'spring-pulsar'
    elif package_fqn.startswith('org.springframework.shell'):
        return 'spring-shell'
    elif package_fqn.startswith('org.springframework.statemachine'):
        return 'spring-statemachine'
    elif package_fqn.startswith('org.springframework.webflow'):
        return 'spring-webflow'
    elif package_fqn.startswith('org.springframework.ws'):
        return 'spring-ws'
    elif package_fqn.startswith('org.springframework.graphql'):
        return 'spring-graphql'
    elif package_fqn.startswith('org.springframework.vault'):
        return 'spring-vault'
    elif package_fqn.startswith('org.springframework'):
        return 'spring-framework'
    
    # Quarkus ecosystem
    elif package_fqn.startswith('io.quarkus'):
        return 'quarkus'
    
    # Micronaut
    elif package_fqn.startswith('io.micronaut'):
        return 'micronaut'
    
    # Vert.x
    elif package_fqn.startswith('io.vertx'):
        return 'vertx'
    
    # Jakarta EE
    elif package_fqn.startswith('jakarta.persistence'):
        return 'jakarta-persistence'
    elif package_fqn.startswith('jakarta.validation'):
        return 'jakarta-validation'
    elif package_fqn.startswith('jakarta'):
        return 'jakarta-ee'
    
    # javax (legacy)
    elif package_fqn.startswith('javax.persistence'):
        return 'jpa'
    elif package_fqn.startswith('javax.validation'):
        return 'bean-validation'
    elif package_fqn.startswith('javax'):
        return 'javax'
    
    # Persistence frameworks
    elif package_fqn.startswith('org.hibernate'):
        return 'hibernate'
    elif package_fqn.startswith('org.jooq'):
        return 'jooq'
    
    # JSON libraries
    elif package_fqn.startswith('com.fasterxml.jackson.dataformat'):
        return 'jackson-dataformat'
    elif package_fqn.startswith('com.fasterxml.jackson'):
        return 'jackson'
    elif package_fqn.startswith('com.google.gson'):
        return 'gson'
    
    # Reactive
    elif package_fqn.startswith('io.projectreactor'):
        return 'reactor'
    elif package_fqn.startswith('io.reactivex'):
        return 'rxjava'
    elif package_fqn.startswith('org.reactivestreams'):
        return 'reactive-streams'
    
    # Code generation
    elif package_fqn.startswith('lombok'):
        return 'lombok'
    elif package_fqn.startswith('org.projectlombok'):
        return 'lombok'
    
    # Testing
    elif package_fqn.startswith('org.junit'):
        return 'junit'
    elif package_fqn.startswith('org.mockito'):
        return 'mockito'
    elif package_fqn.startswith('org.assertj'):
        return 'assertj'
    elif package_fqn.startswith('io.rest-assured'):
        return 'rest-assured'
    
    # Utilities
    elif package_fqn.startswith('com.google.guava'):
        return 'guava'
    elif package_fqn.startswith('org.apache.commons'):
        return 'apache-commons'
    
    # Logging
    elif package_fqn.startswith('org.slf4j'):
        return 'slf4j'
    elif package_fqn.startswith('ch.qos.logback'):
        return 'logback'
    elif package_fqn.startswith('org.apache.logging.log4j'):
        return 'log4j'
    
    # Mapping
    elif package_fqn.startswith('org.mapstruct'):
        return 'mapstruct'
    elif package_fqn.startswith('org.modelmapper'):
        return 'modelmapper'
    
    # Messaging
    elif package_fqn.startswith('org.apache.kafka'):
        return 'kafka'
    elif package_fqn.startswith('com.rabbitmq'):
        return 'rabbitmq'
    elif package_fqn.startswith('io.nats'):
        return 'nats'
    
    # Caching
    elif package_fqn.startswith('org.redisson'):
        return 'redisson'
    elif package_fqn.startswith('redis.clients.jedis'):
        return 'jedis'
    
    # Netflix OSS
    elif package_fqn.startswith('com.netflix'):
        return 'netflix-oss'
    
    # MongoDB
    elif package_fqn.startswith('org.mongodb'):
        return 'mongodb'
    
    # Databases
    elif package_fqn.startswith('org.postgresql'):
        return 'postgresql'
    elif package_fqn.startswith('com.mysql'):
        return 'mysql'
    elif package_fqn.startswith('com.h2database'):
        return 'h2'
    
    # Security & Auth
    elif package_fqn.startswith('io.jsonwebtoken'):
        return 'jjwt'
    elif package_fqn.startswith('org.keycloak'):
        return 'keycloak'
    elif package_fqn.startswith('com.auth0'):
        return 'auth0'
    elif package_fqn.startswith('org.bouncycastle'):
        return 'bouncycastle'
    
    # API & Documentation
    elif package_fqn.startswith('io.swagger'):
        return 'swagger'
    elif package_fqn.startswith('org.springdoc'):
        return 'springdoc'
    elif package_fqn.startswith('io.micrometer'):
        return 'micrometer'
    
    # HTTP Clients
    elif package_fqn.startswith('org.apache.httpcomponents'):
        return 'apache-httpclient'
    elif package_fqn.startswith('com.squareup.okhttp3'):
        return 'okhttp'
    elif package_fqn.startswith('io.netty'):
        return 'netty'
    elif package_fqn.startswith('reactivefeign'):
        return 'reactive-feign'
    elif package_fqn.startswith('io.github.reactivefeign'):
        return 'reactive-feign'
    
    # Template Engines
    elif package_fqn.startswith('org.thymeleaf'):
        return 'thymeleaf'
    elif package_fqn.startswith('org.freemarker'):
        return 'freemarker'
    elif package_fqn.startswith('com.hubspot.jinjava'):
        return 'jinjava'
    
    # Date/Time
    elif package_fqn.startswith('org.joda.time'):
        return 'joda-time'
    
    # YAML/Config
    elif package_fqn.startswith('org.yaml.snakeyaml'):
        return 'snakeyaml'
    elif package_fqn.startswith('org.dom4j'):
        return 'dom4j'
    
    # Cloud Providers
    elif package_fqn.startswith('com.amazonaws'):
        return 'aws-sdk'
    elif package_fqn.startswith('com.google.cloud'):
        return 'google-cloud'
    elif package_fqn.startswith('com.azure'):
        return 'azure-sdk'
    
    # Scheduling
    elif package_fqn.startswith('org.quartz'):
        return 'quartz'
    
    # GraphQL
    elif package_fqn.startswith('com.graphql-java'):
        return 'graphql-java'
    
    # Byte Code Manipulation
    elif package_fqn.startswith('net.bytebuddy'):
        return 'bytebuddy'
    elif package_fqn.startswith('org.javassist'):
        return 'javassist'
    elif package_fqn.startswith('org.ow2.asm'):
        return 'asm'
    
    # Observability
    elif package_fqn.startswith('io.opentelemetry'):
        return 'opentelemetry'
    elif package_fqn.startswith('io.zipkin'):
        return 'zipkin'
    elif package_fqn.startswith('io.jaegertracing'):
        return 'jaeger'
    
    # Serialization
    elif package_fqn.startswith('org.apache.avro'):
        return 'avro'
    elif package_fqn.startswith('com.google.protobuf'):
        return 'protobuf'
    elif package_fqn.startswith('org.apache.thrift'):
        return 'thrift'
    
    # Default: use first 2 package components
    parts = package_fqn.split('.')
    if len(parts) >= 2:
        return '.'.join(parts[:2])
    return parts[0] if parts else 'unknown'


def get_friendly_library_name(group_key: str) -> str:
    """Get friendly display name for library group key"""
    friendly_names = {
        # Spring ecosystem
        'spring-boot': 'Spring Boot',
        'spring-cloud': 'Spring Cloud',
        'spring-data': 'Spring Data',
        'spring-security': 'Spring Security',
        'spring-web': 'Spring Web',
        'spring-batch': 'Spring Batch',
        'spring-integration': 'Spring Integration',
        'spring-session': 'Spring Session',
        'spring-hateoas': 'Spring HATEOAS',
        'spring-modulith': 'Spring Modulith',
        'spring-restdocs': 'Spring REST Docs',
        'spring-ai': 'Spring AI',
        'spring-amqp': 'Spring AMQP',
        'spring-kafka': 'Spring for Apache Kafka',
        'spring-ldap': 'Spring LDAP',
        'spring-pulsar': 'Spring for Apache Pulsar',
        'spring-shell': 'Spring Shell',
        'spring-statemachine': 'Spring State Machine',
        'spring-webflow': 'Spring Web Flow',
        'spring-ws': 'Spring Web Services',
        'spring-graphql': 'Spring for GraphQL',
        'spring-vault': 'Spring Vault',
        'spring-framework': 'Spring Framework',
        
        # Frameworks
        'quarkus': 'Quarkus',
        'micronaut': 'Micronaut',
        'vertx': 'Vert.x',
        
        # Jakarta EE
        'jakarta-persistence': 'Jakarta Persistence',
        'jakarta-validation': 'Jakarta Validation',
        'jakarta-ee': 'Jakarta EE',
        
        # Legacy javax
        'jpa': 'JPA',
        'bean-validation': 'Bean Validation',
        'javax': 'javax',
        
        # Persistence/ORM
        'hibernate': 'Hibernate ORM',
        'jooq': 'jOOQ',
        
        # JSON Libraries
        'jackson': 'Jackson',
        'jackson-dataformat': 'Jackson DataFormat',
        'gson': 'Gson',
        
        # Reactive
        'reactor': 'Project Reactor',
        'rxjava': 'RxJava',
        'reactive-streams': 'Reactive Streams',
        
        # Code Generation
        'lombok': 'Lombok',
        
        # Testing
        'junit': 'JUnit',
        'mockito': 'Mockito',
        'assertj': 'AssertJ',
        'rest-assured': 'REST Assured',
        
        # Utilities
        'guava': 'Google Guava',
        'apache-commons': 'Apache Commons',
        
        # Logging
        'slf4j': 'SLF4J',
        'logback': 'Logback',
        'log4j': 'Log4j',
        
        # Mapping
        'mapstruct': 'MapStruct',
        'modelmapper': 'ModelMapper',
        
        # Messaging
        'kafka': 'Apache Kafka',
        'rabbitmq': 'RabbitMQ',
        'nats': 'NATS',
        
        # Caching
        'redisson': 'Redisson',
        'jedis': 'Jedis',
        
        # Microservices
        'netflix-oss': 'Netflix OSS',
        
        # MongoDB
        'mongodb': 'MongoDB Driver',
        
        # Databases
        'postgresql': 'PostgreSQL',
        'mysql': 'MySQL',
        'h2': 'H2 Database',
        
        # Security & Auth
        'jjwt': 'JJWT',
        'keycloak': 'Keycloak',
        'auth0': 'Auth0',
        'bouncycastle': 'Bouncy Castle',
        
        # API & Documentation
        'swagger': 'Swagger',
        'springdoc': 'SpringDoc OpenAPI',
        'micrometer': 'Micrometer',
        
        # HTTP Clients
        'apache-httpclient': 'Apache HttpClient',
        'okhttp': 'OkHttp',
        'netty': 'Netty',
        'reactive-feign': 'Reactive Feign',
        
        # Template Engines
        'thymeleaf': 'Thymeleaf',
        'freemarker': 'FreeMarker',
        'jinjava': 'Jinjava',
        
        # Date/Time
        'joda-time': 'Joda-Time',
        
        # Config/YAML
        'snakeyaml': 'SnakeYAML',
        'dom4j': 'Dom4j',
        
        # Cloud Providers
        'aws-sdk': 'AWS SDK',
        'google-cloud': 'Google Cloud',
        'azure-sdk': 'Azure SDK',
        
        # Scheduling
        'quartz': 'Quartz Scheduler',
        
        # GraphQL
        'graphql-java': 'GraphQL Java',
        
        # Byte Code
        'bytebuddy': 'Byte Buddy',
        'javassist': 'Javassist',
        'asm': 'ASM',
        
        # Observability
        'opentelemetry': 'OpenTelemetry',
        'zipkin': 'Zipkin',
        'jaeger': 'Jaeger',
        
        # Serialization
        'avro': 'Apache Avro',
        'protobuf': 'Protocol Buffers',
        'thrift': 'Apache Thrift',
    }
    
    return friendly_names.get(group_key, group_key)

# ============================================================================
# KNOWLEDGE GRAPH BUILDER
# ============================================================================

def build_knowledge_graph(project_path: str, output_dir: str = 'kg-output'):
    """Build knowledge graph"""
    project_root = Path(project_path).resolve()
    output_path = Path(output_dir)
    
    print(f"\n🔍 Analyzing project: {project_root}")
    print(f"📂 Output directory: {output_path}")
    
    output_path.mkdir(exist_ok=True, parents=True)
    
    # Cleanup old files
    print(f"\n🧹 Cleaning output directory...")
    removed_count = 0
    for item in output_path.iterdir():
        if item.is_file():
            item.unlink()
            removed_count += 1
        elif item.is_dir():
            shutil.rmtree(item)
            removed_count += 1
    
    if removed_count > 0:
        print(f"   Cleaned {removed_count} items")
    
    # Detect build system and parse modules
    print(f"\n📦 Detecting build system...")
    build_system, modules = detect_build_system(project_root)
    print(f"   Build system: {build_system}")
    print(f"   Found {len(modules)} modules")
    
    for module in modules:
        print(f"   ✓ {module.name}")
    
    # Find and parse source files
    print(f"\n📝 Parsing source files...")
    source_files = find_source_files(project_root)
    
    total_files = sum(len(files) for files in source_files.values())
    print(f"   Found {total_files} source files:")
    for lang, files in source_files.items():
        if files:
            print(f"      {lang}: {len(files)}")
    
    parsed_files = []
    for lang, files in source_files.items():
        for file in files:
            parsed = parse_file_tree_sitter(file, lang, project_root)
            if parsed:
                parsed_files.append(parsed)
    
    print(f"   Successfully parsed: {len(parsed_files)} files")
    
    # Build knowledge graph
    print(f"\n🏗️  Building knowledge graph...")
    
    nodes = []
    edges = []
    class_nodes = {}
    
    # System node
    nodes.append({
        'id': 'system:' + project_root.name,
        'type': 'system',
        'name': project_root.name,
    })
    
    # Module nodes
    module_id_map = {}
    for module in modules:
        module_id = f"module:{module.name}"
        module_id_map[module.name] = module_id
        
        module_node = {
            'id': module_id,
            'type': 'module',
            'name': module.name,
            'artifactId': module.name,
            'groupId': module.group,
            'path': module.path,
            'buildSystem': module.build_system,
        }
        
        # Add properties if present
        if module.properties:
            module_node['properties'] = module.properties
        
        # Add submodules if present
        if module.submodules:
            module_node['submodules'] = module.submodules
        
        nodes.append(module_node)
        
        edges.append({
            'from': 'system:' + project_root.name,
            'to': module_id,
            'type': 'contains',
        })
    
    # Class nodes (includes classes, interfaces, enums)
    # Note: type_count is calculated after deduplication
    dep_count = 0
    layer_distribution = {}
    
    for file in parsed_files:
        file_path = Path(file.file_path)
        module_name = None
        
        # Match file to module
        for module in modules:
            module_dir = Path(module.path).name
            if module_dir in file_path.parts:
                module_name = module.name
                break
        
        for cls in file.classes:
            
            layer = detect_layer(cls.package, cls.name)
            layer_distribution[layer] = layer_distribution.get(layer, 0) + 1
            
            feature = extract_feature(cls.package, layer, cls.name)
            
            class_id = f"class:{cls.package}.{cls.name}"
            
            if class_id in class_nodes:
                existing_anns = set(class_nodes[class_id]['annotations'])
                new_anns = set(cls.annotations)
                class_nodes[class_id]['annotations'] = sorted(existing_anns | new_anns)
            else:
                class_nodes[class_id] = {
                    'id': class_id,
                    'type': 'class',
                    'name': cls.name,
                    'package': cls.package,
                    'classType': cls.type,
                    'layer': layer,
                    'feature': feature,
                    'annotations': cls.annotations,
                    'moduleName': module_name or 'unknown',
                    'artifactId': module_name or 'unknown',
                    'language': file.language,
                }
            
            if module_name and module_name in module_id_map:
                edges.append({
                    'from': module_id_map[module_name],
                    'to': class_id,
                    'type': 'contains',
                })
            
            if cls.extends:
                dep_count += 1
                resolved_extends = resolve_class_name(cls.extends, file.imports, file.package)
                edges.append({
                    'from': class_id,
                    'to': f"class:{resolved_extends}",
                    'type': 'extends',
                })
            
            for impl in cls.implements:
                dep_count += 1
                resolved_impl = resolve_class_name(impl, file.imports, file.package)
                edges.append({
                    'from': class_id,
                    'to': f"class:{resolved_impl}",
                    'type': 'implements',
                })
            
            # Add import-based dependencies (exclude java.* standard library)
            for imp in file.imports:
                # Skip java.* but keep javax.* and jakarta.*
                if imp.startswith('java.'):
                    continue
                # Skip wildcard imports (e.g., com.example.*)
                if imp.endswith('.*'):
                    continue
                # Skip static imports (they're method/field references, not class deps)
                if '.static.' in imp:
                    continue
                
                dep_count += 1
                edges.append({
                    'from': class_id,
                    'to': f"class:{imp}",
                    'type': 'imports',
                })
    
    # Module dependencies
    module_dep_count = 0
    for module in modules:
        from_id = module_id_map.get(module.name)
        if not from_id:
            continue
        
        for dep in module.dependencies:
            if dep.name in module_id_map:
                module_dep_count += 1
                edges.append({
                    'from': from_id,
                    'to': module_id_map[dep.name],
                    'type': 'depends_on',
                    'scope': dep.scope,
                })
    
    # Module aggregations
    aggregation_count = 0
    for module in modules:
        from_id = module_id_map.get(module.name)
        if not from_id:
            continue
        
        for submodule in module.submodules:
            if submodule in module_id_map:
                aggregation_count += 1
                edges.append({
                    'from': from_id,
                    'to': module_id_map[submodule],
                    'type': 'aggregates',
                })
    
    nodes.extend(class_nodes.values())
    
    # Count by type (after deduplication)
    type_distribution = {}
    language_distribution = {}
    for cls_node in class_nodes.values():
        cls_type = cls_node.get('classType', 'class')
        type_distribution[cls_type] = type_distribution.get(cls_type, 0) + 1
        
        # Count by language (from deduplicated nodes)
        lang = cls_node.get('language', 'unknown')
        language_distribution[lang] = language_distribution.get(lang, 0) + 1
    
    # Total type count (after deduplication)
    type_count = len(class_nodes)
    
    # Count by module
    module_class_count = {}
    for cls_node in class_nodes.values():
        mod_name = cls_node.get('moduleName', 'unknown')
        module_class_count[mod_name] = module_class_count.get(mod_name, 0) + 1
    
    knowledge_graph = {
        'metadata': {
            'project': project_root.name,
            'path': str(project_root),
            'timestamp': datetime.now().isoformat(),
            'generator': 'build_knowledge_graph.py (tree-sitter)',
            'languages': list(language_distribution.keys()),
            'buildSystem': build_system,
        },
        'stats': {
            'files': total_files,
            'types': type_count,  # Total types (classes + interfaces + enums)
            'classes': type_distribution.get('class', 0),  # Actual classes only
            'interfaces': type_distribution.get('interface', 0),
            'enums': type_distribution.get('enum', 0),
            'modules': len(modules),
            'dependencies': dep_count,
            'module_dependencies': module_dep_count,
            'module_aggregations': aggregation_count,
            'by_language': language_distribution,
            'by_type': type_distribution,
            'by_module': module_class_count,
        },
        'nodes': nodes,
        'edges': edges,
    }
    
    print(f"\n📊 Statistics:")
    print(f"   Modules: {len(modules)}")
    print(f"   Types: {type_count} ({type_distribution.get('class', 0)} classes, {type_distribution.get('interface', 0)} interfaces, {type_distribution.get('enum', 0)} enums)")
    print(f"   Dependencies: {dep_count}")
    print(f"   Module Dependencies: {module_dep_count}")
    print(f"   Module Aggregations: {aggregation_count}")
    
    print(f"\n📚 Languages:")
    for lang, count in sorted(language_distribution.items()):
        print(f"   {lang}: {count}")
    
    print(f"\n🏗️  Architecture layers:")
    for layer, count in sorted(layer_distribution.items(), key=lambda x: x[1], reverse=True):
        print(f"   {layer}: {count}")
    
    # Save JSON
    json_file = output_path / 'knowledge-graph.json'
    with open(json_file, 'w', encoding='utf-8') as f:
        json.dump(knowledge_graph, f, indent=2, ensure_ascii=False)
    print(f"\n💾 Knowledge graph saved to: {json_file}")
    
    # Generate visualizations
    print(f"\n🔗 Generating diagrams...")
    
    modules = [n for n in knowledge_graph['nodes'] if n['type'] == 'module']
    build_system = knowledge_graph['metadata']['buildSystem']
    
    if len(modules) > 1 and build_system != 'unknown':
        # Multi-module project: generate module dependency diagram + per-module diagrams
        generate_module_dependencies_dot(knowledge_graph, output_path)
        generate_module_dot_files(knowledge_graph, output_path)
    else:
        # Single-module or no-module project: generate complete project diagram
        if build_system == 'unknown':
            print("   No build system detected - generating complete project diagram")
        else:
            print("   Single module project - generating complete project diagram")
        generate_project_dot(knowledge_graph, output_path)
    
    if not GRAPHVIZ_AVAILABLE:
        print(f"\n⚠️  Graphviz not found - DOT files generated but SVGs skipped")
        instructions = get_graphviz_install_instructions()
        print(instructions)
        
        instructions_file = output_path / 'INSTALL_GRAPHVIZ.txt'
        instructions_file.write_text(f"""Graphviz Installation Instructions
{'=' * 50}

To generate SVG images from DOT files, install Graphviz.
{instructions}

After installing, re-run this script or generate SVGs manually:

cd {output_path}
dot -Tsvg module-dependencies.dot -o module-dependencies.svg

for file in module-*.dot; do
    dot -Tsvg "$file" -o "${{file%.dot}}.svg"
done
""")
    
    print(f"\n✅ Done!")
    
    return knowledge_graph

# ============================================================================
# DOT VISUALIZATION
# ============================================================================

def generate_module_dependencies_dot(kg: Dict, output_path: Path):
    """Generate module dependencies DOT file"""
    module_edges = [e for e in kg['edges'] if e['type'] == 'depends_on']
    aggregation_edges = [e for e in kg['edges'] if e['type'] == 'aggregates']
    
    all_modules = [n['artifactId'] for n in kg['nodes'] if n['type'] == 'module']
    
    dot_content = "digraph module_dependencies {\n"
    dot_content += "  rankdir=TB;\n"
    dot_content += "  ranksep=0.5;\n"
    dot_content += "  nodesep=0.3;\n"
    dot_content += "  node [shape=box, style=filled, fillcolor=lightblue, fontsize=12, margin=0.2];\n"
    dot_content += "  edge [fontsize=10];\n"
    dot_content += "  dpi=150;\n\n"
    
    for module in sorted(all_modules):
        dot_content += f'  "{module}";\n'
    
    dot_content += "\n"
    
    for edge in aggregation_edges:
        from_name = edge['from'].replace('module:', '')
        to_name = edge['to'].replace('module:', '')
        dot_content += f'  "{from_name}" -> "{to_name}" [style=dashed, color=gray, arrowhead=empty];\n'
    
    dot_content += "\n"
    
    for edge in module_edges:
        from_name = edge['from'].replace('module:', '')
        to_name = edge['to'].replace('module:', '')
        scope = edge.get('scope', 'compile')
        dot_content += f'  "{from_name}" -> "{to_name}" [label="{scope}"];\n'
    
    dot_content += "}\n"
    
    dot_file = output_path / 'module-dependencies.dot'
    dot_file.write_text(dot_content)
    
    print(f"   ✓ Module dependencies: {dot_file}")
    
    if GRAPHVIZ_AVAILABLE:
        try:
            svg_file = dot_file.with_suffix('.svg')
            subprocess.run(['dot', '-Tsvg', str(dot_file), '-o', str(svg_file)], 
                          check=True, capture_output=True, timeout=30)
            print(f"   ✓ SVG generated: {svg_file}")
        except:
            pass

def generate_project_dot(kg: Dict, output_path: Path):
    """Generate complete project DOT file (used when no modules)"""
    project_name = kg['metadata']['project']
    all_classes = [n for n in kg['nodes'] if n['type'] == 'class']
    
    if not all_classes:
        return
    
    # Group by package
    packages = {}
    for cls in all_classes:
        pkg = cls.get('package', 'unknown')
        if pkg not in packages:
            packages[pkg] = []
        packages[pkg].append(cls)
    
    # Sanitize project name for DOT identifier (no hyphens allowed)
    safe_project_name = project_name.replace('-', '_').replace('.', '_')
    
    dot_content = f"digraph project_{safe_project_name} {{\n"
    dot_content += "  rankdir=TB;\n"
    dot_content += "  compound=true;\n"
    dot_content += '  node [fontname="Arial", fontsize=10];\n'
    dot_content += '  edge [fontname="Arial", fontsize=8];\n'
    dot_content += f'  label="{project_name}";\n\n'
    
    # Create subgraphs for packages
    pkg_idx = 0
    for pkg, classes in sorted(packages.items()):
        dot_content += f"  subgraph cluster_pkg_{pkg_idx} {{\n"
        dot_content += f'    label="{pkg}";\n'
        dot_content += '    style=filled;\n'
        dot_content += '    fillcolor="#e8f5e9";\n'
        dot_content += '    color="#2e7d32";\n\n'
        
        for cls in classes:
            class_id = cls['id'].replace(':', '_').replace('.', '_')
            class_name = cls['name']
            layer = cls.get('layer', 'other')
            
            colors = {
                'controller': '#bbdefb',
                'service': '#c8e6c9',
                'repository': '#fff9c4',
                'model': '#f8bbd0',
                'config': '#d1c4e9',
                'util': '#e0e0e0',
            }
            color = colors.get(layer, '#f5f5f5')
            
            if layer != 'other':
                label = f"{class_name}\\n«{layer}»"
            else:
                label = class_name
            
            dot_content += f'    "{class_id}" [label="{label}", shape=box, style=filled, fillcolor="{color}"];\n'
        
        dot_content += "  }\n\n"
        pkg_idx += 1
    
    # Add edges
    java_stdlib = {'Object', 'String', 'Integer', 'List', 'Map', 'Set', 'Exception', 'RuntimeException'}
    
    for edge in kg['edges']:
        if edge['type'] in ['extends', 'implements']:
            from_id = edge['from'].replace(':', '_').replace('.', '_')
            to_id = edge['to'].replace(':', '_').replace('.', '_')
            
            target_name = edge['to'].split('.')[-1].replace('class:', '')
            if edge['to'].startswith('class:java.') or target_name in java_stdlib:
                continue
            
            style = 'dashed' if edge['type'] == 'implements' else 'solid'
            dot_content += f'  "{from_id}" -> "{to_id}" [style={style}];\n'
    
    dot_content += "}\n"
    
    # Write DOT file
    dot_file = output_path / f"project-{project_name}.dot"
    dot_file.write_text(dot_content)
    print(f"   ✓ Generated project diagram: {dot_file.name}")
    
    # Generate SVG if Graphviz available
    if GRAPHVIZ_AVAILABLE:
        try:
            svg_file = dot_file.with_suffix('.svg')
            subprocess.run(['dot', '-Tsvg', str(dot_file), '-o', str(svg_file)], 
                          check=True, capture_output=True, timeout=60)
            print(f"   ✓ Generated SVG: {svg_file.name}")
        except Exception as e:
            print(f"   ⚠️  SVG generation failed: {e}")

def generate_module_dot_files(kg: Dict, output_path: Path):
    """Generate per-module DOT files"""
    modules = [n for n in kg['nodes'] if n['type'] == 'module']
    
    for module_node in modules:
        module_name = module_node['artifactId']
        
        module_classes = [n for n in kg['nodes'] 
                         if n['type'] == 'class' and n.get('moduleName') == module_name]
        
        if not module_classes:
            continue
        
        packages = {}
        for cls in module_classes:
            pkg = cls.get('package', 'unknown')
            if pkg not in packages:
                packages[pkg] = []
            packages[pkg].append(cls)
        
        # Sanitize module name for DOT identifier (no hyphens allowed)
        safe_module_name = module_name.replace('-', '_').replace('.', '_')
        
        dot_content = f"digraph module_{safe_module_name} {{\n"
        dot_content += "  rankdir=TB;\n"
        dot_content += "  compound=true;\n"
        dot_content += '  node [fontname="Arial", fontsize=10];\n'
        dot_content += '  edge [fontname="Arial", fontsize=8];\n'
        dot_content += f'  label="Module: {module_name}";\n\n'
        
        pkg_idx = 0
        for pkg, classes in sorted(packages.items()):
            dot_content += f"  subgraph cluster_pkg_{pkg_idx} {{\n"
            dot_content += f'    label="{pkg}";\n'
            dot_content += '    style=filled;\n'
            dot_content += '    fillcolor="#e8f5e9";\n'
            dot_content += '    color="#2e7d32";\n\n'
            
            for cls in classes:
                class_id = cls['id'].replace(':', '_').replace('.', '_')
                class_name = cls['name']
                layer = cls.get('layer', 'other')
                
                colors = {
                    'controller': '#bbdefb',
                    'service': '#c8e6c9',
                    'repository': '#fff9c4',
                    'model': '#f8bbd0',
                    'config': '#d1c4e9',
                    'util': '#e0e0e0',
                }
                color = colors.get(layer, '#f5f5f5')
                
                if layer != 'other':
                    label = f"{class_name}\\n«{layer}»"
                else:
                    label = class_name
                
                dot_content += f'    "{class_id}" [label="{label}", shape=box, style=filled, fillcolor="{color}"];\n'
            
            dot_content += "  }\n\n"
            pkg_idx += 1
        
        external_classes = {}
        java_stdlib = {'Serializable', 'Cloneable', 'Comparable', 'Runnable', 'Callable'}
        
        # Collect annotation sources from imports
        annotation_imports = {}  # class_id -> list of annotation class names
        for cls in module_classes:
            class_id = cls['id']
            annotations = cls.get('annotations', [])
            
            if annotations:
                # Find corresponding file to get imports
                file_info = next((f for f in kg.get('files', []) if any(c['name'] == cls['name'] for c in f.get('classes', []))), None)
                if not file_info:
                    # Fallback: find imports from edges
                    import_edges = [e for e in kg['edges'] if e['from'] == class_id and e['type'] == 'imports']
                    annotation_imports[class_id] = []
                    
                    for ann in annotations:
                        # Find import edge that matches this annotation
                        matching_import = next((e['to'] for e in import_edges 
                                              if e['to'].endswith(f'.{ann}') or e['to'].endswith(f'/{ann}')), None)
                        if matching_import:
                            annotation_imports[class_id].append((ann, matching_import))
        
        # Process edges for external dependencies
        for edge in kg['edges']:
            edge_types_to_show = ['extends', 'implements']
            
            # Also include 'imports' edges for annotations used by classes in this module
            if edge['type'] == 'imports':
                from_class = next((c for c in module_classes if c['id'] == edge['from']), None)
                if from_class:
                    # Check if this import is an annotation used by the class
                    target_name = edge['to'].split('.')[-1].replace('class:', '')
                    if target_name in from_class.get('annotations', []):
                        # This is an annotation import, include it
                        target_id = edge['to']
                        
                        if not target_id.startswith('class:java.'):
                            class_fqn = target_id.replace('class:', '')
                            
                            # Use intelligent grouping (Spring Boot, Spring Cloud, etc.)
                            group_key_name = get_library_group_key(class_fqn)
                            group_key = (group_key_name, 'library')
                            
                            if group_key not in external_classes:
                                external_classes[group_key] = []
                            
                            simple_name = class_fqn.split('.')[-1]
                            external_classes[group_key].append((edge['to'], {
                                'id': edge['to'],
                                'name': simple_name,
                                'moduleName': group_key_name
                            }))
            
            if edge['type'] in edge_types_to_show:
                from_in_module = any(c['id'] == edge['from'] for c in module_classes)
                
                if from_in_module:
                    target_id = edge['to']
                    target_name = target_id.split('.')[-1].replace('class:', '')
                    
                    if target_id.startswith('class:java.') or target_name in java_stdlib:
                        continue
                    
                    to_node = next((n for n in kg['nodes'] if n['id'] == edge['to'] and n['type'] == 'class'), None)
                    
                    if to_node and to_node.get('moduleName') != module_name:
                        group_key = (to_node.get('moduleName', 'unknown'), 'module')
                        if group_key not in external_classes:
                            external_classes[group_key] = []
                        external_classes[group_key].append((edge['to'], to_node))
                    elif not to_node and not target_id.startswith('class:java'):
                        class_fqn = target_id.replace('class:', '')
                        
                        # Use intelligent grouping for extends/implements too
                        group_key_name = get_library_group_key(class_fqn)
                        group_key = (group_key_name, 'library')
                        
                        if group_key not in external_classes:
                            external_classes[group_key] = []
                        
                        simple_name = class_fqn.split('.')[-1]
                        if simple_name not in java_stdlib:
                            external_classes[group_key].append((edge['to'], {
                                'id': edge['to'],
                                'name': simple_name,
                                'moduleName': group_key_name
                            }))
        
        cluster_idx = 0
        for (group_name, group_type), classes in sorted(external_classes.items()):
            if not classes:
                continue
            
            unique_classes = {}
            for ext_id, ext_node in classes:
                if ext_id not in unique_classes:
                    unique_classes[ext_id] = ext_node
            
            if not unique_classes:
                continue
            
            if group_type == 'module':
                fillcolor = '#e1f5fe'
                bordercolor = '#0277bd'
                label = f"Module: {group_name}"
            else:
                fillcolor = '#fff3e0'
                bordercolor = '#e65100'
                friendly = get_friendly_library_name(group_name)
                if friendly != group_name:
                    label = f"Library: {friendly}"
                else:
                    label = f"Library: {group_name}"
            
            dot_content += f'  subgraph cluster_ext_{cluster_idx} {{\n'
            dot_content += f'    label="{label}";\n'
            dot_content += f'    style=filled;\n'
            dot_content += f'    fillcolor="{fillcolor}";\n'
            dot_content += f'    color="{bordercolor}";\n\n'
            
            for ext_id, ext_node in unique_classes.items():
                ext_class_id = ext_id.replace(':', '_').replace('.', '_')
                ext_name = ext_node['name']
                dot_content += f'    "{ext_class_id}" [label="{ext_name}", shape=box, style=filled, fillcolor="#ffe0b2", fontsize=9];\n'
            
            dot_content += '  }\n\n'
            cluster_idx += 1
        
        # Draw edges
        for edge in kg['edges']:
            from_in_module = any(c['id'] == edge['from'] for c in module_classes)
            
            if not from_in_module:
                continue
            
            from_id = edge['from'].replace(':', '_').replace('.', '_')
            to_id = edge['to'].replace(':', '_').replace('.', '_')
            target_name = edge['to'].split('.')[-1].replace('class:', '')
            
            # Skip java stdlib
            if edge['to'].startswith('class:java.') or target_name in java_stdlib:
                continue
            
            if edge['type'] == 'extends':
                dot_content += f'  "{from_id}" -> "{to_id}" [style=solid, label="extends"];\n'
            elif edge['type'] == 'implements':
                dot_content += f'  "{from_id}" -> "{to_id}" [style=dashed, label="implements"];\n'
            elif edge['type'] == 'imports':
                # Only draw imports for annotations
                from_class = next((c for c in module_classes if c['id'] == edge['from']), None)
                if from_class and target_name in from_class.get('annotations', []):
                    # Check if target is in external_classes (was added above)
                    target_in_external = any(target_name == ext_node['name'] 
                                            for group_classes in external_classes.values() 
                                            for _, ext_node in group_classes)
                    if target_in_external:
                        dot_content += f'  "{from_id}" -> "{to_id}" [style=dotted, color="#9e9e9e", label="@{target_name}"];\n'
        
        dot_content += "}\n"
        
        module_dot_file = output_path / f"module-{module_name}.dot"
        module_dot_file.write_text(dot_content)
        
        if GRAPHVIZ_AVAILABLE:
            try:
                svg_file = module_dot_file.with_suffix('.svg')
                subprocess.run(['dot', '-Tsvg', str(module_dot_file), '-o', str(svg_file)], 
                              check=True, capture_output=True, timeout=30)
            except:
                pass
    
    modules_with_classes = len([m for m in modules if any(c.get('moduleName') == m['artifactId'] for c in kg['nodes'] if c['type'] == 'class')])
    print(f"   ✓ Generated {modules_with_classes} module diagrams")

# ============================================================================
# MAIN PROGRAM
# ============================================================================

def main():
    if len(sys.argv) < 2:
        print('Usage: ./build_knowledge_graph.py <project_path> [output_dir]')
        print()
        print('Example:')
        print('  ./build_knowledge_graph.py ~/workspace/my-project kg-output')
        sys.exit(1)
    
    project_path = sys.argv[1]
    output_dir = sys.argv[2] if len(sys.argv) > 2 else 'kg-output'
    
    build_knowledge_graph(project_path, output_dir)

if __name__ == '__main__':
    main()
