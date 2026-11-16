const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SECRET ||
  process.env.SUPABASE_SECRET_KEY_2;

function json(res, status, body) {
  res.status(status).json(body);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  if (!SUPABASE_URL || !SUPABASE_KEY) return json(res, 500, { error: 'Supabase environment variables are missing' });

  try {
    const subscription = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!subscription || !subscription.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
      return json(res, 400, { error: 'Invalid push subscription' });
    }

    const markedUniversities = Array.isArray(subscription.markedUniversities)
      ? subscription.markedUniversities.filter((x) => typeof x === 'string').slice(0, 100)
      : [];
    const storedSubscription = { ...subscription, markedUniversities };

    const response = await fetch(SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/push_subscriptions', {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: 'Bearer ' + SUPABASE_KEY,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify([{ endpoint: subscription.endpoint, subscription: storedSubscription }])
    });

    if (!response.ok) {
      const detail = await response.text();
      return json(res, 502, { error: 'Could not save subscription', detail });
    }
    return json(res, 200, { ok: true });
  } catch (error) {
    return json(res, 500, { error: 'Subscription failed' });
  }
}
