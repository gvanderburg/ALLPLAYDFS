---
name: ALLPLAY push-key stability
description: Stability requirements for the ALLPLAY Web Push signing key.
---

Keep the Web Push VAPID key deterministic and stable per environment. Do not generate a new pair on process startup or deployment.

**Why:** Browsers bind saved push subscriptions to the VAPID public key. Changing the derivation inputs invalidates every saved device subscription; the current design avoids storing a separate private key.

**How to apply:** Preserve the derivation context across releases. If `SESSION_SECRET` must change, plan for the owner to re-enable alerts on each device.
