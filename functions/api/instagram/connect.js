import { cookie, getRedirectUri, json, randomId, redirect, requireConfig } from "./_utils.js";

export async function onRequestGet({ request, env }) {
  const missing = requireConfig(env).filter((item) => item !== "INSTAGRAM_SESSIONS KV binding");
  if (missing.length) {
    return json({ ok: false, error: "missing_config", missing }, { status: 500 });
  }

  const state = randomId(18);
  const redirectUri = getRedirectUri(request, env);
  const scope = env.INSTAGRAM_SCOPES || "instagram_basic,instagram_manage_insights,pages_show_list,pages_read_engagement";
  const authUrl = new URL("https://www.facebook.com/v20.0/dialog/oauth");
  authUrl.searchParams.set("client_id", env.META_APP_ID);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", scope);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("state", state);

  return redirect(authUrl.toString(), {
    headers: {
      "set-cookie": cookie("ig_oauth_state", state, 600),
    },
  });
}
