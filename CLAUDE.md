# CLAUDE.md

See [AGENTS.md](AGENTS.md).

**Docs:** A README is a doorway, not a dump: what it is, how to run it, where the detail lives (aim for under ~150 lines). Reference detail (endpoint and env tables, schema, flows) goes in `docs/` and is linked. Never restate code or another doc; no changelogs, history, pasted output or config dumps. Details: AGENTS.md → Docs.

**Copy:** Every user-facing string is short, sentence case and imperative where it asks for something. No separators in text (`·`, `—`, `–`, `-`, `|`, `→`), no ALL CAPS, no filler. Details: AGENTS.md → User-facing copy.

**Concise:** Docs, comments, commits, PR text and replies state facts only. No notes, caveats, corrections, recaps or paragraphs over three lines. Details: AGENTS.md → Concise writing.

**Workflow:** On the first prompt of a chat, enter plan mode unless the user already did. Plans name files, signatures and the algorithm (LinUCB, heuristic, eval, architecture) with formulas and constants. After approval, spawn subagents to implement, one plan section each. Explore, implement and other agents run on the lightest model (`model: "haiku"`, or the smallest in Codex). Details: AGENTS.md → Workflow.
