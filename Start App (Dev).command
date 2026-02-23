#!/bin/bash
cd "$(dirname "$0")"
# Free ports 3001 and 5173 in case previous runs are still using them
for p in 3001 3002 3003 5173; do lsof -ti:$p 2>/dev/null | xargs kill -9 2>/dev/null; done
true
npm install
npm run dev:electron
