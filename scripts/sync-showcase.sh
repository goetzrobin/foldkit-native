#!/usr/bin/env bash
# Copies the adapter and its demo programs into apps/showcase/native, keeping
# their relative paths, so the app bundles exactly what the tests run.
# Test files and test helpers are left out. Run after changing packages/native.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
from="$here/packages/native"
dest="$here/apps/showcase/native"
# The copy is generated. Files left from an earlier layout (a file that has
# since moved) would still be bundled and type-checked, so it starts empty.
if [ -d "$dest" ]; then find "$dest" -type f -name '*.ts' -delete; fi
(cd "$from" && find src test -name '*.ts' ! -name '*.test.ts' ! -path 'test/support/*' -print0) |
  while IFS= read -r -d '' file; do
    mkdir -p "$dest/$(dirname "$file")"
    # Metro resolves TypeScript files without the `.js` the tests import with.
    sed -e "s#\(from '\.\{1,2\}/[^']*\)\.js'#\1'#" -e "s#\(^import '\.\{1,2\}/[^']*\)\.js'#\1'#" "$from/$file" > "$dest/$file"
  done
echo "Synced packages/native into apps/showcase/native"
