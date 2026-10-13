---
name: Transport validation
description: Verify generated query validators against actual HTTP inputs, not just typed objects.
---

After introducing or regenerating request validation, check the transport boundary with actual URL requests.

**Why:** Code-generated validators can expect native runtime values even when clients send strings. Successful generation and typechecks previously hid a valid calendar-date query being rejected.

**How to apply:** Exercise both valid filters and invalid boundary cases through HTTP. Do not rely solely on tests that pass already-converted JavaScript objects into a schema. Strict calendar-date validation must reject impossible days before any conversion that can roll them into the following month.

Transport-shaped fixtures also matter for response joins: compare calendar days after normalization, not date-only strings against full serialized ISO timestamps.

**Why:** Type-safe fixtures using date-only strings hid a salary/slate join failure with actual serialized response dates.

**How to apply:** Include realistic HTTP-serialized dates in cross-response joining tests. Preserve strict same-day/slate checks rather than weakening identity matching to compensate.
