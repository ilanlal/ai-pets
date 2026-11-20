# AI Pets Admin Web Access

The React admin console manages the existing AI Pets server. It supports:

- Google sign-in for Firebase users with the `admin: true` custom claim.
- Server health, paginated member accounts and token balances.
- Adding or subtracting tokens with a required reason and audit record.
- Viewing the billing configuration and changing the initial trial tokens.
- Viewing a member's pets, creating pets and editing hunger, happiness and energy.

The health endpoint is a liveness check, not a Firestore or Gemini readiness
check. Balance adjustments and administrative changes are recorded in the
server's `adminAudit` collection; this version does not provide a log viewer,
reports, subscription/permission management, pet deletion or maintenance tools.

## Local setup

1. Configure and run the [server](../server/README.md). Add the admin web
   origin `http://localhost:5174` to its `ALLOWED_ORIGINS` alongside the client
   origin, then restart it.
2. Copy `.env.example` to `.env.local` in this directory. Fill in the Firebase
   web app configuration from project settings and the server's `VITE_API_URL`.
   Firebase web configuration is public; do not put service-account keys,
   Gemini keys or coupon codes in `VITE_` variables.
3. Enable Google sign-in and authorize `localhost` under Firebase
   Authentication settings. An existing user can be granted access by a
   trusted operator with server Admin SDK credentials:

   ```powershell
   Set-Location ..\server
   node .\scripts\grant-admin.js YOUR_FIREBASE_USER_UID
   ```

   Sign out and back in after a claim change. The server verifies ID tokens,
   checks revocation and requires the claim for every `/api/admin` route.
   Never grant admin privileges based on a client-supplied value.
4. In this directory run `npm install` and `npm run dev`, then open
   `http://localhost:5174`.

## Pets

When a member first signs in, their browser's local pet is imported only if
their server account has no pets. The migration is recorded per account and
does not replace existing server pets. Admins create additional pets; members
select and interact with them in the client. The client refreshes server pets
periodically; the last completed update wins. Existing local guest pets remain
in the browser. Firestore is accessed only through the server Admin SDK;
client Firestore rules must continue to deny access to server-owned data.

The current chat endpoint does not enforce token balances or serialize
concurrent requests. Do not expose it publicly until that is addressed.
