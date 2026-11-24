import { SignJWT, jwtVerify } from 'jose';

const API='https://eduboardapi.vercel.app/fetch';
const BQL_HOST='https://production-sfo.browserless.io/chromium/bql';
const BASE='https://www.educationboardresults.gov.bd';
const HOME=BASE+'/v2/home';

function json(res,data,status=200){return res.status(status).json(data);}
function boardCode(v){
  const m={chattogram:'chittagong',comilla:'comilla',cumilla:'comilla',jashore:'jessore',jessore:'jessore',barishal:'barisal',sylhet:'sylhet',dinajpur:'dinajpur',mymensingh:'mymensingh',rajshahi:'rajshahi',dhaka:'dhaka',madrasah:'madrasah',technical:'tec',tec:'tec'};
  return m[String(v||'').toLowerCase()]||String(v||'').toLowerCase();
}
function boardLabel(v){
  const m={dhaka:'Dhaka',rajshahi:'Rajshahi',chittagong:'Chittagong',comilla:'Comilla',barisal:'Barisal',sylhet:'Sylhet',jessore:'Jessore',dinajpur:'Dinajpur',mymensingh:'Mymensingh',madrasah:'Madrasah',tec:'Technical'};
  return m[boardCode(v)]||String(v||'');
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
  const out={roll:String(r.roll??r.roll_no??fallback.roll),reg:String(r.reg??r.regno??r.registration??fallback.reg),name:String(r.name??r.name_of_student??r.student_name??''),fatherName:String(r.fname??r.father_name??r.fathers_name??r.fatherName??''),motherName:String(r.mname??r.mother_name??r.mothers_name??r.motherName??''),board:String(r.board??fallback.board),group:String(r.group??''),examType:String(r.exam_type??r.type??''),dob:String(r.dob??r.date_of_birth??''),institute:String(r.institute??r.inst_name??r.institution??''),result:String(r.result??r.res_detail??''),gpa:String(r.gpa??''),grades:grades.map(g=>({code:String(g.code??g.subjectCode??g.subject_code??''),subject:String(g.subject??g.subjectName??g.subject_name??''),grade:String(g.grade??g.subjectGPA??g.letter_grade??g.marks??''),marks:String(g.marks??'')}))};
  if(!out.name&&!out.gpa&&!out.result&&!out.grades.length)return null;
  return out;
}
async function apiLookup(v){
  const q=new URLSearchParams({exam:v.exam,year:v.year,board:v.board,roll:v.roll,reg:v.reg}).toString();
  const body=JSON.stringify({exam:v.exam,year:v.year,board:v.board,roll:v.roll,reg:v.reg});
  const providers=[{url:API,method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body},{url:API+'?'+q,method:'GET',headers:{Accept:'application/json'}},{url:'https://api.bangladeshgov.org/?'+q,method:'GET',headers:{Accept:'application/json'}}];
  for(const a of providers){try{const r=await fetch(a.url,{method:a.method,headers:a.headers,body:a.body,signal:AbortSignal.timeout(12000)});const raw=await r.text();let data=null;try{data=JSON.parse(raw)}catch{}if(r.ok){const result=normalize(data,v);if(result)return result;}}catch{}}
  return null;
}
function browserlessSecret(){const v=process.env.BROWSERLESS_TOKEN;if(!v)throw new Error('Browserless API token is not configured.');return new TextEncoder().encode(v);}
async function signSession(payload){return new SignJWT(payload).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('2m').sign(browserlessSecret());}
async function readSession(token){const {payload}=await jwtVerify(String(token),browserlessSecret());if(!payload.endpoint)throw new Error('Result browser session is invalid.');return payload;}
async function bql(url,query,operationName){
  const target=url||`${BQL_HOST}?token=${encodeURIComponent(process.env.BROWSERLESS_TOKEN)}&timeout=120000`;
  const r=await fetch(target,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query,variables:{},operationName}),signal:AbortSignal.timeout(55000)});
  const raw=await r.text();let data=null;try{data=JSON.parse(raw)}catch{}
  if(!r.ok)throw new Error(data?.errors?.[0]?.message||'Browser service request failed.');
  if(data?.errors?.length)throw new Error(data.errors[0].message||'Browser service rejected the request.');
  return data?.data||{};
}
function gqlSetSelect(selector,label){
  const s=JSON.stringify(selector),l=JSON.stringify(label);
  return `evaluate(content: "(()=>{const s=document.querySelector(${s}); if(!s) return false; const o=[...s.options].find(x=>x.textContent.trim().toLowerCase()===${l}.trim().toLowerCase()); if(!o) return false; s.value=o.value; s.dispatchEvent(new Event('input',{bubbles:true})); s.dispatchEvent(new Event('change',{bubbles:true})); return s.value;})()") { value }`;
}
async function startBrowserSession(v){
  const board=gqlSetSelect('select[name="board"]',boardLabel(v.board)),exam=gqlSetSelect('select[name="exam"]',v.exam==='hsc'?'HSC/Alim/Equivalent':'SSC/Dakhil/Equivalent'),year=gqlSetSelect('select[name="year"]',v.year),resultType=gqlSetSelect('select[name="result_type"]','Individual/Detailed Result');
  const query=`mutation StartBoardResult {
    goto(url: ${JSON.stringify(HOME)}, waitUntil: domContentLoaded) { status }
    waitForSelector(selector: "select[name='board']", timeout: 15000) { selector }
    ${board}${exam}${year}${resultType}
    type(selector: "input[name='roll']", text: ${JSON.stringify(v.roll)}) { time }
    type(selector: "input[name='reg']", text: ${JSON.stringify(v.reg)}) { time }
    waitForSelector(selector: "input[name='captcha'], #captcha", timeout: 10000) { selector }
    screenshot(selector: "img[src*='captcha'], img[id*='captcha'], img[alt*='captcha']", type: png, quality: 100) { base64 }
    reconnect(timeout: 110000) { browserQLEndpoint }
  }`;
  const data=await bql(null,query,'StartBoardResult'),endpoint=data?.reconnect?.browserQLEndpoint,image=data?.screenshot?.base64;
  if(Number(data?.goto?.status||200)>=400||!endpoint||!image)throw new Error('The official security image could not be loaded.');
  const session=await signSession({endpoint,exam:v.exam,year:v.year,board:v.board,roll:v.roll,reg:v.reg});
  return {session,image:`data:image/png;base64,${image}`};
}
function parseBrowserlessText(text,v){
  const t=String(text||'').replace(/\r/g,'').trim(),find=(re)=>{const m=t.match(re);return m?m[1].trim():''};
  const out={roll:find(/Roll No\s+([^\n]+)/i)||v.roll,reg:find(/Registration No\s+([^\n]+)/i)||v.reg,name:find(/Name of Student\s+([^\n]+)/i),fatherName:find(/Father's Name\s+([^\n]+)/i),motherName:find(/Mother's Name\s+([^\n]+)/i),board:find(/Board\s+([^\n]+?)(?=\s+Session|\n)/i)||boardLabel(v.board),group:find(/Group\s+(.+?)(?=\s+Type:)/i),examType:find(/Type:\s*(.+?)(?=\s+Gender|\n)/i),dob:find(/Date of Birth\s+([^\n]+)/i),institute:find(/Name of Institute\s+([^\n]+)/i),result:find(/Result\s+(.+?)(?=\s+GPA=|\n)/i),gpa:find(/GPA=\[?([0-9.]+)\]?/i),grades:[]};
  if(!out.name&&!out.gpa&&!out.result)return null;
  return out;
}
async function finishBrowserSession(v,sessionToken,captcha){
  const s=await readSession(sessionToken);
  if(s.exam!==v.exam||s.year!==v.year||s.board!==v.board||s.roll!==v.roll||s.reg!==v.reg)throw new Error('The result session does not match this request.');
  const endpoint=`${s.endpoint}${String(s.endpoint).includes('?')?'&':'?'}token=${encodeURIComponent(process.env.BROWSERLESS_TOKEN)}`;
  const query=`mutation SubmitBoardResult {
    type(selector: "input[name='captcha'], #captcha", text: ${JSON.stringify(captcha)}) { time }
    click(selector: "input[type='submit'], button[type='submit']", visible: true) { time }
    waitForNavigation(timeout: 15000) { status }
    text(selector: "body") { text }
  }`;
  const data=await bql(endpoint,query,'SubmitBoardResult'),text=data?.text?.text||'';
  if(/security code|robot prevention|captcha|incorrect/i.test(text)&&!/Student Information Summary|Result of HSC|Result of SSC/i.test(text))throw new Error('Security code is incorrect or expired. Refresh the image and try again.');
  const result=parseBrowserlessText(text,v);
  if(!result)throw new Error('The official result page did not return a readable result. The CAPTCHA may be wrong or the session may have expired.');
  return result;
}
export default async function handler(req,res){
  if(req.method!=='POST')return json(res,{error:'Method not allowed.'},405);
  try{
    const body=typeof req.body==='object'&&req.body?req.body:JSON.parse(req.body||'{}');
    const exam=String(body.exam||'').toLowerCase(),year=String(body.year||''),board=boardCode(body.board),roll=String(body.roll||'').replace(/\D/g,''),reg=String(body.reg||'').replace(/\D/g,'');
    const v={exam,year,board,roll,reg},err=valid(v);if(err)return json(res,{error:err},400);
    const apiResult=await apiLookup(v);if(apiResult)return json(res,{ok:true,result:apiResult,source:'Education Board Results API'});
    if(String(body.action||'result')==='captcha'||!body.session||!String(body.captcha||'').trim()){
      const started=await startBrowserSession(v);
      return json(res,{ok:true,needsCaptcha:true,session:started.session,image:started.image,expiresIn:110});
    }
    const result=await finishBrowserSession(v,String(body.session),String(body.captcha).trim());
    return json(res,{ok:true,result,source:'Official Education Board Results via Browserless'});
  }catch(e){console.error('Board result API error:',e);const msg=String(e?.message||'Could not reach the result service right now.');return json(res,{error:msg},/incorrect|expired|security code/i.test(msg)?400:502);}
}
