const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const W=require('../worklog-core.js');
function consoleRules(overrides={}){
  const code=fs.readFileSync(path.join(root,'cms-console.js'),'utf8').split('  /* ── 패널 ── */')[0];
  function XHR(){}XHR.prototype.open=function(){};XHR.prototype.setRequestHeader=function(){};
  const ctx={location:{hostname:'cms.unpa.me'},document:{getElementById:()=>null},window:{fetch:async()=>{throw Error('Unexpected network');}},XMLHttpRequest:XHR,alert:()=>{},AbortController,setTimeout,clearTimeout,URL,Set,...overrides};
  vm.createContext(ctx);
  vm.runInContext(code+`;globalThis.rules={gibberish,notBeauty,reviewText,stripSize,tokensOf,photoVerdict,findProduct,findBrand,classify,exbakOf,esc,suspensionOf,residueOf,tokenCover,validDate,lowEffort,bareName,isSwatch};globalThis.mock=(name,fn)=>{if(name==='get')get=fn;if(name==='imgDims')imgDims=fn;if(name==='delay')delay=fn;};})();`,ctx);
  ctx.mock('delay',async()=>{});return ctx;
}
test('all distribution scripts parse',()=>{
  for(const f of fs.readdirSync(root)){
    if(f.endsWith('.js'))new vm.Script(fs.readFileSync(path.join(root,f),'utf8'),{filename:f});
    if(f.endsWith('.html'))for(const m of fs.readFileSync(path.join(root,f),'utf8').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))new vm.Script(m[1],{filename:f});
  }
});
test('meaningful short text is not abusive; keyboard repetition is',()=>{
  const {rules:r}=consoleRules();
  for(const x of ['좋아요!!!','촉촉해요ㅎㅎㅎ','헤어 에센스라 머릿결이 부드러워요','ㅋㅋㅋ 잘 쓸게요'])assert.equal(r.gibberish(x),null,x);
  for(const x of ['ㅁㄴㅇㅁ냗ㅂㅈㄷ','가가가가거거거','asdfasdf'])assert.ok(r.gibberish(x),x);
  assert.equal(r.reviewText({contentText:'촉촉합니다',easyReviewFeedback:'촉촉합니다',reviewAnswers:[{answer:'촉촉합니다'}]}),'촉촉합니다');
});
test('explicit exclusions cannot be bypassed by allow words',()=>{
  const {rules:r}=consoleRules();
  for(const x of ['다이어트 콤부차','관절 영양제','아이 물티슈','파스텔 동전파스'])assert.ok(r.notBeauty(x),x);
  for(const x of ['링링 파스텔 네일','치약','여성청결제','비타민C','헤어 에센스 단백질 헤어 크림','클렌징 물티슈'])assert.equal(r.notBeauty(x),null,x);
});
test('packaging is removed but shade and strength are retained',()=>{
  const {rules:r}=consoleRules();
  assert.equal(r.stripSize('링링 파스텔 네일 10ml라임민트'),'링링 파스텔 네일 라임민트');
  for(const x of ['쿠션 21호','비타민C1000mg','1025 독도 토너'])assert.equal(r.stripSize(x),x);
});
test('full brand inventory + option lookup finds nail shade',async()=>{
  const c=consoleRules();const calls=[];
  c.mock('get',async url=>{calls.push(url);if(url.includes('brandId='))return {status:200,json:{total:1,results:[{id:1,name:'링링 파스텔 네일',brandId:4}]}};if(url.endsWith('/options'))return {status:200,json:{options:[{name:'라임민트'}]}};return {status:200,json:{id:1,name:'링링 파스텔 네일'}};});
  const p=await c.rules.findProduct(4,'링링 파스텔 네일 10 ml 라임민트');
  assert.equal(p.confident,true);assert.equal(p.option,'라임민트');assert.ok(calls.some(x=>x.endsWith('/options')));
});
test('omitted name words and collaborations are auto-confirmed',async()=>{
  for(const [user,name] of [['코쿤 드 세레니떼 필로우 미스트','코쿤 드 세레니떼 릴랙싱 필로우 미스트'],['올테이크 무드 라이크 팔레트','(페리페라X궁) 올테이크 무드 라이크 팔레트']]){
    const c=consoleRules();c.mock('get',async()=>({status:200,json:{total:1,results:[{id:1,name}]}}));
    const p=await c.rules.findProduct(1,user);assert.equal(p.confident,true);assert.equal(p.pick.name,name);
  }
});
test('lookup failure is not treated as absence',async()=>{
  const c=consoleRules();c.mock('get',async()=>({status:500,json:null}));
  const p=await c.rules.findProduct(1,'쿠션 미스트');
  assert.equal(p.lookupFailed,true);assert.equal(p.pick,null);assert.match(p.why,/조회 실패/);
});
test('normal review becomes approve candidate',async()=>{
  const c=consoleRules();c.mock('get',async url=>({status:200,json:{total:1,results:url.includes('/brands?')?[{id:4,name:'브랜드',approved:true}]:[{id:1,name:'쿠션',brandId:4}]}}));
  c.mock('imgDims',async()=>({w:2500,h:2500}));
  const item={id:10,brandName:'브랜드',productName:'쿠션'};
  const detail={userBlocked:false,userBlockedCount:5,productId:1,productImageUrl:'https://img.test/product',contentText:'촉촉해요!',attachments:['https://img.test/review']};
  const r=await c.rules.classify(item,detail);assert.equal(r.action,'approve');assert.equal(r.approvable,true);assert.equal(r.suspension.count,5);assert.equal(r.warn,'정지 이력 5회');
  const empty=await c.rules.classify(item,{...detail,attachments:[]});assert.equal(empty.approvable,false);
});
test('dates, numeric types and import validation',()=>{
  assert.equal(W.date('2026-02-30'),false);assert.equal(W.date('2026-09-02'),true);
  assert.throws(()=>W.months({'2026-09':{target:1,days:{'02':{r:'3',p:0}}}}));
  W.months(JSON.parse(fs.readFileSync(path.join(root,'data/log.json'),'utf8')).months);
});
test('currently suspended user goes directly to hide without photo/product inspection',async()=>{
  const c=consoleRules();c.mock('imgDims',async()=>{throw Error('Must not inspect photos');});
  const r=await c.rules.classify({id:7,userBlocked:true,userBlockedCount:2},{userBlocked:true,contentText:'정상적인 리뷰입니다',attachments:['https://example.test/photo']});
  assert.equal(r.action,'hide');assert.equal(r.exec,true);assert.equal(r.approvable,false);assert.equal(r.suspension.count,2);
});
test('released user with prior suspensions is still reviewed, not automatically approved',async()=>{
  const c=consoleRules();
  const r=await c.rules.classify({id:8,userBlocked:false,userBlockedCount:5},{userBlocked:false,contentText:'ㅁㄴㅇㅁ냗ㅂㅈㄷ'});
  assert.equal(r.suspension.blocked,false);assert.equal(r.suspension.count,5);assert.equal(r.action,'hide');assert.match(r.reasons.join(' '),/무의미/);
});
test('listing suspension state is used when detail omits it',async()=>{
  const c=consoleRules();const r=await c.rules.classify({id:9,userBlocked:true},{contentText:'좋아요'});
  assert.equal(r.action,'hide');assert.equal(r.suspension.blocked,true);
});
test('missing or conflicting suspension status cannot enter approval grid',async()=>{
  for(const [item,detail] of [[{id:1},{}],[{id:1,userBlocked:true},{userBlocked:false}],[{id:1,userBlocked:'false'},{}]]){
    const c=consoleRules();const r=await c.rules.classify(item,detail);assert.equal(r.action,'hold');assert.equal(r.approvable,false);
  }
});
test('audit merges same day, preserving previous success',()=>{
  const old={date:'2026-09-02',items:[{id:1,applied:true,action:'approve'}]};
  const next=W.mergeAudit(old,{date:old.date,items:[{id:1,applied:false,action:'hold'},{id:2,applied:false}]});
  assert.equal(next.items.length,2);assert.equal(next.items[0].applied,true);
});
test('cumulative worklog transfer counts each review once',()=>{
  const ledger={};const first=W.unappliedIds(['1','2'],ledger);first.forEach(id=>ledger[id]=true);
  assert.deepEqual(W.unappliedIds(['1','2','3','3'],ledger),['3']);
});

