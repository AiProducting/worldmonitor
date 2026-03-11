#!/usr/bin/env bash
# upstream-sync.sh — Fetch upstream/main and preview/apply changes to a local branch
# Usage:
#   ./scripts/upstream-sync.sh preview [branch]   — show what upstream would change (dry-run)
#   ./scripts/upstream-sync.sh merge   [branch]   — merge upstream/main into branch
#   ./scripts/upstream-sync.sh rebase  [branch]   — rebase branch onto upstream/main
#   ./scripts/upstream-sync.sh diff    [branch]   — show files changed between branch and upstream
#   ./scripts/upstream-sync.sh status              — show divergence of all branches vs upstream
#
# Default branch: dev
# This script NEVER pushes to upstream. Push-url is set to DISABLED.

set -euo pipefail

UPSTREAM_REMOTE="upstream"
UPSTREAM_BRANCH="main"
DEFAULT_BRANCH="dev"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()  { echo -e "${BLUE}▸${NC} $*"; }
ok()    { echo -e "${GREEN}✓${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠${NC} $*"; }
err()   { echo -e "${RED}✗${NC} $*" >&2; }

fetch_upstream() {
  info "Fetching ${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}..."
  git fetch "${UPSTREAM_REMOTE}" "${UPSTREAM_BRANCH}" --quiet
  ok "Upstream fetched."
}

cmd_status() {
  fetch_upstream
  echo ""
  echo "Branch divergence vs ${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}:"
  echo "─────────────────────────────────────────────────────"
  for branch in main dev finance; do
    if git rev-parse --verify "$branch" &>/dev/null; then
      ahead=$(git rev-list --count "${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}..${branch}" 2>/dev/null || echo "?")
      behind=$(git rev-list --count "${branch}..${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}" 2>/dev/null || echo "?")
      printf "  %-12s  ahead: %-4s  behind: %-4s\n" "$branch" "$ahead" "$behind"
    fi
  done
  echo ""
}

cmd_preview() {
  local branch="${1:-$DEFAULT_BRANCH}"
  fetch_upstream

  echo ""
  info "Preview: merging ${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH} into ${branch}"
  echo ""

  behind=$(git rev-list --count "${branch}..${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}")
  ahead=$(git rev-list --count "${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}..${branch}")
  echo "  ${branch} is ${ahead} ahead, ${behind} behind upstream"
  echo ""

  if [ "$behind" -eq 0 ]; then
    ok "Already up to date!"
    return
  fi

  info "Commits that would be merged (newest first):"
  git log --oneline "${branch}..${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}" | head -30
  echo ""

  info "Files that would change:"
  git diff --stat "${branch}...${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}" | tail -20
  echo ""

  # Check for conflicts using merge-tree
  merge_base=$(git merge-base "${branch}" "${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}")
  info "Checking for potential conflicts..."
  conflict_output=$(git merge-tree "$merge_base" "${branch}" "${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}" 2>&1 || true)
  if echo "$conflict_output" | grep -q "^<<<<<"; then
    warn "CONFLICTS DETECTED in these files:"
    echo "$conflict_output" | grep -B1 "^<<<<<" | grep "^changed in" | sort -u
    echo ""
    warn "You should resolve conflicts carefully when merging."
  else
    ok "No conflicts detected — clean merge expected."
  fi
}

cmd_diff() {
  local branch="${1:-$DEFAULT_BRANCH}"
  fetch_upstream
  echo ""
  info "Files different between ${branch} and ${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}:"
  git diff --stat "${branch}..${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}"
}

cmd_merge() {
  local branch="${1:-$DEFAULT_BRANCH}"
  fetch_upstream

  behind=$(git rev-list --count "${branch}..${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}")
  if [ "$behind" -eq 0 ]; then
    ok "${branch} is already up to date with upstream."
    return
  fi

  info "Merging ${behind} commits from ${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH} into ${branch}"

  current_branch=$(git branch --show-current)
  if [ "$current_branch" != "$branch" ]; then
    # Stash any uncommitted work
    stashed=false
    if ! git diff --quiet || ! git diff --cached --quiet; then
      git stash push -m "upstream-sync: auto-stash before switching to ${branch}"
      stashed=true
    fi
    git checkout "$branch"
  fi

  if git merge "${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}" --no-edit -m "chore: sync upstream/${UPSTREAM_BRANCH} into ${branch}"; then
    ok "Merge successful!"
  else
    warn "Merge has conflicts. Resolve them, then run: git merge --continue"
    warn "Or abort with: git merge --abort"
    return 1
  fi

  if [ "${current_branch}" != "$branch" ]; then
    git checkout "$current_branch"
    if [ "$stashed" = true ]; then
      git stash pop
    fi
  fi
}

cmd_rebase() {
  local branch="${1:-$DEFAULT_BRANCH}"
  fetch_upstream

  behind=$(git rev-list --count "${branch}..${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}")
  if [ "$behind" -eq 0 ]; then
    ok "${branch} is already up to date with upstream."
    return
  fi

  info "Rebasing ${branch} onto ${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH} (${behind} new upstream commits)"

  current_branch=$(git branch --show-current)
  if [ "$current_branch" != "$branch" ]; then
    stashed=false
    if ! git diff --quiet || ! git diff --cached --quiet; then
      git stash push -m "upstream-sync: auto-stash before rebase"
      stashed=true
    fi
    git checkout "$branch"
  fi

  if git rebase "${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}"; then
    ok "Rebase successful!"
  else
    warn "Rebase has conflicts. Resolve them, then run: git rebase --continue"
    warn "Or abort with: git rebase --abort"
    return 1
  fi

  if [ "${current_branch}" != "$branch" ]; then
    git checkout "$current_branch"
    if [ "$stashed" = true ]; then
      git stash pop
    fi
  fi
}

# ── Main ──
case "${1:-help}" in
  preview) cmd_preview "${2:-}" ;;
  merge)   cmd_merge   "${2:-}" ;;
  rebase)  cmd_rebase  "${2:-}" ;;
  diff)    cmd_diff    "${2:-}" ;;
  status)  cmd_status ;;
  *)
    echo "Usage: $0 {preview|merge|rebase|diff|status} [branch]"
    echo ""
    echo "Commands:"
    echo "  preview [branch]  Show what upstream changes would be merged (dry-run)"
    echo "  merge   [branch]  Merge upstream/main into branch"
    echo "  rebase  [branch]  Rebase branch onto upstream/main"
    echo "  diff    [branch]  Show file diff between branch and upstream"
    echo "  status            Show divergence of main/dev/finance vs upstream"
    echo ""
    echo "Default branch: dev"
    ;;
esac
