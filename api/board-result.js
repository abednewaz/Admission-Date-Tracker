const API='https://eduboardapi.vercel.app/fetch';
const BASE='https://www.educationboardresults.gov.bd';
const HOME=BASE+'/v2/home';
const CAPTCHA=BASE+'/v2/captcha';
const RESULT=BASE+'/v2/getres';

function json(res,data,status=200){return res.status(status).json(data);}
function boardCode(v){
  const m={chattogram:'chittagong',comilla:'comilla',cumilla:'comilla',jashore:'jessore',barishal:'barisal',sylhet:'sylhet',dinajpur:'dinajpur',mymensingh:'mymensingh',rajshahi:'rajshahi',dhaka:'dhaka',madrasah:'madrasah',technical:'tec'};
  return m[String(v||'').toLowerCase()]||String(v||'').toLowerCase();
}
function valid(v){
  if(!['ssc','hsc'].includes(v.exam))return 'Select SSC or HSC/equivalent.';
  if(!/^\d{4}$/.test(v.year))return 'Invalid examination year.';
  if(!v.board)return 'Select an education board.';
  if(!/^\d{1,10}$/.test(v.roll))return 'Enter a valid roll number.';
  if(!/^\d{1,15}$/.test(v.reg))return 'Enter a valid registration number.';
  return null;
}
function normalize(data,fallback){
  const r=data&&typeof data==='object'?(data.res||data.result||data):null;
  if(!r||typeof r!=='object')return null;
  const grades=Array.isArray(r.grades)?r.grades:Array.isArray(r.subject_grades)?r.subject_grades:Array.isArray(r.subjectGrades)?r.subjectGrades:[];
  const out={
    roll:String(r.roll??r.roll_no??fallback.roll),reg:String(r.reg??r.regno??r.registration??fallback.reg),
    name:String(r.name??r.name_of_student??r.student_name??''),fatherName:String(r.fname??r.father_name??r.fathers_name??r.fatherName??''),
    motherName:String(r.mname??r.mother_name??r.mothers_name??r.motherName??''),board:String(r.board??fallback.board),
    group:String(r.group??''),examType:String(r.exam_type??r.type??''),dob:String(r.dob??r.date_of_birth??''),
    institute:String(r.institute??r.inst_name??r.institution??''),result:String(r.result??r.res_detail??''),gpa:String(r.gpa??''),
    grades:grades.map(g=>({code:String(g.code??g.subjectCode??g.subject_code??''),subject:String(g.subject??g.subjectName??g.subject_name??''),grade:String(g.grade??g.subjectGPA??g.letter_grade??g.marks??'')}))
  };
  if(!out.name&&!out.gpa&&!out.result&&!out.grades.length)return null;
  return out;
}
async function apiLookup(v){
  const body=JSON.stringify({exam:v.exam,year:v.year,board:v.board,roll:v.roll,reg:v.reg});
  const attempts=[
    {method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body},
    {method:'GET',headers:{Accept:'application/json'}}
  ];
  for(const a of attempts){
    let url=API;
    if(a.method==='GET')url=API+'?'+new URLSearchParams({exam:v.exam,year:v.year,board:v.board,roll:v.roll,reg:v.reg}).toString();
    try{
      const r=await fetch(url,{...a,signal:AbortSignal.timeout(12000)});
      const raw=await r.text(); let data=null; try{data=JSON.parse(raw)}catch{}
      if(r.ok){const result=normalize(data,v);if(result)return result;}
    }catch{}
  }
  return null;
}
function cookieHeader(res){
  try{if(typeof res.headers.getSetCookie==='function')return res.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');}catch{}
  const raw=res.headers.get('set-cookie')||'';
  return raw.split(/,(?=[A-Za-z0-9_]+=)/).map(x=>x.split(';')[0].trim()).filter(Boolean).join('; ');
}
function isChallenge(res,text){
  const u=String(res.url||'').toLowerCase(),t=String(text||'').toLowerCase();
  return u.includes('_challenge-engine')||t.includes('verifying your browser')||t.includes('_challenge-engine');
}
async function upstream(url,options={}){
  return fetch(url,{...options,headers:{'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36','Accept-Language':'en-US,en;q=0.9',...(options.headers||{})},signal:AbortSignal.timeout(20000)});
}
async function createSession(){
  const home=await upstream(HOME,{headers:{Accept:'text/html,application/xhtml+xml'}});
  const html=await home.text();
  if(!home.ok)throw new Error('The official education-board result server is unavailable right now.');
  if(isChallenge(home,html))throw new Error('The official result server is asking for browser verification. Please try again in a moment.');
  const cookie=cookieHeader(home);
  if(!cookie)throw new Error('Could not create a result-service session.');
  const cap=await upstream(CAPTCHA+'?t='+Date.now(),{headers:{Accept:'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',Cookie:cookie,Referer:HOME}});
  const type=cap.headers.get('content-type')||'',bytes=await cap.arrayBuffer();
  if(!cap.ok||!type.includes('image'))throw new Error('Could not load the official security image.');
  return {cookie,image:'data:'+type.split(';')[0]+';base64,'+Buffer.from(bytes).toString('base64')};
}
export default async function handler(req,res){
  if(req.method!=='POST')return json(res,{error:'Method not allowed.'},405);
  try{
    const body=typeof req.body==='object'&&req.body?req.body:JSON.parse(req.body||'{}');
    const action=String(body.action||'result');
    if(action==='captcha'){
      const session=await createSession();
      return json(res,{ok:true,session:Buffer.from(session.cookie,'utf8').toString('base64url'),image:session.image});
    }
    const exam=String(body.exam||'').toLowerCase(),year=String(body.year||''),board=boardCode(body.board),roll=String(body.roll||'').replace(/\D/g,''),reg=String(body.reg||'').replace(/\D/g,'');
    const v={exam,year,board,roll,reg},err=valid(v); if(err)return json(res,{error:err},400);

    // Primary path: server-to-server result API. This avoids the official site's browser-verification challenge.
    const apiResult=await apiLookup(v);
    if(apiResult)return json(res,{ok:true,result:apiResult,source:'Education Board Results API'});

    // Fallback path: official session + CAPTCHA, only when the API provider cannot answer.
    const captcha=String(body.captcha||'').trim();
    if(!captcha||!body.session)return json(res,{error:'The official result service requires browser verification. Use the official result form below to complete the check in your browser.',needsBrowser:true,url:'https://eboardresults.com/v2/home'},503);
    const cookie=Buffer.from(String(body.session),'base64url').toString('utf8');
    const r=await upstream(RESULT,{method:'POST',headers:{Accept:'application/json, text/javascript, */*; q=0.01','Content-Type':'application/x-www-form-urlencoded; charset=UTF-8','Origin':BASE,'Referer':HOME,'X-Requested-With':'XMLHttpRequest','Cookie':cookie},body:new URLSearchParams({board,exam,year,result_type:'1',roll,reg,captcha}).toString()});
    const raw=await r.text(); if(isChallenge(r,raw))return json(res,{error:'The official result server requested browser verification. Continue in the embedded official result form.',needsBrowser:true,url:'https://eboardresults.com/v2/home'},503);
    let data=null;try{data=JSON.parse(raw)}catch{}
    const result=normalize(data,v);
    if(result)return json(res,{ok:true,result,source:'Education Board Results'});
    const message=String(data?.msg||data?.message||data?.error||'');
    if(/captcha|security|robot/i.test(message))return json(res,{error:'Security code is incorrect or expired. Refresh the image and enter the new code.'},400);
    return json(res,{error:message||'No result was found for the supplied examination information.'},404);
  }catch(e){console.error('Board result API error:',e);return json(res,{error:e?.message||'Could not reach the result service right now.'},502);}
}
