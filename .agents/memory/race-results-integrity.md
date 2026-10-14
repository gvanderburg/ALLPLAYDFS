---
name: Race-results integrity
description: NASCAR schedule fields can look like results before a race is complete.
---

Do not treat a NASCAR schedule's positive `actual_laps` as proof of a completed race.

**Why:** On 2026-10-13 the official public race list supplied a positive `actual_laps` value for an upcoming race with no winner. A schedule can prepopulate these fields.

**How to apply:** Keep scheduled race length separate from observed results. Historical model inputs require verified completed-race status and reconciled final driver results, not a nonzero lap count or qualifying order. Apply the same rule when adding official weekend-result or telemetry sources.

Official result categories can be internally inconsistent even after the full finishing order reconciles. Do not silently adjust them to force agreement.

**Why:** The official 2025 Daytona 500 feed reports 201 race laps but 202 laps led summed across its classified drivers. The weekend payload also omits the winner ID (available in the race list) and fastest-lap counts. A missing field must not be inferred from practice timing.

**How to apply:** Verify actual schema, reconcile each scoring category separately, preserve valid finish/start/completed-lap inputs, and leave inconsistent led counts or absent fastest laps unavailable. Never treat an absence as zero.
