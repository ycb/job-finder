
How to:


1. For stakeholder QA on the fixed local URL, use:

```bash
npm run review:qa
```

This stops stale review/watch/follow processes, stops the review LaunchAgent if it is running, and then claims `http://127.0.0.1:4311` for the current `/Users/admin/job-finder` checkout.
It preserves an already-healthy local browser bridge so QA does not fail by tearing down `4315` and trying to recreate it unnecessarily.

2. If you intentionally want the background auto-follow service back afterward:

```bash
npm run review:agent:start
```

OR, run review on a different port:

npm run review -- 4312
