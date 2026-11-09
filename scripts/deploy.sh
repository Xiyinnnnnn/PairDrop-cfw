#!/usr/bin/env bash
# 在 Termux(aarch64/Android) 上部署 pairdrop-cfw
# 前置：pkg install nodejs libicu ；npm install ；bash scripts/patch-workerd.sh
# 用法：CLOUDFLARE_API_TOKEN=xxx CLOUDFLARE_ACCOUNT_ID=yyy ./scripts/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."
: "${CLOUDFLARE_API_TOKEN:?需要 CLOUDFLARE_API_TOKEN（需 Workers Scripts:Edit / Durable Objects:Edit）}"
: "${CLOUDFLARE_ACCOUNT_ID:?需要 CLOUDFLARE_ACCOUNT_ID}"
node -e 'import("./src/index.js").then(()=>{},e=>{console.error(e);process.exit(1)})' || true
npx wrangler deploy "$@"
