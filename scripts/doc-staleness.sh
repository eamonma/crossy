#!/usr/bin/env bash
# Advisory doc-staleness check (.claude/skills/dream/SKILL.md).
#
# Warns when a doc with `status: normative` frontmatter has a `verified` watermark
# more than DOC_STALENESS_THRESHOLD (default 15) code commits behind HEAD, or was
# never verified. Doc-only commits do not count against the threshold. Always exits
# 0: a warning means a dream is due, not that anything is broken. In GitHub Actions
# the ::warning:: lines render as annotations; locally they print as plain text.
set -euo pipefail

THRESHOLD="${DOC_STALENESS_THRESHOLD:-15}"

git ls-files '*.md' | while IFS= read -r doc; do
  head -n 1 "$doc" | grep -qx -- '---' || continue

  frontmatter=$(awk '/^---$/ { n++; next } n == 1 { print } n >= 2 { exit }' "$doc")
  status=$(printf '%s\n' "$frontmatter" | sed -n 's/^status:[[:space:]]*//p' | head -n 1)
  [ "$status" = "normative" ] || continue

  verified=$(printf '%s\n' "$frontmatter" | sed -n 's/^verified:[[:space:]]*//p' | head -n 1)
  if [ -z "$verified" ]; then
    echo "::warning file=${doc}::normative doc never verified; a dream is due (/dream)"
    continue
  fi
  if ! git cat-file -e "${verified}^{commit}" 2>/dev/null; then
    echo "::warning file=${doc}::verified watermark ${verified} is not a commit here (shallow clone or bad sha)"
    continue
  fi

  behind=$(git rev-list --count "${verified}..HEAD" -- ':!*.md')
  if [ "$behind" -gt "$THRESHOLD" ]; then
    echo "::warning file=${doc}::${behind} code commits since last verification (${verified}); a dream is due (/dream)"
  fi
done
