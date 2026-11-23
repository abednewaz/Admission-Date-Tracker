import webpush from 'web-push';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SECRET ||
  process.env.SUPABASE_SECRET_KEY_2;
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;

const GITHUB_OIDC_ISSUER = 'https://token.actions.githubusercontent.com';
const GITHUB_OIDC_AUDIENCE = 'https://admissiontracker.site';
const GITHUB_REPOSITORY = 'abednewaz/Admission-Date-Tracker';
const GITHUB_WORKFLOW_PATHS = new Set([
  '.github/workflows/notice-check.yml',
  '.github/workflows/admission-date-check.yml'
]);

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
    const matchesWorkflow = [...GITHUB_WORKFLOW_PATHS].some((path) =>
      String(workflowRef).endsWith(path + '@refs/heads/main')
    );
    if (!matchesWorkflow) return false;

    return true;
  } catch {
    return false;
  }
}

async function isAuthorized(req) {
  const authorization = req.headers.authorization || '';
  const prefix = 'Bearer ';
  if (!authorization.startsWith(prefix)) return false;
  return verifyGitHubOidcToken(authorization.slice(prefix.length));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  if (!(await isAuthorized(req))) return json(res, 401, { error: 'Unauthorized' });
  if (!SUPABASE_URL || !SUPABASE_KEY || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return json(res, 500, { error: 'Push environment variables are missing' });
  }

  try {
    const notice = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!notice?.title) return json(res, 400, { error: 'Notice title is required' });

    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:the.abednewaz@gmail.com',
      VAPID_PUBLIC_KEY,
      VAPID_PRIVATE_KEY
    );

    const base = SUPABASE_URL.replace(/\/$/, '');
    const listResponse = await fetch(base + '/rest/v1/push_subscriptions?select=id,endpoint,subscription', {
      headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY }
    });
    if (!listResponse.ok) return json(res, 502, { error: 'Could not load subscriptions' });

    const subscriptions = await listResponse.json();
    let sent = 0;
    let removed = 0;

    for (const row of subscriptions) {
      try {
        const stored = row.subscription || {};
        const pushSubscription = { endpoint: stored.endpoint || row.endpoint, keys: stored.keys };
        if (!pushSubscription.endpoint || !pushSubscription.keys?.p256dh || !pushSubscription.keys?.auth) continue;

        await webpush.sendNotification(
          pushSubscription,
          JSON.stringify({
            title: 'New Admission Notice',
            body: (notice.university ? notice.university + ': ' : '') + notice.title,
            url: notice.url || './',
            tag: 'notice-' + String(notice.url || notice.title).slice(0, 120)
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

    return json(res, 200, { ok: true, sent, removed });
  } catch (error) {
    console.error('Broadcast failed', error);
    return json(res, 500, { error: 'Broadcast failed' });
  }
}
