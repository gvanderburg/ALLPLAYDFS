---
name: Whop membership bridge
description: Secure external-app purchase binding and compatibility pitfalls discovered during membership setup.
---

Bind Whop purchases only through server-created checkouts owned by a verified ALLPLAY account, then verify provider payment and membership identity/product/access. Email equality, redirects and client-supplied receipt IDs are not proof.

**Why:** ALLPLAY is an external installed web app, not a Whop iframe with a verified Whop user token. Checkout may use a different email from ALLPLAY sign-in.

**How to apply:** Keep the purchase binding across devices through the same ALLPLAY account. Never restore access by unauthenticated email or by accepting arbitrary checkout IDs.

Whop SDK major releases changed exports, parameter names and response shapes; the classic SDK supports the filtered-checkout payment workflow in the integration instructions, whereas newer Fern-generated releases use a different contract.

**Why:** Installing the latest SDK did not match the integration's canonical client or filtered-payment API. Successful compilation alone cannot confirm the provider payload and cancellation semantics.

**How to apply:** Before upgrading, inspect the installed SDK and real provider responses. Preserve exact payment-to-checkout identity checks and period-end cancellation; test the wire payload. Both ALLPLAY data and membership client caches must be isolated by auth identity.

A recurring Whop plan's initial price is added to its first recurring charge. ALLPLAY's $1.99/month fee must have no additional signup charge.

**Why:** The verified plan reports $1.99 due initially only when the initial add-on fee is zero and renewal fee is $1.99.

**How to apply:** Check the provider's initial amount due as well as renewal price when changing plans. Applicable tax is separate and should be disclosed.
