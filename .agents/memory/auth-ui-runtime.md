---
name: Auth UI runtime validation
description: Why auth dependency upgrades and branded Clerk layouts need live browser checks.
---

Check authentication UI in a live browser after changing its dependencies; installed package versions, typechecks and production builds alone are insufficient.

**Why:** An auth dependency upgrade left previously optimized development dependencies using an older React DOM version, despite matching installed React packages and passing build checks.

**How to apply:** Include a fresh running-app check when upgrading authentication dependencies. If runtime versions disagree, inspect generated dependency resolution before changing valid application logic.

Use Clerk's supported appearance elements for component styling and responsive parent layouts rather than structural `.cl-*` CSS selectors.

**Why:** Clerk warned that its remotely delivered component structure can change independently and invalidate structural selectors. A centered grid's default minimum-content sizing also allowed the auth card to overflow a phone viewport.

**How to apply:** Keep layout constraints in the supported appearance API; make the enclosing grid track shrinkable and verify a phone-width sign-in screen.
