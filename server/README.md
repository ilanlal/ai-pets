# AI Pets server

## Billing settings

The server reads `serverSettings/billing` in the default Firestore database:

- `trialTokens`: non-negative integer granted once per new member.
- `defaultCouponTokens`: positive integer granted by a coupon without its own `tokens` value.

Valid codes are document IDs in the `couponCodes` collection. Codes are
case-insensitive and restricted to letters, digits, underscores and hyphens.
To view or manage them, use the Firebase console with an authorized admin
account. Keep them private: anyone with a code can redeem it.

Each coupon can have `enabled`, `tokens`, `maxRedemptions` and
`redeemedCount` fields. A coupon is enabled by default, uses the current
default amount when `tokens` is absent, and has no global redemption limit
unless `maxRedemptions` is set. Each member can redeem a given code only once.
Changing the default does not alter past redemptions. Firestore Security Rules
must deny client access to these collections; the server uses the Admin SDK.

## Local startup

Copy `.env.example` to `.env` and set a server-side Gemini key and Firebase
Admin credentials. Do not commit credentials. Run `npm install` and
`npm start`. The Firestore billing document and coupon documents must be
created separately before processing membership or coupon requests.

The existing chat endpoint does not enforce a zero balance or serialize
concurrent requests. Do not expose it publicly until that is addressed.

## Administration and pets

The [admin web app](../admin/README.md) calls `/api/admin` routes, which require
a Firebase ID token with the boolean `admin` custom claim. Trusted operators
can grant the claim with `node scripts/grant-admin.js <firebase-user-uid>`.
Balance changes, trial changes and admin pet changes are recorded in
`adminAudit`. Balance updates accept a UUID request ID so an identical retry
does not apply the adjustment twice.

Member pets are stored under `users/{uid}/pets`. On first sign-in the client
imports its local pet only if no server pets exist; admins can create additional
pets. Pet actions and stat updates use Firestore transactions, with the last
completed update winning. Firestore client rules should remain deny-all; all
access goes through authenticated server routes.
