---
name: Owner-gated browser test identities
description: Match temporary test-owner approval to the actual verified Clerk identity and restore configuration after verification.
---

For owner-gated browser verification, approve the actual synthetic account ID from its verified Clerk session, not an assumed ID from requested login-claim overrides.

**Why:** The testing harness may create a different Clerk subject than a requested `sub` override. Its browser notebook can also reset during long calls, destroying the only record of the synthetic identity and preventing reliable sign-in recovery.

**How to apply:** Preserve the synthetic account's actual ID and throwaway email only in temporary test storage outside the project; never store tokens, cookies, credentials or real-user identifiers in memory. Keep individual browser evaluations short. Preserve the existing owner allowlist, use temporary test approval only for verification, and restore the original configuration before presenting or suggesting publication. A harness reset is not evidence of an application failure.
