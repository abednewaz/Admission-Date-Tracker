const BROWSERLESS_SESSION='https://production-sfo.browserless.io/session';
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
function browserlessSecret(){const v=process.env.BROWSERLESS_TOKEN;if(!v)throw new Error('Browserless API token is not configured.');return new TextEncoder().encode(v);}
async function sessionKey(){
  const raw=process.env.BROWSERLESS_TOKEN;
  if(!raw)throw new Error('Browserless API token is not configured.');
  return new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw)));
}
async function signSession(payload){
  const { EncryptJWT } = await import('jose');
  return new EncryptJWT(payload).setProtectedHeader({alg:'dir',enc:'A256GCM'}).setIssuedAt().setExpirationTime('2m').encrypt(await sessionKey());
}
async function readSession(token){
  const {jwtDecrypt}=await import('jose');const {payload}=await jwtDecrypt(String(token),await sessionKey());
  if(!payload.browserQL||!payload.stop)throw new Error('Result browser session is invalid.');
  return payload;
}
async function createBrowserlessSession(){
  const token=process.env.BROWSERLESS_TOKEN;
  if(!token)throw new Error('Browserless API token is not configured.');
  const r=await fetch(`${BROWSERLESS_SESSION}?token=${encodeURIComponent(token)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ttl:120000,stealth:false,browser:'chromium'}),signal:AbortSignal.timeout(30000)});
  const raw=await r.text();let data=null;try{data=JSON.parse(raw)}catch{}
  if(!r.ok||!data?.browserQL||!data?.stop)throw new Error(data?.error||'Could not create the secure browser session.');
  return data;
}
async function stopBrowserlessSession(stopUrl){
  if(!stopUrl)return;
  try{await fetch(stopUrl,{method:'DELETE'});}catch{}
}
async function bql(url,query,operationName){
  let last='Browser service request failed.';
  for(let attempt=0;attempt<3;attempt++){
    const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query,variables:{},operationName}),signal:AbortSignal.timeout(55000)});
    const raw=await r.text();let data=null;try{data=JSON.parse(raw)}catch{}
    if(r.status===429&&attempt<2){await new Promise(resolve=>setTimeout(resolve,500*(attempt+1)));continue;}
    if(!r.ok)throw new Error(data?.errors?.[0]?.message||last);
    if(data?.errors?.length)throw new Error(data.errors.map(e=>e.message).join('; '));
    return data?.data||{};
  }
  throw new Error(last);
}
function gqlSetSelect(selector,label,alias){
  const s=JSON.stringify(selector),l=JSON.stringify(label);
  return `${alias}: evaluate(content: """(()=>{const s=document.querySelector(${s});if(!s)return false;const target=${l};const o=[...s.options].find(x=>x.textContent.trim().toLowerCase()===target.trim().toLowerCase());if(!o)return false;s.value=o.value;s.dispatchEvent(new Event('input',{bubbles:true}));s.dispatchEvent(new Event('change',{bubbles:true}));return s.value;})()""") { value }`;
}
function gqlSetAnySelect(label,alias){
  const l=JSON.stringify(label);
  return `${alias}: evaluate(content: """(()=>{const target=${l};for(const s of document.querySelectorAll('select')){const o=[...s.options].find(x=>x.textContent.trim().toLowerCase()===target.trim().toLowerCase());if(o){s.value=o.value;s.dispatchEvent(new Event('input',{bubbles:true}));s.dispatchEvent(new Event('change',{bubbles:true}));return s.value}}return false})()""") { value }`;
}
async function startBrowserSession(v){
  const session=await createBrowserlessSession();
  try{
    const board=gqlSetSelect('select[name="board"]',boardLabel(v.board),'setBoard');
    const exam=gqlSetSelect('select[name="exam"]',v.exam==='hsc'?'HSC/Alim/Equivalent':'SSC/Dakhil/Equivalent','setExam');
    const year=gqlSetSelect('select[name="year"]',v.year,'setYear');
    const resultType=gqlSetAnySelect('Individual/Detailed Result','setResultType');
    const query=`mutation StartBoardResult {
      goto(url: ${JSON.stringify(HOME)}, waitUntil: domContentLoaded) { status }
      waitBoard: waitForSelector(selector: "select[name='board']", timeout: 15000) { selector }
      ${board}
      ${exam}
      ${year}
      ${resultType}
      fillRoll: type(selector: "input[name='roll']", text: ${JSON.stringify(v.roll)}) { time }
      fillReg: type(selector: "input[name='reg']", text: ${JSON.stringify(v.reg)}) { time }
      waitCaptcha: waitForSelector(selector: "input[name='captcha'], #captcha", timeout: 10000) { selector }
      screenshot(selector: "img[src*='captcha'], img[id*='captcha'], img[alt*='captcha']", type: png, quality: 100) { base64 }
    }`;
    const data=await bql(session.browserQL,query,'StartBoardResult');
    const image=data?.screenshot?.base64;
    if(!image)throw new Error('The official security image could not be loaded.');
    const token=await signSession({browserQL:session.browserQL,stop:session.stop,exam:v.exam,year:v.year,board:v.board,roll:v.roll,reg:v.reg});
    return {session:token,image:`data:image/png;base64,${image}`};
  }catch(e){
    await stopBrowserlessSession(session.stop);
    throw e;
  }
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
  try{
    const query=`mutation SubmitBoardResult {
      fillCaptcha: type(selector: "input[name='captcha'], #captcha", text: ${JSON.stringify(captcha)}) { time }
      clickSubmit: click(selector: "input[type='submit'], button[type='submit']", visible: true) { time }
      waitResult: waitForNavigation(timeout: 15000) { status }
      bodyText: text(selector: "body") { text }
    }`;
    const data=await bql(String(s.browserQL),query,'SubmitBoardResult');
    const text=data?.bodyText?.text||'';
    if(/security code|robot prevention|captcha|incorrect/i.test(text)&&!/Student Information Summary|Result of HSC|Result of SSC/i.test(text))throw new Error('Security code is incorrect or expired. Refresh the image and try again.');
    const result=parseBrowserlessText(text,v);
    if(!result)throw new Error('The official result page did not return a readable result. The CAPTCHA may be wrong or the session may have expired.');
    return result;
  }finally{
    await stopBrowserlessSession(String(s.stop||''));
  }
}

export default async function handler(req,res){
  if(req.method!=='POST')return json(res,{error:'Method not allowed.'},405);
  try{
    const body=typeof req.body==='object'&&req.body?req.body:JSON.parse(req.body||'{}');
    const exam=String(body.exam||'').toLowerCase(),year=String(body.year||''),board=boardCode(body.board),roll=String(body.roll||'').replace(/\D/g,''),reg=String(body.reg||'').replace(/\D/g,'');
    const v={exam,year,board,roll,reg},err=valid(v);if(err)return json(res,{error:err},400);
        if(String(body.action||'result')==='captcha'||!body.session||!String(body.captcha||'').trim()){
      const started=await startBrowserSession(v);
      return json(res,{ok:true,needsCaptcha:true,session:started.session,image:started.image,expiresIn:110});
    }
    const result=await finishBrowserSession(v,String(body.session),String(body.captcha).trim());
    return json(res,{ok:true,result,source:'Official Education Board Results via Browserless'});
  }catch(e){console.error('Board result API error:',e);const msg=String(e?.message||'Could not reach the result service right now.');return json(res,{error:msg},/incorrect|expired|security code/i.test(msg)?400:502);}
}
