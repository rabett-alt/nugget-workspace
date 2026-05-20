import { getStoredSession, json } from "./_utils.js";

export async function onRequestGet({ request, env }) {
  const session = await getStoredSession(request, env);
  if (!session) {
    return json({ connected: false });
  }

  return json({
    connected: true,
    account: session.account || null,
    connectedAt: session.connectedAt || null,
  });
}
