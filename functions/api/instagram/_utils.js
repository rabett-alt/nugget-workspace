export function json(data, init = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(init.headers || {}),
    },
  });
}

export function redirect(location, init = {}) {
  return new Response(null, {
    status: init.status || 302,
    headers: {
      location,
      "cache-control": "no-store",
      ...(init.headers || {}),
    },
  });
}

export function parseCookies(request) {
  const header = request.headers.get("cookie") || "";
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return index === -1
          ? [part, ""]
          : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

export function cookie(name, value, maxAgeSeconds) {
  const attrs = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ];
  if (maxAgeSeconds) attrs.push(`Max-Age=${maxAgeSeconds}`);
  return attrs.join("; ");
}

export function clearCookie(name) {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function randomId(bytes = 24) {
  const array = new Uint8Array(bytes);
  crypto.getRandomValues(array);
  return [...array].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export function getRedirectUri(request, env) {
  return env.INSTAGRAM_REDIRECT_URI || new URL("/api/instagram/callback", request.url).toString();
}

export function requireConfig(env) {
  const missing = [];
  if (!env.META_APP_ID) missing.push("META_APP_ID");
  if (!env.META_APP_SECRET) missing.push("META_APP_SECRET");
  if (!env.INSTAGRAM_SESSIONS) missing.push("INSTAGRAM_SESSIONS KV binding");
  return missing;
}

export async function getStoredSession(request, env) {
  const cookies = parseCookies(request);
  const sessionId = cookies.ig_session;
  if (!sessionId || !env.INSTAGRAM_SESSIONS) return null;
  const value = await env.INSTAGRAM_SESSIONS.get(`session:${sessionId}`, "json");
  return value ? { id: sessionId, ...value } : null;
}
