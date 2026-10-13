---
name: ALLPLAY membership scope
description: Confirmed paid-membership price, free features and access-control constraints.
---

Charge $1.99 USD monthly for the full player table for regular members, including stats, DraftKings salary values, forecasts and exports, and for owner-uploaded Game Takes documents and video clips. News and daily game slates remain free. The designated owner is exempt from the membership fee.

**Why:** The user chose this price and billing cycle, approved private owner access without a monthly payment, then clarified that player stats and DraftKings values must also be limited until payment. They chose “Paying members and me” as the audience for their own documents and game-script video clips.

**How to apply:** Do not turn the entire dashboard into a paid-only app or change the fee without approval. Whop is the purchase/access authority for regular members; the owner exception must remain operator-designated and server-verified. Keep all player rows out of unpaid API responses, not merely blurred or hidden by CSS.

Owner-uploaded content is not a public/community upload feature. Only server-designated owners may upload, edit or delete. Paying members can view files, but must not receive permanent public storage links or third-party document-viewer URLs.

**Why:** The user wants to share their own takes with paying members, not expose personal documents to everyone.

**How to apply:** Preserve membership checks on both the content listing and every file/range request. Store durable file bytes privately in App Storage and keep account identity binding on the server.
