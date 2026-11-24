const SOURCES=[
  'https://api.bangladeshgov.org/',
  'https://eduboardapi.vercel.app/fetch'
];

function json(res,data,status=200){
  return res.status(status).json(data);
}
function boardCode(v){return v==='chattogram'?'chittagong':v;}
function validate(v){
  if(!['ssc','hsc'].includes(v.exam))return 'Select SSC or HSC/equivalent.';
  if(!/^\d{4}$/.test(v.year))return 'Invalid examination year.';
  if(!v.board)return 'Select an education board.';
  if(!/^\d{1,10}$/.test(v.roll))return 'Enter a valid roll number.';
  if(!/^\d{1,15}$/.test(v.reg))return 'Enter a valid registration number.';
  return null;
}
function normalize(data,fallback){
  const r=data?.res||data;
  if(!r||typeof r!=='object')return null;
  const rawGrades=Array.isArray(r.grades)?r.grades:[];
  const grades=rawGrades.map(g=>({
    code:String(g.code??g.subject_code??''),
    subject:String(g.subject??g.subject_name??''),
    grade:String(g.grade??g.letter_grade??'')
  }));
  const out={
    roll:String(r.roll??r.roll_no??fallback.roll),
    reg:String(r.reg??r.regno??r.registration??fallback.reg),
    name:String(r.name??r.name_of_student??r.student_name??''),
    fatherName:String(r.father_name??r.fathers_name??r.fatherName??''),
    motherName:String(r.mother_name??r.mothers_name??r.motherName??''),
    board:String(r.board??fallback.board),
    group:String(r.group??''),
    examType:String(r.exam_type??r.type??''),
    dob:String(r.dob??r.date_of_birth??''),
    institute:String(r.institute??r.inst_name??r.institution??''),
    result:String(r.result??r.res_detail??''),
    gpa:String(r.gpa??''),
    grades
  };
  if(!out.name&&!out.gpa&&!out.result&&!out.grades.length)return null;
  return out;
}

async function fetchJson(url,options){
  const response=await fetch(url,{
    ...options,
    headers:{
      'User-Agent':'Mozilla/5.0 AdmissionTracker/1.0',
      'Accept':'application/json,text/plain,*/*',
      ...(options?.headers||{})
    }
  });
  const raw=await response.text();
  let data=null;
  try{data=JSON.parse(raw)}catch{}
  return {response,data,raw};
}

export default async function handler(req,res){
  if(req.method!=='POST')return json(res,{error:'Method not allowed.'},405);
  try{
    const body=typeof req.body==='object'&&req.body?req.body:JSON.parse(req.body||'{}');
    const exam=String(body.exam||'').toLowerCase();
    const year=String(body.year||'');
    const board=boardCode(String(body.board||'').toLowerCase());
    const roll=String(body.roll||'').replace(/\D/g,'');
    const reg=String(body.reg||'').replace(/\D/g,'');
    const err=validate({exam,year,board,roll,reg});
    if(err)return json(res,{error:err},400);

    const q={exam,year,board,roll,reg};
    const encoded=new URLSearchParams(q).toString();
    let lastError='';

    for(const base of SOURCES){
      try{
        const isQuery=base.includes('?')||base.endsWith('/');
        const url=isQuery
          ? base+(base.includes('?')?'&':'?')+encoded
          : base+'?'+encoded;
        const result=await fetchJson(url,{
          method:'GET',
          signal:AbortSignal.timeout(8000)
        });
        if(!result.response.ok){
          lastError='Result source returned HTTP '+result.response.status+'.';
          continue;
        }
        if(result.data?.error||result.data?.message){
          lastError=String(result.data.error||result.data.message);
          continue;
        }
        const parsed=normalize(result.data,{roll,reg,board});
        if(parsed)return json(res,{ok:true,result:parsed,source:'education-board-result-service'});
        lastError='No result data was returned.';
      }catch(e){
        lastError=e?.message||'Source unavailable.';
      }
    }

    return json(res,{error:lastError||'The result service is temporarily unavailable. Please try again.'},502);
  }catch(e){
    console.error('Board result lookup error:',e);
    return json(res,{error:'The result service is temporarily unavailable. Please try again.'},502);
  }
}
