---
name: agent-contract-handoff
description: Template and rules for writing an API/field contract and copy-paste handoff messages when work spans several AI agents (Claude, Codex, Muse, ChatGPT) that cannot read each other's chats. Use when a task says to "negotiate the API with Codex" or "align fields with Muse".
---

# Contract + handoff across agents

Agents here do not share memory or chats, and a session cannot be messaged unless its ID is known and clearly the intended recipient. Do not message arbitrary sessions found in a listing. Write one durable doc in the repo and give the user copy-paste messages.

## Doc skeleton (`docs/<FEATURE>_API_CONTRACT.md`)
1. **Status legend:** *Implemented* (in this PR, tested) · *Proposed* (needs the owner's decision; nothing depends on it) · *Unverified* (needs real data).
2. **Endpoints in use** — a table: purpose · request · fields actually read. Only what the code uses.
3. **Behaviors that depend on the contract** — error mapping (404 vs 5xx vs 401 vs 409), retry rules, id generation, what persists vs stays local.
4. **Changes made to someone else's code** — file, exact change, how it is tested, who must acknowledge.
5. **Proposals for the API owner** — ordered by user impact, each marked non-blocking if true.
6. **Field alignment for the data owner** — assumptions about real data, phrased as questions; say plainly that tests ran on synthetic data.
7. **Handoff messages** — one short block per recipient: branch/PR, which section to read, what decision is needed, how to run tests.

## Rules
- Never present a proposal as implemented, or synthetic-data results as real-data verification.
- Keep tokens/credentials out of the doc and messages; reference the secret store.
- Link the doc from the README and the PR "Needs a decision" section so the user can forward it.
- Stack the PR on the dependency's branch (base = that branch) so the diff shows only your work.
