#!/usr/bin/env bash
# upstream-preview.sh
# Preview incoming upstream commits and potential conflicts BEFORE merging.
# Usage: bash scripts/upstream-preview.sh [--merge]
#
# Without --merge: shows diff stats + conflict risk analysis
# With    --merge: performs the stash→merge→pop workflow

set -euo pipefail
UPSTREAM_REMOTE="${UPSTREAM_REMOTE:-upstream}"
UPSTREAM_BRANCH="${UPSTREAM_BRANCH:-main}"
TARGET="$UPSTREAM_REMOTE/$UPSTREAM_BRANCH"

RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'

# ── 1. Fetch latest ──────────────────────────────────────────────────────────
echo -e "${CYAN}» Fetching $TARGET...${NC}"
git fetch "$UPSTREAM_REMOTE" 2>&1 | tail -3

NEW_COMMITS=$(git log HEAD.."$TARGET" --oneline 2>/dev/null | wc -l | tr -d ' ')
if [ "$NEW_COMMITS" -eq 0 ]; then
  echo -e "${GREEN}✔ Already up to date with $TARGET${NC}"
  exit 0
fi

# ── 2. New commits ───────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}» $NEW_COMMITS new commit(s) on $TARGET:${NC}"
git log HEAD.."$TARGET" --oneline --decorate

# ── 3. Files changed upstream ────────────────────────────────────────────────
echo ""
echo -e "${CYAN}» Files changed in upstream commits (stat):${NC}"
git diff --stat HEAD "$TARGET"

# ── 4. Our local modifications ───────────────────────────────────────────────
echo ""
LOCAL_MOD=$(git diff --name-only)
echo -e "${CYAN}» Our locally modified files ($(echo "$LOCAL_MOD" | grep -c . || echo 0)):${NC}"
echo "$LOCAL_MOD"

# ── 5. Conflict risk analysis ────────────────────────────────────────────────
UPSTREAM_FILES=$(git diff --name-only HEAD "$TARGET")
echo ""
echo -e "${CYAN}» Overlap analysis (files changed in BOTH upstream AND locally):${NC}"
CONFLICTS=0
while IFS= read -r file; do
  if echo "$LOCAL_MOD" | grep -qx "$file"; then
    echo -e "  ${RED}OVERLAP${NC}  $file"
    CONFLICTS=$((CONFLICTS + 1))
  fi
done <<< "$UPSTREAM_FILES"

if [ "$CONFLICTS" -eq 0 ]; then
  echo -e "  ${GREEN}No overlapping files — merge likely clean${NC}"
else
  echo -e "  ${YELLOW}$CONFLICTS overlapping file(s) — stash→merge may auto-resolve, but review after${NC}"
fi

# ── 6. TypeScript surface area ───────────────────────────────────────────────
TS_CHANGED=$(git diff --name-only HEAD "$TARGET" | grep -E '\.(ts|tsx)$' | wc -l | tr -d ' ')
echo ""
echo -e "${CYAN}» TypeScript files changed upstream: ${TS_CHANGED}${NC}"
git diff --name-only HEAD "$TARGET" | grep -E '\.(ts|tsx)$' || true

# ── 7. Merge execution ───────────────────────────────────────────────────────
if [ "${1:-}" = "--merge" ]; then
  echo ""
  echo -e "${CYAN}» --merge flag detected. Running stash → merge → stash pop...${NC}"
  git stash --include-untracked
  if git merge "$TARGET"; then
    git stash pop
    echo -e "${GREEN}✔ Merge complete. Running npx tsc --noEmit to verify...${NC}"
    npx tsc --noEmit 2>&1 | head -40 || true
    echo ""
    echo -e "${GREEN}✔ Done. Review any TypeScript errors above before committing.${NC}"
  else
    echo -e "${RED}✘ Merge had conflicts. Resolve them, then run: git stash pop${NC}"
    exit 1
  fi
else
  echo ""
  echo -e "${YELLOW}» To apply this merge run:  bash scripts/upstream-preview.sh --merge${NC}"
  echo -e "${YELLOW}» To see full diff run:     git diff HEAD $TARGET${NC}"
fi
