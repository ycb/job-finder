# Lessons Learned

## 2026-03-08 - Lane C Spec Alignment

- Pattern: I started coding before fully reconciling threshold/dependency alignment decisions that had just been updated in docs.
- Prevention rule: Before implementing a multi-doc lane, explicitly verify the authoritative threshold + sequencing values in packet/dispatch/kickoff/plan and mirror those values in defaults/tests (`CLI help`, parser defaults, and assertions) in one pass.
