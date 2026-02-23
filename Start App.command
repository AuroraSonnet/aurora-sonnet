#!/bin/bash
cd "$(dirname "$0")"
# Free ports 3001–3003 in case a previous run is still using them
for p in 3001 3002 3003; do lsof -ti:$p 2>/dev/null | xargs kill -9 2>/dev/null; done
true
npm install
npm run build
npx electron .
