import { getStoredSession, json } from "./_utils.js";

const GRAPH_BASE = "https://graph.facebook.com/v20.0";

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
  const session = await getStoredSession(request, env);
  if (!session) {
    return json({ connected: false, error: "not_connected" }, { status: 401 });
  }

  try {
    const accessToken = session.pageAccessToken || session.userAccessToken;
    const account = await graphGet(`/${session.account.id}`, {
      access_token: accessToken,
      fields: "id,username,profile_picture_url,followers_count,media_count",
    });

    const media = await graphGet(`/${session.account.id}/media`, {
      access_token: accessToken,
      fields: "id,caption,media_type,media_url,permalink,thumbnail_url,timestamp,like_count,comments_count",
      limit: "12",
    });

    let dailyInsights = null;
    try {
      dailyInsights = await graphGet(`/${session.account.id}/insights`, {
        access_token: accessToken,
        metric: "impressions,reach,profile_views,follower_count",
        period: "day",
      });
    } catch (error) {
      dailyInsights = { unavailable: true, message: error.message };
    }

    return json({
      connected: true,
      account,
      media: media.data || [],
      insights: dailyInsights,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    return json({ connected: true, error: "instagram_fetch_failed", message: error.message }, { status: 500 });
  }
}
