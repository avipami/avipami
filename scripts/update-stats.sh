#!/usr/bin/env bash
# Regenerate the profile stats cards locally and push them to the README.
# Uses your gh CLI login — the token never leaves this machine and is not
# stored anywhere (no cloud secrets involved).
#
#   ./scripts/update-stats.sh
set -euo pipefail
cd "$(dirname "$0")/.."

# The generator needs Node 18+ (global fetch); prefer the newest nvm install.
NODE=$(command -v node || true)
if [ -z "$NODE" ] || [ "$("$NODE" -e 'console.log(process.versions.node.split(".")[0])')" -lt 18 ]; then
  NODE=$(ls -d "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | sort -V | tail -n 1 || true)
fi
if [ -z "$NODE" ]; then
  echo "error: Node 18+ not found" >&2
  exit 1
fi

# Token preference:
#   1. STATS_TOKEN env var, if exported
#   2. macOS keychain item "github-stats-token" (add one with:
#      security add-generic-password -s github-stats-token -a avipami -w)
#   3. your gh CLI login
# Use a PAT that is SSO-authorized for your work org to include work repos
# (Configure SSO on the token page); the plain gh token only sees personal ones.
STATS_TOKEN="${STATS_TOKEN:-$(security find-generic-password -s github-stats-token -w 2>/dev/null || true)}"
STATS_TOKEN="$STATS_TOKEN" GITHUB_TOKEN="$(gh auth token)" USER_LOGIN=avipami OUT=assets/stats \
  "$NODE" scripts/generate-stats.mjs

git add assets/stats
if git diff --cached --quiet -- assets/stats; then
  echo "Stats unchanged — nothing to push."
  exit 0
fi
git commit -m "Update stats cards ($(date +%Y-%m-%d))"
git push origin main
echo "Stats cards updated and pushed."
