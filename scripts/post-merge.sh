#!/bin/bash
set -euo pipefail

# Run from the workspace root even when invoked from another directory.
cd "$(dirname "${BASH_SOURCE[0]}")/.."

CI=1 pnpm install --frozen-lockfile
pnpm run typecheck:libs

# Schema pushes can prompt for destructive rename/drop decisions. Do not run
# them automatically for unrelated merges; apply reviewed migrations separately.