test('filler-only reviews are excluded, real short reviews are not',()=>{
  const {rules:r}=consoleRules();
  for(const x of ['좋아요','굿','짱','최고예요','좋아요 잘 쓸게요','추천합니다','만족합니다'])
    assert.ok(r.lowEffort(x),x);
  for(const x of ['촉촉하고 좋아요','향이 좋아요','발림성 최고','순하고 자극없어요',
                  '건성인데 잘 맞아요','머릿결이 부드러워졌어요'])
    assert.equal(r.lowEffort(x),null,x);
});
test('brand is matched despite notation differences, not sent to brand registration',async()=>{
  /* CMS 에는 "카밀(Kamil)" 로 있고 유저는 "카밀" 이라고 썼다 */
  const c=consoleRules();
  c.mock('get',async()=>({status:200,json:{total:1,results:[{id:7,name:'카밀(Kamil)',approved:true}]}}));
  const b=await c.rules.findBrand('카밀');
  assert.ok(b.approvedBrand,'표기가 달라도 브랜드를 찾아야 한다');
  assert.equal(b.approvedBrand.id,7);
  assert.ok(b.tier>1,'정확 일치가 아닌 단계로 잡힌다');
});
test('brand lookup failure is not reported as missing brand',async()=>{
  const c=consoleRules();
  c.mock('get',async()=>({status:500,json:null}));
  const b=await c.rules.findBrand('아무브랜드');
  assert.equal(b.lookupFailed,true);
  assert.equal(b.approvedBrand,null);
});
test('unapproved brand is separated from absent brand',async()=>{
  const c=consoleRules();
  c.mock('get',async()=>({status:200,json:{total:1,results:[{id:9,name:'신생브랜드',approved:false}]}}));
  const b=await c.rules.findBrand('신생브랜드');
  assert.equal(b.approvedBrand,null);
  assert.ok(b.unapproved,'미검수 브랜드는 따로 알려야 한다');
  assert.equal(b.unapproved.id,9);
});

test('removers are not swatch products',()=>{
  const {rules:r}=consoleRules();
  for(const x of ['본체청정 연 네일 에나멜 리무버','립앤아이 리무버','젤 리무버','포인트 메이크업 리무버'])
    assert.equal(r.isSwatch(x),null,x);
  for(const x of ['잉크 글래스팅 립글로스','프루티 스퀴즈 틴트','유에프오 커버 쿠션','링링 글리터 네일'])
    assert.ok(r.isSwatch(x),x);
});
