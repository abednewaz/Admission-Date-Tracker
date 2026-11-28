const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT = 10;
const rateStore = globalThis.__adtPushRateStore || (globalThis.__adtPushRateStore = new Map());

function requestIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  return String(forwarded || req.headers['x-real-ip'] || 'unknown').split(',')[0].trim().slice(0, 80);
}

function allowRequest(req) {
  const key = requestIp(req);
  const now = Date.now();
  const recent = (rateStore.get(key) || []).filter((ts) => now - ts < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) return false;
  recent.push(now);
  rateStore.set(key, recent);
  if (rateStore.size > 2000) {
    for (const [ip, timestamps] of rateStore) {
      if (!timestamps.some((ts) => now - ts < RATE_WINDOW_MS)) rateStore.delete(ip);
    }
  }
  return true;
}

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
  if (!allowRequest(req)) return json(res, 429, { error: 'Too many subscription requests. Please try again later.' });
  if (!SUPABASE_URL || !SUPABASE_KEY) return json(res, 500, { error: 'Supabase environment variables are missing' });

  try {
    const subscription = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!subscription || !subscription.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
      return json(res, 400, { error: 'Invalid push subscription' });
    }

    const markedUniversities = Array.isArray(subscription.markedUniversities)
      ? subscription.markedUniversities.filter((x) => typeof x === 'string').slice(0, 100)
      : [];
    const storedSubscription = { ...subscription, markedUniversities, isAppInstalled: subscription.isAppInstalled === true };

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
