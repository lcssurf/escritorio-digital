#!/bin/bash
# Abre o Escritório Digital no Mac: dê dois cliques neste arquivo.
cd "$(dirname "$0")" || exit 1
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  osascript -e 'display dialog "Instale o Node.js (nodejs.org) e abra de novo." buttons {"OK"} with icon caution' >/dev/null 2>&1
  exit 1
fi
[ -d node_modules ] || npm install --no-audit --no-fund
nohup ./node_modules/.bin/electron . >/dev/null 2>&1 &
