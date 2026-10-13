---
name: Historical evaluation integrity
description: Conservative completion evidence, pool bias and ownership-ground-truth boundaries for historical research.
---

Historical research must prefer a smaller or empty sample over unverifiable pre-game history. Scheduled event time is not evidence that final results were available: games can cross UTC midnight or be suspended. Require a reconciled final-event timestamp, or proof the server observed a final result before the cutoff.

**Why:** A retrospective “final” status describes the game now, not its status at the historical cutoff. Using start time alone can leak later results into earlier forecasts.

**How to apply:** Keep forecast construction separate from outcome joins. Do not relax completion evidence to make sparse backtests look more useful; explain coverage exclusions instead. Distinguish reconstructed/corrected history from source versions actually captured pre-game.

Recovered pre-game rosters are not automatically official contest eligibility. Prior-appearance pools and missing observed appearances require selection-bias warnings; DNP/missing records are not verified zero scores.

**Why:** The requested evaluation must not mistake today's rosters, eventual participants or survivor-only box scores for the original player universe.

**How to apply:** Use timestamped historical contest exports where recoverable, retain their provenance, and never select replay players based on evaluation-game participants or subsequent injury information.

Ownership import verification means owner attestation plus structural, identity and percentage-unit validation unless the provider independently authenticates the export. Never describe that attestation as independent provider authentication.

**Why:** Contest ownership cannot be established from forecasts or heuristic shares. CSV format checks alone cannot prove that percentages came from a real contest.

**How to apply:** Retain private immutable source bytes, hashes and provenance; pair only the same contest/site/slate estimates with imported actual percentages. Without an actual export, leave ownership calibration unavailable. Keep historical scoring counterfactual when effective contest rules are not recoverable, applying the same dated rules to both sides.
