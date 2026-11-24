const readline=require('readline');

const TOKEN=process.env.BROWSERLESS_TOKEN;
if(!TOKEN){console.error('Set BROWSERLESS_TOKEN first.');process.exit(1);}

const rl=readline.createInterface({input:process.stdin,output:process.stdout});
const ask=q=>new Promise(r=>rl.question(q,r));

async function bql(url,query,operationName){
  const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query,variables:{},operationName})});
  const raw=await r.text();let j=null;try{j=JSON.parse(raw)}catch{}
  if(!r.ok)throw new Error(j?.errors?.[0]?.message||'BQL request failed: '+r.status);
  if(j?.errors?.length)throw new Error(j.errors.map(e=>e.message).join('; '));
  return j.data;
}
function setSelect(selector,label){
  const s=JSON.stringify(selector),l=JSON.stringify(label);
  return `evaluate(content: """(()=>{const s=document.querySelector(${s});if(!s)return false;const t=${l};const o=[...s.options].find(x=>x.textContent.trim().toLowerCase()===t.trim().toLowerCase());if(!o)return false;s.value=o.value;s.dispatchEvent(new Event('change',{bubbles:true}));return s.value;})()""") { value }`;
}
(async()=>{
  const board=await ask('Board (Dhaka/Rajshahi/etc.): ');
  const roll=await ask('Roll: ');
  const reg=await ask('Registration: ');

  const sessionRes=await fetch(`https://production-sfo.browserless.io/session?token=${encodeURIComponent(TOKEN)}`,{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({ttl:120000,stealth:false,browser:'chromium'})
  });
  const session=await sessionRes.json();
  if(!sessionRes.ok)throw new Error(session?.error||'Could not create Browserless session.');

  try{
    const query=`mutation Start {
      goto(url:"https://educationboardresults.gov.bd/v2/home",waitUntil:domContentLoaded){status}
      waitForSelector(selector:"select[name='board']",timeout:15000){selector}
      ${setSelect('select[name="board"]',board)}
      ${setSelect('select[name="exam"]','HSC/Alim/Equivalent')}
      ${setSelect('select[name="year"]','2026')}
      ${setSelect('select','Individual/Detailed Result')}
      type(selector:"input[name='roll']",text:${JSON.stringify(roll)}){time}
      type(selector:"input[name='reg']",text:${JSON.stringify(reg)}){time}
      waitForSelector(selector:"input[name='captcha'],#captcha",timeout:10000){selector}
      screenshot(selector:"img[src*='captcha'],img[id*='captcha'],img[alt*='captcha']",type:png,quality:100){base64}
    }`;

    const data=await bql(session.browserQL,query,'Start');
    if(!data?.screenshot?.base64)throw new Error('CAPTCHA screenshot was not returned.');

    require('fs').writeFileSync('browserless-session-captcha.png',Buffer.from(data.screenshot.base64,'base64'));
    console.log('\nSUCCESS: Browserless Session API reached the official 2026 form.');
    console.log('CAPTCHA saved as: browserless-session-captcha.png');
    console.log('Open it with: termux-open browserless-session-captcha.png');

    const captcha=await ask('CAPTCHA: ');
    const submit=`mutation Submit {
      type(selector:"input[name='captcha'],#captcha",text:${JSON.stringify(captcha)}){time}
      click(selector:"input[type='submit'],button[type='submit']",visible:true){time}
      waitForNavigation(timeout:15000){status}
      text(selector:"body"){text}
    }`;
    const result=await bql(session.browserQL,submit,'Submit');
    const text=result?.text?.text||'';
    console.log('\n========== RESULT CHECK ==========');
    console.log(text.slice(0,12000));
    console.log('\nIf you see "Student Information Summary" / "Result of HSC or Equivalent Examination - 2026", the two-step Browserless session works.');
  }catch(e){
    console.error('\nTEST ERROR:',e.message);
  }finally{
    try{await fetch(session.stop,{method:'DELETE'});}catch{}
    rl.close();
  }
})().catch(e=>{console.error('FATAL:',e.message);rl.close();});
