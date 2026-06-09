#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/update-euphony-vendor.sh /path/to/euphony

Or:
  EUPHONY_REPO=/path/to/euphony scripts/update-euphony-vendor.sh

Builds euphony's library output and vendors the generated lib/ files into:
  src/ui/vendor/euphony
EOF
}

euphony_repo="${1:-${EUPHONY_REPO:-}}"
if [[ -z "${euphony_repo}" ]]; then
  usage >&2
  exit 2
fi

if [[ ! -f "${euphony_repo}/package.json" ]]; then
  echo "euphony repository not found or missing package.json: ${euphony_repo}" >&2
  exit 2
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
repo_root="$(cd -- "${script_dir}/.." && pwd -P)"
vendor_dir="${repo_root}/src/ui/vendor/euphony"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

(
  cd "${euphony_repo}"
  corepack pnpm run build:library
)

if [[ ! -f "${euphony_repo}/lib/euphony.js" ]]; then
  echo "euphony build did not produce lib/euphony.js" >&2
  exit 1
fi
if [[ ! -f "${euphony_repo}/LICENSE" ]]; then
  echo "euphony LICENSE file not found" >&2
  exit 1
fi
if [[ ! -f "${euphony_repo}/NOTICE" ]]; then
  echo "euphony NOTICE file not found" >&2
  exit 1
fi

mkdir -p "${tmp_dir}/euphony"
cp -R "${euphony_repo}/lib/." "${tmp_dir}/euphony/"
cp "${euphony_repo}/LICENSE" "${tmp_dir}/euphony/LICENSE"
cp "${euphony_repo}/NOTICE" "${tmp_dir}/euphony/NOTICE"

source_url="$(git -C "${euphony_repo}" remote get-url origin 2>/dev/null || echo "unknown")"
source_commit="$(git -C "${euphony_repo}" rev-parse HEAD 2>/dev/null || echo "unknown")"
source_status="$(git -C "${euphony_repo}" status --short 2>/dev/null || true)"
if [[ -n "${source_status}" ]]; then
  source_state="dirty"
else
  source_state="clean"
fi

cat > "${tmp_dir}/euphony/VENDOR.md" <<EOF
# Vendored Euphony

This directory contains generated frontend library assets from euphony.

- Source: ${source_url}
- Commit: ${source_commit}
- Source tree state at sync time: ${source_state}
- Build command: \`corepack pnpm run build:library\`
- Copied from: \`lib/\`
- License: Apache License 2.0; see \`LICENSE\`
- Notice: see \`NOTICE\`

Do not edit generated files in this directory manually. Re-run
\`scripts/update-euphony-vendor.sh /path/to/euphony\` from the AgentBoard
repository root to refresh them.
EOF

rm -rf "${vendor_dir}"
mkdir -p "$(dirname -- "${vendor_dir}")"
mv "${tmp_dir}/euphony" "${vendor_dir}"

echo "Updated ${vendor_dir}"
