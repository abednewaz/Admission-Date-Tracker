export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  const key=process.env.OPENAI_API_KEY;
  if(!key)return res.status(503).json({error:'OPENAI_API_KEY is not configured'});
  try{
    const b=req.body||{};
    const title=String(b.title||'').trim(), university=String(b.university||'').trim(), date=String(b.date||'').trim(), url=String(b.url||'').trim(), source=String(b.source||'').trim();
    if(!title)return res.status(400).json({error:'Notice title is required'});
    const input='You are the mini AI research summarizer for Admission Tracker, a Bangladesh university admission website. You MUST search the live web before answering. Search the notice title and university, inspect multiple relevant sources when available, and prioritize the university official website/admission portal and the supplied source. Use the supplied URL as a starting point if present. Summarize ONE admission notice in 2-4 concise sentences for students. Reconcile matching facts across sources, but never invent missing facts. Prioritize application dates, exam date, eligibility, fee, seat/unit information, and other critical student-facing facts. If sources disagree, prefer the official source and mention uncertainty briefly. Return only the summary text, without a heading or markdown. Notice title: '+title+'\nUniversity: '+university+'\nPublished date: '+date+'\nSource: '+source+'\nURL: '+url;
    const payload={model:'gpt-6-astra',input,tools:[{type:'web_search',search_context_size:'high',external_web_access:true}],tool_choice:'required',max_output_tokens:260};
    const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'Content-Type':'application/json','Authorization:'Bearer '+key},body:JSON.stringify(payload)});
    const data=await r.json();
    if(!r.ok)throw new Error(data.error?.message||'OpenAI request failed');
    const summary=String(data.output_text||'').trim();
    if(!summary)throw new Error('No summary returned');
    return res.status(200).json({summary});
  }catch(e){console.error('notice-summary:',e);return res.status(500).json({error:'Unable to generate summary'});}
}
