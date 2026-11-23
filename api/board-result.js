const RATE_WINDOW_MS = 5 * 60 * 1000;
const RATE_LIMIT = 20;
const store = globalThis.__adtBoardResultRateStore || (globalThis.__adtBoardResultRateStore = new Map());

const API_URL = 'https://eduboardapi.vercel.app/fetch';

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
function boardCode(board){
  return board==='chattogram' ? 'chittagong' : board;
}
function json(res,data,status=200){
  return res.status(status).json(data);
}
function normalizeResult(r,fallback){
  if(!r || typeof r!=='object') return null;
  const grades = Array.isArray(r.grades) ? r.grades : (Array.isArray(r.subject_grades) ? r.subject_grades : []);
  const result = {
    roll:String(r.roll ?? fallback.roll),
    reg:String(r.reg ?? r.registration ?? fallback.reg),
    name:String(r.name ?? r.studentName ?? ''),
    fatherName:String(r.father_name ?? r.fname ?? r.fatherName ?? ''),
    motherName:String(r.mother_name ?? r.mname ?? r.motherName ?? ''),
    board:String(r.board ?? fallback.board),
    group:String(r.group ?? ''),
    examType:String(r.exam_type ?? r.type ?? ''),
    dob:String(r.dob ?? ''),
    institute:String(r.institute ?? r.institution ?? ''),
    result:String(r.result ?? r.res_detail ?? ''),
    gpa:String(r.gpa ?? ''),
    grades:grades.map(g=>({
      code:String(g.code ?? g.subjectCode ?? ''),
      subject:String(g.subject ?? g.subjectName ?? ''),
      grade:String(g.grade ?? g.subjectGPA ?? '')
    }))
  };
  if(!result.name && !result.grades.length && !result.result && !result.gpa) return null;
  return result;
}

export default async function handler(req,res){
  if(!allowed(req)) return json(res,{error:'Too many result checks. Please try again later.'},429);
  if(req.method!=='POST') return json(res,{error:'Method not allowed.'},405);

  try{
    const body=typeof req.body==='object'&&req.body?req.body:JSON.parse(req.body||'{}');
    const exam=String(body.exam||'').toLowerCase();
    const year=String(body.year||'');
    const board=String(body.board||'').toLowerCase();
    const roll=String(body.roll||'').replace(/\D/g,'');
    const reg=String(body.reg||'').replace(/\D/g,'');
    const err=validate({exam,year,board,roll,reg});
    if(err) return json(res,{error:err},400);

    const upstream=await fetch(API_URL,{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'Accept':'application/json'
      },
      body:JSON.stringify({
        exam,
        year,
        board:boardCode(board),
        roll,
        reg
      })
    });

    const raw=await upstream.text();
    let data;
    try{data=JSON.parse(raw)}catch{data=null}

    if(!upstream.ok){
      const msg=data && (data.error || data.message || data.msg);
      return json(res,{error:String(msg||'The result service is temporarily unavailable. Please try again.')},502);
    }

    if(data && (data.error || data.message) && !data.name && !data.grades && !data.subject_grades){
      return json(res,{error:String(data.error||data.message)},400);
    }

    const parsed=normalizeResult(data,{roll,reg,board:boardCode(board)});
    if(!parsed){
      return json(res,{error:'The result service returned no usable result. Check your board, roll and registration number.'},404);
    }

    return json(res,{ok:true,result:parsed});
  }catch(error){
    console.error('Board result API error:',error);
    return json(res,{error:'Could not reach the result service right now. Please try again.'},502);
  }
}
