#!/usr/bin/env bash
# Build the Next.js static export and push it to AWS.
#
# What this does, in order:
#   1. Verifies AWS credentials are usable (`sts get-caller-identity`).
#   2. Exports the CLI's resolved credentials as env vars so terraform —
#      which uses its own credential chain — sees the same identity.
#   3. Runs `terraform apply` to ensure the stack is up to date.
#   4. Builds the static export and syncs it to S3 with sensible
#      cache headers.
#   5. Issues a CloudFront invalidation so the change goes live now.
#
# Pass `--yes` (or set DEPLOY_AUTO_APPROVE=1) to skip terraform's
# interactive confirmation prompt.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

AUTO_APPROVE="${DEPLOY_AUTO_APPROVE:-0}"
for arg in "$@"; do
  case "$arg" in
    -y|--yes|--auto-approve) AUTO_APPROVE=1 ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

# The runtime data assets (dictionary + grammar + gloss index) are produced
# by `tools/data-pipeline/` and not committed. `next build` will happily
# copy an empty `public/data/` into `out/`, which would deploy a broken
# bundle — so check up front.
REQUIRED_DATA=(
  "$REPO_ROOT/public/data/dictionary.json.gz"
  "$REPO_ROOT/public/data/grammar.json.gz"
  "$REPO_ROOT/public/data/grammar-manifest.json"
  "$REPO_ROOT/public/data/gloss-index.json.gz"
)
for f in "${REQUIRED_DATA[@]}"; do
  if [[ ! -f "$f" ]]; then
    echo "missing runtime asset: $f" >&2
    echo "run the data pipeline in tools/data-pipeline/ first." >&2
    exit 1
  fi
done

echo "→ verifying AWS credentials"
if ! IDENTITY="$(aws sts get-caller-identity --query 'Arn' --output text 2>&1)"; then
  echo "aws sts get-caller-identity failed:" >&2
  echo "  $IDENTITY" >&2
  echo "run \`aws sso login\` (or your usual login flow) and try again." >&2
  exit 1
fi
echo "  identity: $IDENTITY"

# Resolve the CLI's credentials into env vars so terraform — which has
# its own credential chain and won't follow CLI aliases or implicit
# profiles — uses the exact same identity we just verified.
echo "→ exporting resolved credentials for terraform"
if ! CRED_EXPORT="$(aws configure export-credentials --format env 2>&1)"; then
  echo "aws configure export-credentials failed:" >&2
  echo "  $CRED_EXPORT" >&2
  echo "this command requires AWS CLI v2." >&2
  exit 1
fi
eval "$CRED_EXPORT"

if [[ -z "${AWS_ACCESS_KEY_ID:-}" ]]; then
  echo "credential export produced no AWS_ACCESS_KEY_ID — aborting." >&2
  exit 1
fi

echo "→ running terraform apply"
terraform -chdir=terraform init -input=false >/dev/null
APPLY_ARGS=(-input=false)
if [[ "$AUTO_APPROVE" == "1" ]]; then
  APPLY_ARGS+=(-auto-approve)
fi
terraform -chdir=terraform apply "${APPLY_ARGS[@]}"

BUCKET="$(terraform -chdir=terraform output -raw s3_bucket_name)"
DISTRIBUTION_ID="$(terraform -chdir=terraform output -raw cloudfront_distribution_id)"

echo "→ building static export"
# `postinstall` already syncs the kuromoji IPADIC into public/dict/, and the
# JMdict + grammar artifacts live under public/data/ in the repo — both end
# up under `out/` automatically when `next build` copies `public/`.
npm run build

OUT_DIR="$REPO_ROOT/out"
if [[ ! -d "$OUT_DIR" ]]; then
  echo "expected $OUT_DIR after build — is output: 'export' still set in next.config.ts?" >&2
  exit 1
fi

echo "→ syncing $OUT_DIR to s3://$BUCKET"
# Two cache policies, by URL stability:
#   1. Content-addressed assets get a 1-year immutable cache. That covers the
#      fingerprinted /_next/* bundles AND the handwriting recognizer: the model
#      lives at a fixed path (/data/kanji-recognizer.onnx), but the loader
#      requests it with a `?v=<contenthash>` query read from
#      recognizer-manifest.json, so a retrained model is a *new* URL that every
#      client re-fetches — even one holding the previous immutable copy.
#   2. The fixed entry points (HTML, JSON, manifest) keep a stable URL across
#      deploys, so they get a short TTL and must revalidate. This is what lets a
#      returning client discover the new model hash in recognizer-manifest.json
#      (a *.json, so it falls in this pass).
#
# NOTE: the large /data/*.gz dictionary artifacts are also immutably cached but
# are NOT yet content-versioned — they rebuild rarely, so returning browsers
# keep the prior copy until eviction. Give them the same manifest treatment if
# that ever becomes a problem.
aws s3 sync "$OUT_DIR" "s3://$BUCKET" \
  --delete \
  --exclude "*.html" \
  --exclude "*.json" \
  --exclude "*.webmanifest" \
  --cache-control "public, max-age=31536000, immutable"

aws s3 sync "$OUT_DIR" "s3://$BUCKET" \
  --exclude "*" \
  --include "*.html" \
  --include "*.json" \
  --cache-control "public, max-age=60, must-revalidate"

# `.webmanifest` is not in the AWS CLI's default MIME database, so the
# sync above would upload it as application/octet-stream — which Safari
# rejects. Re-upload with the correct content type.
if [[ -f "$OUT_DIR/manifest.webmanifest" ]]; then
  aws s3 cp "$OUT_DIR/manifest.webmanifest" "s3://$BUCKET/manifest.webmanifest" \
    --content-type "application/manifest+json" \
    --cache-control "public, max-age=60, must-revalidate"
fi

echo "→ invalidating CloudFront distribution $DISTRIBUTION_ID"
aws cloudfront create-invalidation \
  --distribution-id "$DISTRIBUTION_ID" \
  --paths "/*" \
  >/dev/null

echo "✓ deploy complete"
