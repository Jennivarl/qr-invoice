#!/bin/sh
# Creates the view-only wallet on first boot, then starts the server.
set -e
: "${WALLET_DIR:=/data/wallet}"
: "${LWD_SERVER:=zecrocks}"

if [ ! -f "$WALLET_DIR/data.sqlite" ]; then
  if [ -z "$MERCHANT_UFVK" ]; then
    echo "MERCHANT_UFVK is not set. Export your wallet's Unified Full Viewing Key and set it." >&2
    exit 1
  fi
  mkdir -p "$WALLET_DIR"
  zcash-devtool wallet -w "$WALLET_DIR" init-fvk --name merchant --fvk "$MERCHANT_UFVK" \
    ${WALLET_BIRTHDAY:+--birthday "$WALLET_BIRTHDAY"} -s "$LWD_SERVER"
fi

exec node server.js
