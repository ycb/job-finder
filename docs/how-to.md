
How to:


1. If a stale node process was holding 127.0.0.1:4311, this will kill it:

kill "$(lsof -t -nP -iTCP:4311 -sTCP:LISTEN)" && npm run review

OR, run review on a different port:

npm run review -- 4312