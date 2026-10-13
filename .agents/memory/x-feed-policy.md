---
name: Free X feed policy
description: ALLPLAY's X feed must use free website embeds, not paid API requests.
---

Use X's free website HTML widgets for ALLPLAY's sports feed. Do not use the attached X connector to fetch posts.

**Why:** The user explicitly replaced the connected API feed with free HTML embedding after X required API credits. A connected credential is not permission to introduce paid data requests.

**How to apply:** Preserve this restriction when changing the feed. Do not restore X API queries or billing-dependent polling without explicit user approval. Use public profile/list sources supported by X's widget; never promise an embedded personal Home timeline.
