---
name: NASCAR scoring verification
description: Contest-specific primary rules differ from Pick6 and third-party NASCAR tables.
---

Use the primary rule feed for the exact contest variant; do not replace Classic scoring with Pick6 coefficients or third-party tables.

**Why:** On 2026-10-13 the DraftKings web Classic rules renderer's public RulesAndScoring.json listed winner 46 / fastest lap 0.5, while its official Pick6 page and third-party tables listed winner 45 / fastest lap 0.45. This is a real source conflict, not permission to choose familiar coefficients.

**How to apply:** The Classic renderer loads https://api.draftkings.com/rules-and-scoring/RulesAndScoring.json. Recheck its NASCAR Classic entry when updating scoring, disclose the rules-as-of date and contest variant, and keep full scores unavailable if a required input is unsupported. Do not claim counterfactual rules reproduce historical settled contest totals.
