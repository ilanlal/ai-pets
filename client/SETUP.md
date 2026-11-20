# Setup

1. In Firebase project

- Under Authentication > Sign-in method, register a web app, enable Google
- Under Authentication > Settings > Authorized domains, add your client hostname (for example `localhost`).

1. Copy `.env.example` to `.env.local` and fill in the web app's Firebase API
   key and app ID from its Firebase SDK configuration.

- Set the auth domain and project ID to match the same web app.
  > Note: `VITE_API_URL` points to the server. These `VITE_` values are public browser configuration; never put service account credentials, Gemini API keys, or coupon secrets in them!

1. Configure and run the sibling `ai-pets-server`. Its
   `ALLOWED_ORIGINS` must include the exact client origin, including port.
2. Run `npm install` and `npm run dev`. Sign in with Google to register or
   restore membership; the server grants the initial trial on first registration.

The client sends a Firebase ID token as a bearer token to `POST /api/events`
and `POST /api/chat`. It displays the balance returned by the server, and offers
coupon redemption. Gemini requests no longer use a browser-supplied key.
