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
const GITHUB_OIDC_ISSUER = 'https://token.actions.githubusercontent.com';
const GITHUB_OIDC_AUDIENCE = 'https://admissiontracker.site';
const GITHUB_REPOSITORY = 'abednewaz/Admission-Date-Tracker';
const GITHUB_WORKFLOW_PATH = '.github/workflows/daily-admission-reminders.yml';
const josePromise = import('jose');
const githubJwksPromise = josePromise.then(({ createRemoteJWKSet }) =>
  createRemoteJWKSet(new URL(GITHUB_OIDC_ISSUER + '/.well-known/jwks'))
);

function json(res, status, body) {
  res.status(status).json(body);
}

async function verifyGitHubOidcToken(token) {
  try {
    const { jwtVerify } = await josePromise;
    const githubJwks = await githubJwksPromise;
    const { payload } = await jwtVerify(token, githubJwks, {
      issuer: GITHUB_OIDC_ISSUER,
      audience: GITHUB_OIDC_AUDIENCE
    });

    if (payload.repository !== GITHUB_REPOSITORY) return false;
    if (payload.ref !== 'refs/heads/main') return false;
    if (payload.event_name !== 'schedule' && payload.event_name !== 'workflow_dispatch' && payload.event_name !== 'push') return false;

    const workflowRef = payload.workflow_ref || payload.job_workflow_ref || '';
    const expectedWorkflowSuffix = GITHUB_WORKFLOW_PATH + '@refs/heads/main';
    if (!String(workflowRef).endsWith(expectedWorkflowSuffix)) return false;

    return true;
  } catch {
    return false;
  }
}

async function isAuthorized(req) {
  const authorization = req.headers.authorization || '';
  if (BROADCAST_SECRET && authorization === 'Bearer ' + BROADCAST_SECRET) return true;

  const prefix = 'Bearer ';
  if (!authorization.startsWith(prefix)) return false;
  return verifyGitHubOidcToken(authorization.slice(prefix.length));
}

function dateOnlyInDhaka() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

function parseDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
  const [y, m, d] = String(value).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function daysBetween(from, to) {
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

function chooseNextExam(exams, universityName, today) {
  const rows = exams
    .filter((e) =>
      e &&
      e.universityName === universityName &&
      e.examDate &&
      e.examDate !== 'Not published yet' &&
      e.examDate !== 'Better check Yourself'
    )
    .map((e) => ({ e, date: parseDate(e.examDate) }))
    .filter((x) => x.date && x.date.getTime() >= today.getTime())
    .sort((a, b) => a.date - b.date);

  return rows[0] || null;
}

function formatDate(dt) {
  return dt.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  if (!(await isAuthorized(req))) {
    return json(res, 401, { error: 'Unauthorized' });
  }
  if (!SUPABASE_URL || !SUPABASE_KEY || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return json(res, 500, { error: 'Push environment variables are missing' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const exams = Array.isArray(body?.exams) ? body.exams : [];
    if (!exams.length) return json(res, 400, { error: 'Exam data is required' });

    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:the.abednewaz@gmail.com',
      VAPID_PUBLIC_KEY,
      VAPID_PRIVATE_KEY
    );

    const today = parseDate(dateOnlyInDhaka());
    const base = SUPABASE_URL.replace(/\/$/, '');
    const listResponse = await fetch(base + '/rest/v1/push_subscriptions?select=id,endpoint,subscription', {
      headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY }
    });
    if (!listResponse.ok) return json(res, 502, { error: 'Could not load subscriptions' });

    const subscriptions = await listResponse.json();
    let sent = 0;
    let removed = 0;
    let skipped = 0;

    for (const row of subscriptions) {
      const stored = row.subscription || {};
      const pushSubscription = {
        endpoint: stored.endpoint || row.endpoint,
        keys: stored.keys
      };

      if (!pushSubscription.endpoint || !pushSubscription.keys?.p256dh || !pushSubscription.keys?.auth) {
        skipped++;
        continue;
      }

      const marked = Array.isArray(stored.markedUniversities)
        ? [...new Set(stored.markedUniversities.filter((x) => typeof x === 'string'))]
        : [];

      let notifications = [];

      if (!marked.length) {
        notifications.push({
          title: 'Admission Tracker',
          body: 'You haven’t marked any universities yet. Mark one to track it every day.',
          tag: 'daily-mark-reminder'
        });
      } else {
        for (const universityName of marked) {
          const next = chooseNextExam(exams, universityName, today);
          if (!next) continue;

          const days = daysBetween(today, next.date);
          let bodyText;
          if (days === 0) {
            bodyText = universityName + ': Your next admission exam is today (' + (next.e.unit || 'exam') + ').';
          } else if (days === 1) {
            bodyText = universityName + ': Your next admission exam is tomorrow (' + (next.e.unit || 'exam') + ').';
          } else {
            bodyText = universityName + ': Your next admission exam is in ' + days + ' days (' + (next.e.unit || 'exam') + ', ' + formatDate(next.date) + ').';
          }

          notifications.push({
            title: 'Admission Tracker',
            body: bodyText,
            tag: 'daily-exam-' + String(next.e.id || universityName).slice(0, 100)
          });
        }

        if (!notifications.length) {
          notifications.push({
            title: 'Admission Tracker',
            body: 'Your marked universities do not have a published upcoming exam date yet.',
            tag: 'daily-no-published-exam'
          });
        }
      }

      for (const notification of notifications) {
        try {
          await webpush.sendNotification(
            pushSubscription,
            JSON.stringify({
              title: notification.title,
              body: notification.body,
              url: './',
              tag: notification.tag
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
            break;
          }
        }
      }
    }

    return json(res, 200, {
      ok: true,
      date: dateOnlyInDhaka(),
      subscribers: subscriptions.length,
      sent,
      removed,
      skipped
    });
  } catch (error) {
    console.error('Daily push failed', error);
    return json(res, 500, { error: 'Daily push failed' });
  }
}
