const BASE = 'https://eboardresults.com';
const HOME = BASE + '/v2/home';
const CAPTCHA = BASE + '/v2/captcha';
const GETRES = BASE + '/v2/getres';

function json(res,data,status=200,extraHeaders={}){
  return res.status(status).set(extraHeaders).json(data);
}
function boardCode(v){
  return v === 'chattogram' ? 'chittagong' : v;
}
function valid(v){
  if(!['ssc','hsc'].includes(v.exam)) return 'Select SSC or HSC/equivalent.';
  if(!/^\d{4}$/.test(v.year)) return 'Invalid examination year.';
  if(!v.board) return 'Select an education board.';
  if(!/^\d{1,10}$/.test(v.roll)) return 'Enter a valid roll number.';
  if(!/^\d{1,15}$/.test(v.reg)) return 'Enter a valid registration number.';
  return null;
}
function sessionFromSetCookie(raw){
  const m=String(raw||'').match(/(?:^|,\s*)EBRSESSID2=([^;]+)/);
  return m ? m[1] : '';
}
function cookieHeader(session){
  return 'EBRSESSID2=' + session;
}
function parseResult(data,fallback){
  const r=data && data.res;
  if(!r || typeof r!=='object') return null;
  const grades=[];
  const rawGrades=Array.isArray(r.grades) ? r.grades : [];
  for(const g of rawGrades){
    grades.push({
      code:String(g.code ?? g.subject_code ?? ''),
      subject:String(g.subject ?? g.subject_name ?? ''),
      grade:String(g.grade ?? g.letter_grade ?? '')
    });
  }
  const out={
    roll:String(r.roll ?? r.roll_no ?? fallback.roll),
    reg:String(r.reg ?? r.regno ?? fallback.reg),
    name:String(r.name ?? r.name_of_student ?? r.student_name ?? ''),
    fatherName:String(r.fatherName ?? r.father_name ?? r.fathers_name ?? ''),
    motherName:String(r.motherName ?? r.mother_name ?? r.mothers_name ?? ''),
    board:String(r.board ?? fallback.board),
    group:String(r.group ?? ''),
    examType:String(r.exam_type ?? r.type ?? ''),
    dob:String(r.dob ?? r.date_of_birth ?? ''),
    institute:String(r.institute ?? r.inst_name ?? r.institution ?? ''),
    result:String(r.result ?? r.res_detail ?? ''),
    gpa:String(r.gpa ?? ''),
    grades
  };
  if(!out.name && !out.gpa && !out.result && !out.grades.length) return null;
  return out;
}

async function createSession(){
  const ua='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';
  const home=await fetch(HOME,{
    headers:{
      'User-Agent':ua,
      'Accept':'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Cache-Control':'no-cache'
    },
    redirect:'manual'
  });
  const setCookie=home.headers.get('set-cookie')||'';
  const session=sessionFromSetCookie(setCookie);
  if(!home.ok || !session) throw new Error('Could not establish the result-service session.');
  return {session,ua};
}

async function getCaptcha(session,ua){
  const cap=await fetch(CAPTCHA+'?t='+Date.now(),{
    headers:{
      'User-Agent':ua,
      'Accept':'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      'Referer':HOME,
      'Cookie':cookieHeader(session),
      'Cache-Control':'no-cache'
    },
    redirect:'follow'
  });
  if(!cap.ok) throw new Error('Could not load the security image.');
  const type=cap.headers.get('content-type')||'';
  if(!type.startsWith('image/')) throw new Error('The result service did not return a security image.');
  const buf=Buffer.from(await cap.arrayBuffer());
  return 'data:'+type.split(';')[0]+';base64,'+buf.toString('base64');
}

export default async function handler(req,res){
  try{
    if(req.method==='GET'){
      const q=req.query||{};
      if(q.mode==='captcha'){
        const {session,ua}=await createSession();
        const image=await getCaptcha(session,ua);
        return json(res,{ok:true,image},{status:200});
      }
      return json(res,{ok:true,service:'eboardresults',message:'Use mode=captcha to initialize verification.'});
    }

    if(req.method!=='POST') return json(res,{error:'Method not allowed.'},405);

    const body=typeof req.body==='object'&&req.body?req.body:JSON.parse(req.body||'{}');
    const exam=String(body.exam||'').toLowerCase();
    const year=String(body.year||'');
    const board=boardCode(String(body.board||'').toLowerCase());
    const roll=String(body.roll||'').replace(/\D/g,'');
    const reg=String(body.reg||'').replace(/\D/g,'');
    const captcha=String(body.captcha||'').trim().toLowerCase();

    const err=valid({exam,year,board,roll,reg});
    if(err) return json(res,{error:err},400);
    if(!captcha) return json(res,{error:'Enter the security code shown in the image.'},400);

    let session=String(req.cookies?.adt_ebr_session||'');
    let ua='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

    if(!session){
      return json(res,{error:'Security session expired. Reload the security image and try again.'},400);
    }

    const form=new URLSearchParams({
      board,
      exam,
      year,
      result_type:'1',
      roll,
      reg,
      captcha
    });

    const upstream=await fetch(GETRES,{
      method:'POST',
      headers:{
        'User-Agent':ua,
        'Accept':'application/json, text/javascript, */*; q=0.01',
        'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8',
        'Origin':BASE,
        'Referer':HOME,
        'X-Requested-With':'XMLHttpRequest',
        'Cookie':cookieHeader(session)
      },
      body:form.toString(),
      redirect:'follow'
    });

    const raw=await upstream.text();
    let data=null;
    try{data=JSON.parse(raw)}catch{}

    if(data && Number(data.status)===0){
      const result=parseResult(data,{roll,reg,board});
      if(result) return json(res,{ok:true,result});
    }

    const msg=String(data?.msg||data?.message||'');
    if(/security key|captcha|check and try again/i.test(msg)){
      return json(res,{error:'Incorrect security code. Reload the image and enter it again.'},400);
    }
    if(msg) return json(res,{error:msg},400);

    return json(res,{error:'The result service did not return a result. Please check the information and try again.'},502);
  }catch(error){
    console.error('Board result service error:',error);
    return json(res,{error:error?.message||'The result service is temporarily unavailable. Please try again.'},502);
  }
}
