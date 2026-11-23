const RATE_WINDOW_MS = 5 * 60 * 1000;
const RATE_LIMIT = 20;
const store = globalThis.__adtBoardResultRateStore || (globalThis.__adtBoardResultRateStore = new Map());
const UPSTREAM = 'https://www.educationboardresults.gov.bd';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

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
function validate(v){
  if(!['ssc','hsc'].includes(v.exam)) return 'Select SSC or HSC/equivalent.';
  if(!/^20\d{2}$/.test(v.year)) return 'Invalid examination year.';
  if(!v.board) return 'Select an education board.';
  if(!/^\d{4,8}$/.test(v.roll)) return 'Enter a valid roll number.';
  if(!/^\d{5,12}$/.test(v.reg)) return 'Enter a valid registration number.';
  return null;
}
function cookieValue(req,name){
  const raw=String(req.headers.cookie||'');
  const part=raw.split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='));
  return part ? decodeURIComponent(part.slice(name.length+1)) : '';
}
function parseSession(setCookie){
  const m=/PHPSESSID=([^;]+)/i.exec(String(setCookie||''));
  return m ? m[1] : '';
}
function captchaFromHtml(html){
  const m=/(\d+)\s*\+\s*(\d+)/.exec(html);
  return m ? {question:m[1]+' + '+m[2]+' = ?'} : null;
}
function textOf(html){
  return String(html||'').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&#039;/gi,"'").replace(/&apos;/gi,"'").replace(/&quot;/gi,'"').replace(/\s+/g,' ').trim();
}
function parseResult(html,fallback){
  const cells=[];
  const tdRe=/<td\b[^>]*>([\s\S]*?)<\/td>/gi;
  let m;
  while((m=tdRe.exec(html))) cells.push(textOf(m[1]));
  if(!cells.length) return null;
  const info={};
  for(let i=0;i<cells.length-1;i++){
    const label=cells[i].toLowerCase(), value=cells[i+1];
    if(value && !info[label]) info[label]=value;
  }
  const pick=(...labels)=>{
    for(const l of labels){const v=info[l.toLowerCase()];if(v&&v.length<200)return v;}
    return '';
  };
  const grades=[];
  const rowRe=/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let r;
  while((r=rowRe.exec(html))){
    const row=[];
    const cRe=/<td\b[^>]*>([\s\S]*?)<\/td>/gi;
    let c;
    while((c=cRe.exec(r[1]))) row.push(textOf(c[1]));
    if(row.length!==3) continue;
    const [code,subject,grade]=row;
    if(/^\d{2,4}$/.test(code)&&/^[A-F][+\-]?$/i.test(grade)&&subject) grades.push({code,subject,grade:grade.toUpperCase()});
  }
  const name=pick('name');
  if(!name&&!grades.length)return null;
  return {
    roll:pick('roll no','roll no.','roll')||fallback.roll,
    reg:fallback.reg,
    name,
    fatherName:pick("father's name",'fathers name','father name'),
    motherName:pick("mother's name",'mothers name','mother name'),
    board:pick('board'),
    group:pick('group'),
    examType:pick('type','exam type'),
    dob:pick('date of birth','dob'),
    institute:pick('institute','institution'),
    result:pick('result'),
    gpa:pick('gpa'),
    grades
  };
}

export default async function handler(req,res){
  if(req.method==='GET'){
    if(!allowed(req)) return res.status(429).json({error:'Too many result checks. Please try again later.'});
    const exam=String(req.query?.exam||'').toLowerCase();
    const year=String(req.query?.year||'');
    const board=String(req.query?.board||'').toLowerCase();
    const roll=String(req.query?.roll||'').replace(/\D/g,'');
    const reg=String(req.query?.reg||'').replace(/\D/g,'');
    const err=validate({exam,year,board,roll,reg});
    if(err) return res.status(400).json({error:err});
    try{
      const home=await fetch(UPSTREAM+'/index.php',{headers:{'User-Agent':UA,Accept:'text/html'},redirect:'follow'});
      if(!home.ok)return res.status(502).json({error:'The official education board result server is not responding.'});
      const sid=parseSession(home.headers.get('set-cookie'));
      if(!sid)return res.status(502).json({error:'Could not establish a secure result session with the official server.'});
      const captcha=captchaFromHtml(await home.text());
      if(!captcha)return res.status(502).json({error:'Could not load the official security verification. Please try again.'});
      res.setHeader('Set-Cookie','adt_eb_session='+encodeURIComponent(sid)+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=300');
      return res.status(200).json({ok:true,question:captcha.question});
    }catch(error){
      console.error('Board result challenge error:',error);
      return res.status(502).json({error:'Could not reach the official result server right now. Please try again.'});
    }
  }

  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed.'});
  if(!allowed(req))return res.status(429).json({error:'Too many result checks. Please try again later.'});

  try{
    const body=typeof req.body==='object'&&req.body?req.body:JSON.parse(req.body||'{}');
    const exam=String(body.exam||'').toLowerCase();
    const year=String(body.year||'');
    const board=String(body.board||'').toLowerCase();
    const roll=String(body.roll||'').replace(/\D/g,'');
    const reg=String(body.reg||'').replace(/\D/g,'');
    const captcha=String(body.captcha||'').trim();
    const err=validate({exam,year,board,roll,reg});
    if(err)return res.status(400).json({error:err});
    if(!/^\d{1,6}$/.test(captcha))return res.status(400).json({error:'Enter the security answer shown above.'});
    const sid=cookieValue(req,'adt_eb_session');
    if(!sid)return res.status(400).json({error:'Your security session expired. Please press Check Result again.'});

    const form=new URLSearchParams({sr:'3',et:'2',exam,year,board,roll,reg,button2:'Submit',value_s:captcha});
    const upstream=await fetch(UPSTREAM+'/result.php',{
      method:'POST',
      headers:{'User-Agent':UA,'Content-Type':'application/x-www-form-urlencoded',Cookie:'PHPSESSID='+sid,Referer:UPSTREAM+'/index.php',Accept:'text/html'},
      body:form.toString(),
      redirect:'follow'
    });
    const raw=await upstream.text();
    if(!upstream.ok)return res.status(502).json({error:'The official education board result server returned an error. Please try again.'});
    const redirect=/window\.location\.href\s*=\s*["']index\.php\?err=(\d+)/.exec(raw);
    if(redirect)return res.status(400).json({error:'The official result server could not return a result. Check the board, roll, registration and security answer, then try again.'});
    const parsed=parseResult(raw,{roll,reg});
    if(!parsed)return res.status(502).json({error:'The official server returned an unexpected result page. Please try again.'});
    res.setHeader('Set-Cookie','adt_eb_session=deleted; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
    return res.status(200).json({ok:true,result:parsed});
  }catch(error){
    console.error('Board result API error:',error);
    return res.status(502).json({error:'Could not reach the official result server right now. Please try again.'});
  }
}
