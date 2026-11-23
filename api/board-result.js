const RATE_WINDOW_MS = 5 * 60 * 1000;
const RATE_LIMIT = 20;
const store = globalThis.__adtBoardResultRateStore || (globalThis.__adtBoardResultRateStore = new Map());

const BASE_URL = 'https://www.educationboardresults.gov.bd';
const HOME_URL = BASE_URL + '/v2/home';
const CAPTCHA_URL = BASE_URL + '/v2/captcha';
const RESULT_URL = BASE_URL + '/v2/getres';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

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
function cookieValue(req,name){
  const raw=String(req.headers.cookie||'');
  const part=raw.split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='));
  return part ? decodeURIComponent(part.slice(name.length+1)) : '';
}
function parseSession(setCookie){
  const m=/PHPSESSID=([^;]+)/i.exec(String(setCookie||''));
  return m ? m[1] : '';
}
function validate(v){
  if(!['ssc','hsc'].includes(v.exam)) return 'Select SSC or HSC/equivalent.';
  if(!/^20\d{2}$/.test(v.year)) return 'Invalid examination year.';
  if(!v.board) return 'Select an education board.';
  if(!/^\d{4,8}$/.test(v.roll)) return 'Enter a valid roll number.';
  if(!/^\d{5,12}$/.test(v.reg)) return 'Enter a valid registration number.';
  return null;
}
function boardCode(board){
  return board==='chattogram'?'chittagong':board;
}
function json(res,data,status=200){
  return res.status(status).json(data);
}
function textOf(html){
  return String(html||'').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&#039;/gi,"'").replace(/&apos;/gi,"'").replace(/&quot;/gi,'"').replace(/\s+/g,' ').trim();
}
function parseJsonResult(data, fallback){
  if(!data || typeof data!=='object') return null;
  if(String(data.status)==='0' && data.res && typeof data.res==='object') return data.res;
  if(data.res && typeof data.res==='object') return data.res;
  return null;
}
function parseHtmlResult(html,fallback){
  const cells=[];
  const tdRe=/<td\b[^>]*>([\s\S]*?)<\/td>/gi;
  let m;
  while((m=tdRe.exec(html))) cells.push(textOf(m[1]));
  if(!cells.length)return null;
  const info={};
  for(let i=0;i<cells.length-1;i++){
    const label=cells[i].toLowerCase(), value=cells[i+1];
    if(value&&!info[label])info[label]=value;
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
    while((c=cRe.exec(r[1])))row.push(textOf(c[1]));
    if(row.length!==3)continue;
    const [code,subject,grade]=row;
    if(/^\d{2,4}$/.test(code)&&/^[A-F][+\-]?$/i.test(grade)&&subject)grades.push({code,subject,grade:grade.toUpperCase()});
  }
  const name=pick('name','name of student');
  if(!name&&!grades.length)return null;
  return {
    roll:pick('roll no','roll no.','roll')||fallback.roll,
    reg:fallback.reg,
    name,
    fatherName:pick("father's name",'fathers name','father name'),
    motherName:pick("mother's name",'mothers name','mother name'),
    board:pick('board')||fallback.board,
    group:pick('group'),
    examType:pick('type','exam type'),
    dob:pick('date of birth','dob'),
    institute:pick('institute','institution'),
    result:pick('result'),
    gpa:pick('gpa'),
    grades
  };
}
function normalizeResult(data,fallback){
  const r=parseJsonResult(data,fallback);
  if(r){
    return {
      roll:String(r.roll||fallback.roll),
      reg:String(r.reg||fallback.reg),
      name:String(r.name||r.studentName||''),
      fatherName:String(r.fname||r.father_name||r.fatherName||''),
      motherName:String(r.mname||r.mother_name||r.motherName||''),
      board:String(r.board||fallback.board),
      group:String(r.group||''),
      examType:String(r.type||r.exam_type||''),
      dob:String(r.dob||''),
      institute:String(r.institute||''),
      result:String(r.result||r.res_detail||''),
      gpa:String(r.gpa||''),
      grades:Array.isArray(r.subject_grades)?r.subject_grades.map(g=>({code:String(g.subjectCode||g.code||''),subject:String(g.subjectName||g.subject||''),grade:String(g.subjectGPA||g.grade||'')})):[],
    };
  }
  return parseHtmlResult(data,fallback);
}

