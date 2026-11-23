#!/usr/bin/env bash
# Links the adapter's test dependencies from a Foldkit fork checkout, so the
# adapter and Foldkit share one copy of Effect and vitest.
#
#   FOLDKIT_DIR=/path/to/foldkit-fork scripts/setup-tests.sh
set -euo pipefail
: "${FOLDKIT_DIR:?Set FOLDKIT_DIR to the Foldkit fork checkout (pnpm install run in it)}"
here="$(cd "$(dirname "$0")/.." && pwd)"
from="$FOLDKIT_DIR/packages/foldkit/node_modules"
to="$here/packages/native/node_modules"
mkdir -p "$to/@effect"
ln -sfn "$(readlink -f "$from/effect")" "$to/effect"
ln -sfn "$(readlink -f "$from/@effect/platform-browser")" "$to/@effect/platform-browser"
ln -sfn "$(readlink -f "$from/vitest")" "$to/vitest"
echo "Linked effect, @effect/platform-browser and vitest into packages/native/node_modules"
