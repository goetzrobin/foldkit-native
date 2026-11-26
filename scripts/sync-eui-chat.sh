#!/usr/bin/env bash
# Copies what the Effect Chat app runs into apps/eui-chat/native, keeping the
# relative paths between the two packages, so the app bundles exactly what
# the tests run:
#   packages/native/src/host         the phone part (no Foldkit in it)
#   packages/effect-ui-native/src    the Effect UI host and vocabulary
#   packages/effect-ui-native/chat   the app's program
# Run after changing any of them. The copy is generated: git ignores it.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
dest="$here/apps/eui-chat/native"
# Files left from an earlier layout would still be bundled, so it starts empty.
if [ -d "$dest" ]; then find "$dest" -type f -name '*.ts' -delete; fi
copy() {
  local from="$1" to="$2"
  shift 2
  (cd "$from" && find "$@" -name '*.ts' ! -name '*.test.ts' ! -path '*/testing/*' -print0) |
    while IFS= read -r -d '' file; do
      mkdir -p "$to/$(dirname "$file")"
      # Metro resolves TypeScript files without the `.js` the tests import with.
      sed -e "s#\(from '\.\{1,2\}/[^']*\)\.js'#\1'#" -e "s#\(^import '\.\{1,2\}/[^']*\)\.js'#\1'#" "$from/$file" > "$to/$file"
    done
}
copy "$here/packages/native" "$dest/native" src/host
copy "$here/packages/effect-ui-native" "$dest/effect-ui-native" src chat
echo "Synced the host layer and Effect Chat into apps/eui-chat/native"
