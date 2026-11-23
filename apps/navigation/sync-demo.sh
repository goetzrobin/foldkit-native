#!/usr/bin/env bash
# Copies the adapter source and the navigation demo into this app, as
# scripts/sync-apps.sh does for the adapter, with import paths that resolve
# inside the app folder. Run after changing packages/native/src or
# packages/native/test/demos/navigation.ts.
set -euo pipefail
app="$(cd "$(dirname "$0")" && pwd)"
native="$app/../../packages/native"
dest="$app/src/foldkit-native"
(cd "$native/src" && find . -name '*.ts' -print0) | while IFS= read -r -d '' file; do
  mkdir -p "$dest/$(dirname "$file")"
  sed "s#\(from '\.\{1,2\}/[^']*\)\.js'#\1'#" "$native/src/$file" > "$dest/$file"
done
sed -e "s#'\.\./\.\./src/index\.js'#'./foldkit-native'#" \
    -e "s#'\.\./\.\./src/navigation\.js'#'./foldkit-native/navigation'#" \
    "$native/test/demos/navigation.ts" > "$app/src/demo.ts"
echo "Synced the adapter and the navigation demo into apps/navigation/src"
