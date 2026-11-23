#!/usr/bin/env bash
# Copies the adapter source into each app. The apps carry a copy because
# Metro resolves files inside the app folder most simply. Run after changing
# packages/native/src.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
for app in "$here"/apps/*/; do
  dest="$app/src/foldkit-native"
  [ -d "$dest" ] || continue
  (cd "$here/packages/native/src" && find . -name '*.ts' -print0) | while IFS= read -r -d '' file; do
    mkdir -p "$dest/$(dirname "$file")"
    sed "s#\(from '\.\{1,2\}/[^']*\)\.js'#\1'#" "$here/packages/native/src/$file" > "$dest/$file"
  done
done
echo "Synced packages/native/src into apps/*/src/foldkit-native"
