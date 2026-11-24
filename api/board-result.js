const API='https://eduboardapi.vercel.app/fetch';

function json(res,data,status=200){return res.status(status).json(data);}
function boardCode(v){return v==='chattogram'?'chittagong':v;}
function valid(v){
  if(!['ssc','hsc'].includes(v.exam))return 'Select SSC or HSC/equivalent.';
  if(!/^\d{4}$/.test(v.year))return 'Invalid examination year.';
  if(!v.board)return 'Select an education board.';
  if(!/^\d{1,10}$/.test(v.roll))return 'Enter a valid roll number.';
  if(!/^\d{1,15}$/.test(v.reg))return 'Enter a valid registration number.';
  return null;
}
function normalize(r,fallback){
  if(!r||typeof r!=='object')return null;
  const grades=Array.isArray(r.grades)?r.grades.map(g=>({
    code:String(g.code??g.subjectCode??g.subject_code??''),
    subject:String(g.subject??g.subjectName??g.subject_name??''),
    grade:String(g.grade??g.subjectGPA??g.letter_grade??'')
  })):[];
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

export default async function handler(req,res){
  if(req.method!=='POST')return json(res,{error:'Method not allowed.'},405);
  try{
    const body=typeof req.body==='object'&&req.body?req.body:JSON.parse(req.body||'{}');
    const exam=String(body.exam||'').toLowerCase();
    const year=String(body.year||'');
    const board=boardCode(String(body.board||'').toLowerCase());
    const roll=String(body.roll||'').replace(/\D/g,'');
    const reg=String(body.reg||'').replace(/\D/g,'');
    const err=valid({exam,year,board,roll,reg});
    if(err)return json(res,{error:err},400);

    const upstream=await fetch(API,{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'Accept':'application/json',
        'User-Agent':'AdmissionTracker/1.0'
      },
      body:JSON.stringify({exam,year,board,roll,reg}),
      signal:AbortSignal.timeout(15000)
    });

    const raw=await upstream.text();
    let data=null;
    try{data=JSON.parse(raw)}catch{}

    if(!upstream.ok){
      const detail=data?.error||data?.message||data?.msg||'';
      return json(res,{error:detail||'The result service rejected the request. Check your exam, year, board, roll and registration number.'},502);
    }

    const result=normalize(data,{roll,reg,board});
    if(result)return json(res,{ok:true,result,source:'EduBoard API'});

    return json(res,{error:String(data?.error||data?.message||'No result was found for the supplied information.')},404);
  }catch(e){
    console.error('Board result API error:',e);
    return json(res,{error:'Could not reach the result service right now. Please try again.'},502);
  }
}
