const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET || process.env.SUPABASE_SECRET_KEY_2;

async function supabaseRequest(path, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Supabase environment variables are missing.');
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) {}
  if (!res.ok) {
    const err = new Error((data && data.message) || text || 'Supabase request failed');
    err.status = res.status;
    throw err;
  }
  return data;
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const data = await supabaseRequest(
        'experience_reviews?select=id,rating,review,name,created_at&order=created_at.desc&limit=30'
      );
      return res.status(200).json(data || []);
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const rating = Number(body.rating);
      const review = String(body.review || '').trim();
      const name = String(body.name || 'Anonymous').trim() || 'Anonymous';

      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        return res.status(400).json({ error: 'Please select a rating from 1 to 5.' });
      }
      if (review.length < 3 || review.length > 500) {
        return res.status(400).json({ error: 'Review must be between 3 and 500 characters.' });
      }
      if (name.length > 50) {
        return res.status(400).json({ error: 'Name must be 50 characters or fewer.' });
      }

      const data = await supabaseRequest('experience_reviews', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ rating, review, name })
      });
      return res.status(201).json(Array.isArray(data) ? data[0] : data);
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  } catch (error) {
    console.error('Reviews API error:', error);
    return res.status(500).json({ error: 'Could not process the review right now.' });
  }
}