export default async function handler(req,res){
  if(!allowed(req))return res.status(429).json({error:'Too many result checks. Please try again later.'});

  if(req.method==='GET'){
    const exam=String(req.query?.exam||'').toLowerCase();
    const year=String(req.query?.year||'');
    const board=String(req.query?.board||'').toLowerCase();
    const roll=String(req.query?.roll||'').replace(/\D/g,'');
    const reg=String(req.query?.reg||'').replace(/\D/g,'');
    const err=validate({exam,year,board,roll,reg});
    if(err)return json(res,{error:err},400);
    try{
      const home=await fetch(HOME_URL,{headers:{'User-Agent':UA,'Accept-Language':'en-US,en;q=0.9',Referer:HOME_URL},redirect:'follow'});
      if(!home.ok)return json(res,{error:'The official education board server is not responding right now.'},502);
      const sid=parseSession(home.headers.get('set-cookie'));
      if(!sid)return json(res,{error:'Could not establish the official result session.'},502);

      const captcha=await fetch(CAPTCHA_URL+'?t='+Date.now(),{
        headers:{'User-Agent':UA,Accept:'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',Referer:HOME_URL,Cookie:'PHPSESSID='+sid},
        redirect:'follow'
      });
      if(!captcha.ok)return json(res,{error:'Could not load the official security image. Please try again.'},502);
      const type=String(captcha.headers.get('content-type')||'').toLowerCase();
      if(!type.includes('image'))return json(res,{error:'The official security image could not be loaded.'},502);
      const bytes=Buffer.from(await captcha.arrayBuffer());
      const image='data:'+(type.split(';')[0]||'image/png')+';base64,'+bytes.toString('base64');

      res.setHeader('Set-Cookie','adt_eb_session='+encodeURIComponent(sid)+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=300');
      return json(res,{ok:true,image});
    }catch(error){
      console.error('Board result captcha error:',error);
      return json(res,{error:'Could not load the official result security check right now.'},502);
    }
  }

  if(req.method!=='POST')return json(res,{error:'Method not allowed.'},405);

  try{
    const body=typeof req.body==='object'&&req.body?req.body:JSON.parse(req.body||'{}');
    const exam=String(body.exam||'').toLowerCase();
    const year=String(body.year||'');
    const board=String(body.board||'').toLowerCase();
    const roll=String(body.roll||'').replace(/\D/g,'');
    const reg=String(body.reg||'').replace(/\D/g,'');
    const captcha=String(body.captcha||'').trim();
    const err=validate({exam,year,board,roll,reg});
    if(err)return json(res,{error:err},400);
    if(!captcha)return json(res,{error:'Enter the security code shown in the image.'},400);

    const sid=cookieValue(req,'adt_eb_session');
    if(!sid)return json(res,{error:'The security session expired. Please press Check Result again.'},400);

    const payload=new URLSearchParams({
      board:boardCode(board),
      exam,
      year,
      result_type:'1',
      roll,
      reg,
      captcha
    });
    const upstream=await fetch(RESULT_URL,{
      method:'POST',
      headers:{
        'User-Agent':UA,
        'Accept':'application/json, text/javascript, */*; q=0.01',
        'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8',
        'Origin':BASE_URL,
        'Referer':HOME_URL,
        'X-Requested-With':'XMLHttpRequest',
        Cookie:'PHPSESSID='+sid
      },
      body:payload.toString(),
      redirect:'follow'
    });
    const raw=await upstream.text();
    if(!upstream.ok)return json(res,{error:'The official result server returned an error. Please try again.'},502);

    let data;
    try{data=JSON.parse(raw)}catch{data=raw}
    if(data&&typeof data==='object'&&String(data.status)!=='0'){
      return json(res,{error:String(data.msg||'Result not found. Check your information and security code.')},400);
    }
    const parsed=normalizeResult(data,{roll,reg,board:boardCode(board)});
    if(!parsed)return json(res,{error:'The official server returned an unexpected result response.'},502);
    res.setHeader('Set-Cookie','adt_eb_session=deleted; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
    return json(res,{ok:true,result:parsed});
  }catch(error){
    console.error('Board result API error:',error);
    return json(res,{error:'Could not reach the official result server right now. Please try again.'},502);
  }
}
