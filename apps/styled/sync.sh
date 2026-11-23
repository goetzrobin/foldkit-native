#!/usr/bin/env bash
# Copies what this app runs from packages/native into the app:
#   packages/native/src            -> src/foldkit-native   (the adapter)
#   packages/native/test/demos/styling.ts -> src/demos/styling.ts (the demo)
# The app carries copies because Metro resolves files inside the app folder
# most simply, and Tailwind scans the app folder for class names.
#
# scripts/sync-apps.sh does the first half for every app. This script also
# brings the demo, and touches only this app. Run it after changing either.
set -euo pipefail
app="$(cd "$(dirname "$0")" && pwd)"
native="$app/../../packages/native"

strip_js="s#\(from '\.\{1,2\}/[^']*\)\.js'#\1'#"

(cd "$native/src" && find . -name '*.ts' -print0) | while IFS= read -r -d '' file; do
  mkdir -p "$app/src/foldkit-native/$(dirname "$file")"
  sed "$strip_js" "$native/src/$file" > "$app/src/foldkit-native/$file"
done

mkdir -p "$app/src/demos"
sed -e "s#'\.\./\.\./src/index\.js'#'../foldkit-native'#" \
    -e "s#'\.\./\.\./src/styling/index\.js'#'../foldkit-native/styling'#" \
    -e "$strip_js" \
    "$native/test/demos/styling.ts" > "$app/src/demos/styling.ts"

echo "Synced the adapter and the styling demo into apps/styled/src"
