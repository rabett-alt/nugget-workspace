import { clearCookie, getStoredSession, json, parseCookies, redirect } from "./_utils.js";

export async function onRequestPost({ request, env }) {
  const session = await getStoredSession(request, env);
  if (session && env.INSTAGRAM_SESSIONS) {
    await env.INSTAGRAM_SESSIONS.delete(`session:${session.id}`);
  }
  return json({ ok: true }, { headers: { "set-cookie": clearCookie("ig_session") } });
}

export async function onRequestGet({ request, env }) {
  const session = await getStoredSession(request, env);
  if (session && env.INSTAGRAM_SESSIONS) {
    await env.INSTAGRAM_SESSIONS.delete(`session:${session.id}`);
  }
  return redirect("/preview.html#home", { headers: { "set-cookie": clearCookie("ig_session") } });
}
