import webpush from 'web-push';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SECRET ||
  process.env.SUPABASE_SECRET_KEY_2;
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const BROADCAST_SECRET = process.env.PUSH_BROADCAST_SECRET;

function json(res, status, body) {
  res.status(status).json(body);
}

function dhakaToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return get('year') + '-' + get('month') + '-' + get('day');
}

function daysUntil(today, dateText) {
  const a = new Date(today + 'T00:00:00Z');
  const b = new Date(dateText + 'T00:00:00Z');
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.round((b - a) / 86400000);
}

async function loadExams() {
  const response = await fetch('https://admissiontracker.site/data.js?daily=' + Date.now(), {
    cache: 'no-store',
    headers: { 'User-Agent': 'Admission-Date-Tracker-Daily-Reminder/1.0' }
  });
  if (!response.ok) throw new Error('Could not load admission data');
  const text = await response.text();
  const match = text.match(/window\.ADMISSION_EXAMS\s*=\s*(\[.*\])\s*;?\s*$/s);
  if (!match) throw new Error('Could not parse admission data');
  return JSON.parse(match[1]);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  if (!BROADCAST_SECRET || req.headers.authorization !== 'Bearer ' + BROADCAST_SECRET) {
    return json(res, 401, { error: 'Unauthorized' });
  }
  if (!SUPABASE_URL || !SUPABASE_KEY || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return json(res, 500, { error: 'Push environment variables are missing' });
  }

  try {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:the.abednewaz@gmail.com',
      VAPID_PUBLIC_KEY,
      VAPID_PRIVATE_KEY
    );

    const exams = await loadExams();
    const today = dhakaToday();
    const base = SUPABASE_URL.replace(/\/$/, '');
    const listResponse = await fetch(
      base + '/rest/v1/push_subscriptions?select=id,endpoint,subscription',
      { headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY } }
    );
    if (!listResponse.ok) return json(res, 502, { error: 'Could not load subscriptions' });

    const subscriptions = await listResponse.json();
    let sent = 0;
    let removed = 0;

    for (const row of subscriptions) {
      const stored = row.subscription || {};
      const marked = Array.isArray(stored.markedUniversities)
        ? stored.markedUniversities
        : [];

      const candidates = exams
        .filter((e) =>
          marked.includes(e.universityName) &&
          /^\d{4}-\d{2}-\d{2}$/.test(String(e.examDate || ''))
        )
        .map((e) => ({ e, days: daysUntil(today, e.examDate) }))
        .filter((x) => x.days !== null && x.days >= 0)
        .sort((a, b) => a.days - b.days);

      let title = 'Admission Tracker';
      let body;

      if (candidates.length) {
        const { e, days } = candidates[0];
        if (days === 0) {
          body = 'Your ' + e.universityName + ' — ' + e.unit + ' Exam is today. Best of luck on your journey.';
        } else {
          body = 'You have ' + days + (days === 1 ? ' day' : ' days') + ' left for ' +
            e.universityName + ' — ' + e.unit + ' Exam. Best of luck on your journey.';
        }
        title = 'Your next admission exam';
      } else {
        body = 'Keep going — every day of preparation brings you closer to your goal. Best of luck on your journey.';
        title = 'A little reminder from Admission Tracker';
      }

      const pushSubscription = {
        endpoint: stored.endpoint || row.endpoint,
        keys: stored.keys
      };
      if (!pushSubscription.endpoint || !pushSubscription.keys?.p256dh || !pushSubscription.keys?.auth) continue;

      try {
        await webpush.sendNotification(
          pushSubscription,
          JSON.stringify({
            title,
            body,
            url: './',
            tag: 'daily-reminder-' + today
          }),
          { TTL: 86400 }
        );
        sent++;
      } catch (error) {
        const status = error?.statusCode;
        if (status === 404 || status === 410) {
          await fetch(base + '/rest/v1/push_subscriptions?id=eq.' + encodeURIComponent(row.id), {
            method: 'DELETE',
            headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY }
          });
          removed++;
        }
      }
    }

    return json(res, 200, { ok: true, sent, removed, date: today });
  } catch (error) {
    console.error(error);
    return json(res, 500, { error: 'Daily reminder failed' });
  }
}
