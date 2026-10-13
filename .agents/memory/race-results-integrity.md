---
name: Race-results integrity
description: NASCAR schedule fields can look like results before a race is complete.
---

Do not treat a NASCAR schedule's positive `actual_laps` as proof of a completed race.

**Why:** On 2026-10-13 the official public race list supplied a positive `actual_laps` value for an upcoming race with no winner. A schedule can prepopulate these fields.

**How to apply:** Keep scheduled race length separate from observed results. Historical model inputs require verified completed-race status and reconciled final driver results, not a nonzero lap count or qualifying order. Apply the same rule when adding official weekend-result or telemetry sources.
