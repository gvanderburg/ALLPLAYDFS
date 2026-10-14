# ALLPLAY on Vercel

## Hosting boundary

Vercel serves the frontend. The existing Replit production deployment continues
to provide `/api`, including the Clerk proxy, memberships, projections, uploads,
feedback, notifications, and background NASCAR monitoring.

Keep the Replit backend published. This is not a database or authentication
migration, and no domain registration transfer is required.

## Import the project

1. Commit and push the latest project files, including `vercel.json`, to GitHub.
   Earlier Git pushes from this workspace failed authentication; do not assume
   the remote repository already contains these files.
2. In Vercel, select **Add New → Project** and import the ALLPLAY GitHub repository.
3. Leave **Root Directory** at the repository root, not `artifacts/dfs-dashboard`.
   The project uses shared pnpm workspace packages.
4. Select **Vite**. The root `vercel.json` supplies the install command, build
   command, output directory, and routing.
5. Deploy to a generated Vercel URL first. Do not change DNS yet.

The build command supplies `BASE_PATH=/`, `PORT=3000`, and
`VITE_CLERK_PROXY_URL=/api/__clerk` only for the Vercel frontend build.
Never put backend secrets, database credentials, or a Clerk secret key into a
`VITE_*` variable or frontend source file.

## Verify before changing DNS

Run this from the repository root with the actual generated Vercel URL:

```sh
node scripts/verify-vercel.mjs https://YOUR-DEPLOYMENT.vercel.app
```

The script checks page routes, built assets, and anonymous backend access.
It does **not** prove authenticated flows work. Also verify:

- Sign in using an existing account, reload, and confirm the session persists.
- Owner access stays unlocked; a free account cannot read paid player data.
- A paying account can read projections and Game Takes.
- Feedback and authorized uploads still work.
- Phone notifications and checkout return URLs use the intended domain.

Authentication uses Replit-managed Clerk. External hosting does not automatically
provision a new authorized Clerk domain. If the generated Vercel hostname reports
an authentication/domain error, resolve the existing tenant's domain/proxy setup
before switching traffic; do not create a replacement tenant or weaken the paywall.
Retain the existing allplaydfs.com registration with the auth provider while
changing website hosting.

API forwarding uses the verified Replit production subdomain rather than
allplaydfs.com, to avoid forwarding back to Vercel after the DNS switch.
If that backend deployment URL changes, update the API rewrite explicitly.
No membership or authentication responses should be cached at Vercel.

## Connect allplaydfs.com

After the deployment and authenticated flows pass:

1. Add `allplaydfs.com` and `www.allplaydfs.com` in Vercel **Settings → Domains**.
2. Keep the domain registered through Replit. In its DNS management, replace
   only the conflicting website records with the exact values Vercel displays.
   Preserve email records and unrelated verification records.
3. Select the canonical hostname and configure the other hostname to redirect.
4. Wait for Vercel to verify DNS and issue HTTPS, then repeat the checks using
   the custom domain. Leave the old hosting available until the switch is verified.

No EPP/authorization code is needed for this hosting-only change.
