#!/usr/bin/env bash
# Copies the adapter (packages/native/src) and Fold Chat's program
# (packages/native/flagship) into apps/chat/native, keeping their relative
# paths, so the app bundles exactly what the tests run. Run after changing
# either. The copy is generated: git ignores it.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
from="$here/packages/native"
dest="$here/apps/chat/native"
# The copy is generated. Files left from an earlier layout (a file that has
# since moved) would still be bundled and type-checked, so it starts empty.
if [ -d "$dest" ]; then find "$dest" -type f -name '*.ts' -delete; fi
(cd "$from" && find src flagship -name '*.ts' ! -name '*.test.ts' -print0) |
  while IFS= read -r -d '' file; do
    mkdir -p "$dest/$(dirname "$file")"
    # Metro resolves TypeScript files without the `.js` the tests import with.
    sed -e "s#\(from '\.\{1,2\}/[^']*\)\.js'#\1'#" -e "s#\(^import '\.\{1,2\}/[^']*\)\.js'#\1'#" "$from/$file" > "$dest/$file"
  done
echo "Synced packages/native into apps/chat/native"
