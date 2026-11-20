# AI Pets

The React/Vite client uses Firebase Google sign-in and the AI Pets server for
membership, coupon redemption, token balance, and Gemini chat. Pet state remains
in the browser's local storage.

## Setup

1. In Firebase project `ai-pets-db01`, register a web app, enable Google
   under Authentication > Sign-in method, and add your client hostname (for
   example `localhost`) under Authentication > Settings > Authorized domains.
2. Copy `.env.example` to `.env.local` and fill in the web app's Firebase API
   key and app ID from its Firebase SDK configuration. Set the auth domain and
   project ID to match the same web app. `VITE_API_URL` points to the server.
   These `VITE_` values are public browser configuration; never put service
   account credentials, Gemini API keys, or coupon secrets in them.
3. Configure and run the sibling `ai-pets-server`. Its
   `ALLOWED_ORIGINS` must include the exact client origin, including port.
4. Run `npm install` and `npm run dev`. Sign in with Google to register or
   restore membership; the server grants the initial trial on first registration.

The client sends a Firebase ID token as a bearer token to `POST /api/events`
and `POST /api/chat`. It displays the balance returned by the server, and offers
coupon redemption. Gemini requests no longer use a browser-supplied key.

On first sign-in, the browser's local pet is imported if the account has no
server pets. Members can select and interact with their server pets; admins
create additional pets using the [admin console](../admin/README.md). Pet data
is refreshed periodically, and the last completed server update wins. Guest
pet data remains local to the browser.

**Important:** The current server does not reject chat calls from users with
zero balance and does not serialize concurrent chats. Disabling the chat button
in the client is not an enforcement mechanism. Do not expose the server
publicly until server-side balance enforcement and concurrency are addressed.
