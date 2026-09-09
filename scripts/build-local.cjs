// Mechanical generation: one app implementation, two distribution formats.
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
let html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const prior=fs.readFileSync(path.join(root,'worklog-local.html'),'utf8');
const chart=[...prior.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(x=>x[1]).find(x=>x.length>100000&&/\.Chart=/.test(x));
if(!chart)throw Error('기존 로컬 파일의 Chart.js 번들을 찾지 못했습니다');
const core=fs.readFileSync(path.join(root,'worklog-core.js'),'utf8');
const data=JSON.parse(fs.readFileSync(path.join(root,'data/log.json'),'utf8'));
require('../worklog-core.js').months(data.months||data);
html=html.replace('<script src="worklog-core.js"></script>',()=>'<script>'+core+'</script>');
html=html.replace(/<script src="https:\/\/cdnjs.cloudflare.com\/ajax\/libs\/Chart.js\/[^\"]+"><\/script>/,()=>'<script>'+chart+'</script>');
html=html.replace("const res = await fetch('data/log.json?t=' + Date.now(), {cache:'no-store'});",()=>"const res = {ok:true,json:async()=> ("+JSON.stringify(data).replace(/</g,'\\u003c')+")};");
fs.writeFileSync(path.join(root,'worklog-local.html'),html);
console.log('worklog-local.html generated from index.html + shared rules + data (existing Chart bundle retained)');
