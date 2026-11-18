import webpush from 'web-push';

const TOKEN = 'ADT-HC-2026-11-18-BROADCAST-7F4K9M2Q';
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET || process.env.SUPABASE_SECRET_KEY_2;
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;

export default async function handler(req, res) {
  if (req.method !== 'GET' || req.query?.token !== TOKEN) return res.status(404).json({ error: 'Not found' });
  if (!SUPABASE_URL || !SUPABASE_KEY || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return res.status(500).json({ error: 'Push environment variables are missing' });

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:the.abednewaz@gmail.com',
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );

  const base = SUPABASE_URL.replace(/\/$/, '');
  const listResponse = await fetch(base + '/rest/v1/push_subscriptions?select=id,endpoint,subscription', {
    headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY }
  });
  if (!listResponse.ok) return res.status(502).json({ error: 'Could not load subscriptions' });

  const subscriptions = await listResponse.json();
  let sent = 0, removed = 0;
  for (const row of subscriptions) {
    try {
      const stored = row.subscription || {};
      const pushSubscription = { endpoint: stored.endpoint || row.endpoint, keys: stored.keys };
      if (!pushSubscription.endpoint || !pushSubscription.keys?.p256dh || !pushSubscription.keys?.auth) continue;
      await webpush.sendNotification(
        pushSubscription,
        JSON.stringify({
          title: 'Important Admission Update',
          body: 'High Court suspends public university and medical admission tests until 31 December.',
          url: 'https://www.admissiontracker.site/?notice=hc-admission-suspension',
          tag: 'hc-admission-suspension-2026-11-18'
        }),
        { TTL: 86400 }
      );
      sent++;
    } catch (error) {
      if (error?.statusCode === 404 || error?.statusCode === 410) {
        await fetch(base + '/rest/v1/push_subscriptions?id=eq.' + encodeURIComponent(row.id), {
          method: 'DELETE',
          headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY }
        });
        removed++;
      }
    }
  }
  return res.status(200).json({ ok: true, sent, removed });
}
