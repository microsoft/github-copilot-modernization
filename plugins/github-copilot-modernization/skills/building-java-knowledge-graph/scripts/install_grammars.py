#!/usr/bin/env python3
"""
Setup script to download and build tree-sitter language grammars
"""

import os
import shutil
import subprocess
from pathlib import Path

# Grammar repositories
GRAMMARS = {
    'java': 'https://github.com/tree-sitter/tree-sitter-java',
    'kotlin': 'https://github.com/fwcd/tree-sitter-kotlin',
    'scala': 'https://github.com/tree-sitter/tree-sitter-scala',
    'groovy': 'https://github.com/murtaza64/tree-sitter-groovy',
}

def setup_grammars():
    """Download and build tree-sitter grammars"""
    
    # Create vendor directory
    vendor_dir = Path(__file__).parent / 'vendor'
    vendor_dir.mkdir(exist_ok=True)
    
    print("📦 Setting up tree-sitter grammars...")
    
    for lang, repo_url in GRAMMARS.items():
        lang_dir = vendor_dir / f'tree-sitter-{lang}'
        
        # Clone if not exists
        if not lang_dir.exists():
            print(f"\n📥 Cloning {lang} grammar...")
            subprocess.run(['git', 'clone', '--depth', '1', repo_url, str(lang_dir)], 
                          check=True)
        else:
            print(f"\n✓ {lang} grammar already exists")
    
    # Build shared library
    print("\n🔨 Building shared library...")
    from tree_sitter import Language
    
    lib_path = vendor_dir / 'languages.so'
    Language.build_library(
        str(lib_path),
        [str(vendor_dir / f'tree-sitter-{lang}') for lang in GRAMMARS.keys()]
    )
    
    print("\n✅ Setup complete!")
    print(f"   Library: {lib_path} (~{lib_path.stat().st_size // (1024*1024)}MB)")
    
    # Cleanup source directories to save space
    print("\n🧹 Cleaning up grammar source files...")
    space_saved = 0
    for lang in GRAMMARS.keys():
        lang_dir = vendor_dir / f'tree-sitter-{lang}'
        if lang_dir.exists():
            # Calculate size before deletion
            size = sum(f.stat().st_size for f in lang_dir.rglob('*') if f.is_file())
            space_saved += size
            shutil.rmtree(lang_dir)
    
    print(f"   ✓ Removed grammar sources (~{space_saved // (1024*1024)}MB saved)")
    print(f"   ✓ Only kept: languages.so")
    
    print("\n🚀 Ready to use!")
    print("   python3 scripts/build_knowledge_graph.py <project_path> <output_dir>")

if __name__ == '__main__':
    setup_grammars()
