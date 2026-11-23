const RATE_WINDOW_MS = 5 * 60 * 1000;
const RATE_LIMIT = 20;
const store = globalThis.__adtBoardResultRateStore || (globalThis.__adtBoardResultRateStore = new Map());

function ip(req){
  return String(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown').split(',')[0].trim().slice(0,80);
}
function allowed(req){
  const key=ip(req), now=Date.now();
  const recent=(store.get(key)||[]).filter(t=>now-t<RATE_WINDOW_MS);
  if(recent.length>=RATE_LIMIT) return false;
  recent.push(now); store.set(key,recent);
  if(store.size>2000) for(const [k,v] of store) if(!v.some(t=>now-t<RATE_WINDOW_MS)) store.delete(k);
  return true;
}

export default async function handler(req,res){
  if(req.method!=='GET') return res.status(405).json({error:'Method not allowed.'});
  if(!allowed(req)) return res.status(429).json({error:'Too many result checks. Please try again later.'});

  const exam=String(req.query?.exam||'').toLowerCase();
  const year=String(req.query?.year||'');
  const board=String(req.query?.board||'').toLowerCase();
  const roll=String(req.query?.roll||'').replace(/\D/g,'');
  const reg=String(req.query?.reg||'').replace(/\D/g,'');

  if(!['ssc','hsc'].includes(exam)) return res.status(400).json({error:'Select SSC or HSC/equivalent.'});
  if(!/^20\d{2}$/.test(year)) return res.status(400).json({error:'Invalid examination year.'});
  if(!board) return res.status(400).json({error:'Select an education board.'});
  if(!/^\d{4,8}$/.test(roll)) return res.status(400).json({error:'Enter a valid roll number.'});
  if(!/^\d{5,12}$/.test(reg)) return res.status(400).json({error:'Enter a valid registration number.'});

  try{
    const url='https://eduboardapi.vercel.app/fetch?'+new URLSearchParams({exam,year,board,roll,reg}).toString();
    const upstream=await fetch(url,{headers:{Accept:'application/json'},redirect:'follow'});
    const body=await upstream.text();
    let data; try{data=JSON.parse(body)}catch{data={raw:body}};
    if(!upstream.ok) return res.status(502).json({error:'The education board result service is temporarily unavailable. Please try again in a moment.',upstreamStatus:upstream.status});
    return res.status(200).json({source:'Education Board result service',data});
  }catch(error){
    console.error('Board result API error:',error);
    return res.status(502).json({error:'Could not reach the result service right now. Please try again.'});
  }
}
