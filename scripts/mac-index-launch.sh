#!/bin/sh
# LaunchAgent wrapper: keeps pCloud AI indexing running on the Mac.
# One-time setup: sign in at the site URL in the Mac browser, then open
#   http://localhost:4173/.netlify/functions/mac-index-claim
# The claim page saves the browser session to ~/.sai-index-session and this
# agent picks it up within a minute.
SITE="${SAI_SITE_URL:-http://localhost:4173}"
NODE="${SAI_NODE_BIN:-/Users/saireddy/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node}"
REPO="/Users/saireddy/Downloads/Documents/Sai Photos"
SESS="$HOME/.sai-index-session"
if [ ! -s "$SESS" ]; then
  echo "[sai-index] Waiting for the one-time Mac browser sign-in."
  echo "[sai-index] Open $SITE in the Mac browser, sign in to pCloud, then open $SITE/.netlify/functions/mac-index-claim once."
  sleep 3600
  exit 0
fi
export SAI_SITE_URL="$SITE"
export SAI_SESSION_COOKIE_FILE="$SESS"
exec "$NODE" "$REPO/scripts/mac-index.mjs"
