---
name: Workflow handoff state
description: Handling workflow-state changes around artifact and task handoffs
---

A successful preview check does not guarantee the managed services remain running through a later handoff.

**Why:** In this workspace, both web and API workflow states were reported as not started around an artifact/follow-up handoff after browser and HTTP checks had passed. Current workflow status independently confirmed the state change; no code crash appeared in the logs. The cause was not determined.

**How to apply:** When a fresh workflow-state update contradicts earlier successful checks, confirm the current service state before diagnosing app code. Restart affected services if needed; do not repeatedly recheck unchanged code.
