# Cloudflare + Instagram setup

This repo now has Cloudflare Pages Functions for Instagram OAuth and analytics.

## What is already in the repo

- `functions/api/instagram/connect.js` starts Meta/Instagram OAuth.
- `functions/api/instagram/callback.js` receives the OAuth code and stores the token in Cloudflare KV.
- `functions/api/instagram/status.js` checks whether this browser is connected.
- `functions/api/instagram/insights.js` fetches the connected account profile, recent media, and daily insights.
- `functions/api/instagram/disconnect.js` removes the saved session.
- `wrangler.toml` declares the `INSTAGRAM_SESSIONS` KV binding.

## Cloudflare steps

1. Create or open the Cloudflare Pages project for `rabett-alt/nugget-workspace`.
2. Set build output to the repository root. No build command is required.
3. Create a KV namespace, for example `nugget-instagram-sessions`.
4. Bind that KV namespace to Pages Functions with the binding name:

```txt
INSTAGRAM_SESSIONS
```

5. Add these environment variables/secrets in Cloudflare Pages:

```txt
META_APP_ID
META_APP_SECRET
INSTAGRAM_REDIRECT_URI
INSTAGRAM_SCOPES
```

Recommended `INSTAGRAM_SCOPES`:

```txt
instagram_basic,instagram_manage_insights,pages_show_list,pages_read_engagement
```

`INSTAGRAM_REDIRECT_URI` must be the deployed callback URL:

```txt
https://YOUR_DOMAIN/api/instagram/callback
```

## Meta steps

1. Create a Meta Developer app.
2. Add Instagram/Facebook Login permissions for the app.
3. Add the same callback URL to valid OAuth redirect URIs.
4. Make sure the Instagram account is Business or Creator.
5. Make sure the Instagram professional account is linked to a Facebook Page.

## Test URLs

After Cloudflare deploys:

```txt
/api/instagram/connect
/api/instagram/status
/api/instagram/insights
/api/instagram/disconnect
```

Start by opening:

```txt
https://YOUR_DOMAIN/api/instagram/connect
```

After login succeeds, it redirects back to:

```txt
/preview.html#home
```
