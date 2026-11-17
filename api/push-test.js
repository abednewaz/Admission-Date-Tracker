import webpush from 'web-push';

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:the.abednewaz@gmail.com';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return res.status(500).json({ error: 'Push keys are not configured' });
  }

  const subscription = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return res.status(400).json({ error: 'Invalid push subscription' });
  }

  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    await webpush.sendNotification(
      { endpoint: subscription.endpoint, keys: subscription.keys },
      JSON.stringify({
        title: 'Admission Tracker — Test',
        body: 'Just checking if you were ok ☺️.',
        url: './',
        tag: 'admission-tracker-test'
      }),
      { TTL: 300 }
    );
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Push test failed', error);
    return res.status(error?.statusCode === 410 ? 410 : 502).json({ error: 'Could not send test notification' });
  }
}
