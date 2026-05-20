import { clearCookie, cookie, getRedirectUri, json, parseCookies, randomId, redirect, requireConfig } from "./_utils.js";

const GRAPH_BASE = "https://graph.facebook.com/v20.0";
const SESSION_MAX_AGE = 60 * 60 * 24 * 55;

async function graphGet(path, params) {
  const url = new URL(`${GRAPH_BASE}${path}`);
  Object.entries(params || {}).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url.toString());
  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(data.error?.message || "Instagram API request failed");
  }
  return data;
}

export async function onRequestGet({ request, env }) {
  const missing = requireConfig(env);
  if (missing.length) {
    return json({ ok: false, error: "missing_config", missing }, { status: 500 });
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookies = parseCookies(request);

  if (!code) {
    return json({ ok: false, error: "missing_code" }, { status: 400 });
  }
  if (!state || state !== cookies.ig_oauth_state) {
    return json({ ok: false, error: "invalid_state" }, { status: 400 });
  }

  try {
    const redirectUri = getRedirectUri(request, env);
    const token = await graphGet("/oauth/access_token", {
      client_id: env.META_APP_ID,
      client_secret: env.META_APP_SECRET,
      redirect_uri: redirectUri,
      code,
    });

    const longToken = await graphGet("/oauth/access_token", {
      grant_type: "fb_exchange_token",
      client_id: env.META_APP_ID,
      client_secret: env.META_APP_SECRET,
      fb_exchange_token: token.access_token,
    }).catch(() => token);

    const userToken = longToken.access_token || token.access_token;
    const pages = await graphGet("/me/accounts", {
      access_token: userToken,
      fields: "id,name,access_token,instagram_business_account{id,username,profile_picture_url,followers_count,media_count}",
      limit: "25",
    });

    const page = (pages.data || []).find((item) => item.instagram_business_account);
    if (!page) {
      return json({ ok: false, error: "no_instagram_business_account", message: "No Facebook Page with a linked Instagram professional account was found." }, { status: 400 });
    }

    const ig = page.instagram_business_account;
    const sessionId = randomId(32);
    await env.INSTAGRAM_SESSIONS.put(
      `session:${sessionId}`,
      JSON.stringify({
        pageId: page.id,
        pageName: page.name,
        pageAccessToken: page.access_token,
        userAccessToken: userToken,
        account: {
          id: ig.id,
          username: ig.username,
          profilePictureUrl: ig.profile_picture_url,
          followersCount: ig.followers_count,
          mediaCount: ig.media_count,
        },
        connectedAt: new Date().toISOString(),
      }),
      { expirationTtl: SESSION_MAX_AGE }
    );

    return redirect("/preview.html#home", {
      headers: {
        "set-cookie": [
          cookie("ig_session", sessionId, SESSION_MAX_AGE),
          clearCookie("ig_oauth_state"),
        ].join(", "),
      },
    });
  } catch (error) {
    return json({ ok: false, error: "instagram_callback_failed", message: error.message }, { status: 500 });
  }
}
