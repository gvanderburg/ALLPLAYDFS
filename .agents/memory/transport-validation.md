---
name: Transport validation
description: Verify generated query validators against actual HTTP inputs, not just typed objects.
---

After introducing or regenerating request validation, check the transport boundary with actual URL requests.

**Why:** Code-generated validators can expect native runtime values even when clients send strings. Successful generation and typechecks previously hid a valid calendar-date query being rejected.

**How to apply:** Exercise both valid filters and invalid boundary cases through HTTP. Do not rely solely on tests that pass already-converted JavaScript objects into a schema. Strict calendar-date validation must reject impossible days before any conversion that can roll them into the following month.
