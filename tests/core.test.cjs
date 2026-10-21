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
  vm.runInContext(code+`;globalThis.rules={gibberish,notBeauty,reviewText,stripSize,tokensOf,photoVerdict,findProduct,findBrand,classify,exbakOf,esc,suspensionOf,residueOf,tokenCover,validDate,lowEffort,bareName,isSwatch,diceSim,looseCover,kindOf,badContent};globalThis.mock=(name,fn)=>{if(name==='get')get=fn;if(name==='imgDims')imgDims=fn;if(name==='delay')delay=fn;};})();`,ctx);
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

test('word order and spacing differences still find the same product',async()=>{
  /* 유저 "러브 라이트 하이드레이션 바디 로션" · CMS "바디러브 로션 라이트 하이드레이션" */
  const c=consoleRules();
  c.mock('get',async url=>{
    if(url.includes('/products?')) return {status:200,json:{total:2,results:[
      {id:1,name:'바디러브 로션 라이트 하이드레이션'},{id:2,name:'너리싱 오일 케어 샴푸'}]}};
    return {status:404,json:null};
  });
  const p=await c.rules.findProduct(1,'러브 라이트 하이드레이션 바디 로션');
  assert.equal(p.confident,true);
  assert.equal(p.pick.name,'바디러브 로션 라이트 하이드레이션');
  assert.match(p.why,/유사도/);
});
test('close candidates are handed to a person instead of guessing',async()=>{
  const c=consoleRules();
  c.mock('get',async url=>{
    if(url.includes('/products?')) return {status:200,json:{total:2,results:[
      {id:1,name:'바디러브 로션 라이트 핑크'},{id:2,name:'바디러브 로션 라이트 블루'}]}};
    return {status:404,json:null};
  });
  const p=await c.rules.findProduct(1,'바디러브 로션 라이트');
  assert.equal(p.confident,false,'우열이 없으면 자동으로 보내지 않는다');
  assert.match(p.why,/여러 건|사람이 선택/);
});
test('character similarity separates same product from different product',()=>{
  const {rules:r}=consoleRules();
  const n=s=>s.replace(/\s/g,'');
  assert.ok(r.diceSim(n('러브라이트하이드레이션바디로션'),n('바디러브로션라이트하이드레이션'))>=0.72);
  assert.ok(r.diceSim(n('러브라이트하이드레이션바디로션'),n('너리싱오일케어샴푸'))<0.3);
  assert.ok(r.diceSim(n('쿠션'),n('에센셜스킨누더쿠션'))<0.5,'짧은 입력이 아무 데나 붙지 않는다');
  assert.equal(r.looseCover(['러브','바디'],['바디러브','로션']),1,'단어가 서로를 품으면 겹친 것으로 본다');
});

test('different product types are never auto-matched by similarity',async()=>{
  for(const [user,cms] of [['레드 블레미쉬 클리어 수딩 크림','레드 블레미쉬 클리어 수딩 토너'],
                           ['자작나무 수분 크림','자작나무 수분 선크림'],
                           ['어성초 진정 수분 토너','어성초 진정 수분 토너 패드']]){
    const c=consoleRules();
    c.mock('get',async url=>url.includes('/products?')?{status:200,json:{total:1,results:[{id:1,name:cms}]}}:{status:404,json:null});
    const p=await c.rules.findProduct(1,user);
    assert.notEqual(p.confident,true,user+' → '+cms+' 로 자동 발송하면 안 된다');
    assert.match(p.why,/종류가 다름/);
  }
  const {rules:r}=consoleRules();
  assert.equal(r.kindOf('러브 라이트 하이드레이션 바디 로션'),r.kindOf('바디러브 로션 라이트 하이드레이션'),'도브는 같은 종류');
});
test('profanity, ads and contacts go to a person; ordinary negative or slang-free text does not',()=>{
  const {rules:r}=consoleRules();
  for(const x of ['존나 좋아요','씨발 최고','인스타 @beauty_shop','bit.ly/abc 구매','카톡 문의주세요','010-1234-5678','abc@gmail.com'])
    assert.ok(r.badContent(x),x);
  for(const x of ['이 제품 쓰레기임 돈아까움','피부 고민의 시발점','새끼발가락 각질 제거','모공이 꺼져 보여요','가성비 미친 제품','0.5톤 밝아짐','비타민 D3 1000 IU'])
    assert.equal(r.badContent(x),null,x);
});
test('price-only gap with a visible product image is not treated as broken image',()=>{
  const {rules:r}=consoleRules();
  assert.equal(r.exbakOf({productId:5,productPrice:0,productImageUrl:'https://images.unpa.me/1'}),null);
  assert.ok(r.exbakOf({productId:5,productPrice:null,productImageUrl:'https://images.unpa.me/null'}));
  assert.ok(r.exbakOf({productId:null,productPrice:1000,productImageUrl:'https://images.unpa.me/1'}));
});
test('color products that used to slip through are now swatch products',()=>{
  const {rules:r}=consoleRules();
  for(const x of ['눈썹문신 워터프루프 아이브로우 회갈색','브로우 펜슬','헤어 컬러 크림','셰이딩 스틱','하이라이팅 파우더 팩트','컬러 립 오일'])
    assert.ok(r.isSwatch(x),x);
  assert.equal(r.isSwatch('수분 크림'),null);
});

test('near-certain product matches still send a re-select request automatically',async()=>{
  const cases=[
    ['트라넥삼산 톤업 선 에센스','트라넥삼산 서플 톤업 선 에센스'],   /* 디어클래스 — 사용자가 든 사례 */
    ['씀바귀 진정 스킨','씀바귀 진정 토너'],
    ['큐어 하이드라 수딩 에멀전','큐어 하이드라 수딩 로션'],
    ['워터풀 톤업 썬크림','워터풀 퍼플 톤업 선크림'],
    ['바다포도 스킨 마스크','바다포도 스킨팩'],
    ['5알파 컨트롤 클리어링 폼클렌저','5알파 컨트롤 클리어링 클렌징 폼'],
  ];
  let id=0;
  for(const [user,cms] of cases){
    const c=consoleRules(); const pid=++id;
    c.mock('get',async url=>url.includes('/products?')?{status:200,json:{total:1,results:[{id:pid,name:cms}]}}:{status:404,json:null});
    const p=await c.rules.findProduct(1,user);
    assert.equal(p.confident,true,user+' → '+cms+' 는 자동이어야 한다 ('+p.why+')');
    assert.equal(p.pick.name,cms);
  }
});
test('essence/serum/ampoule differences go to the one-click button, not auto',async()=>{
  const c=consoleRules();
  c.mock('get',async url=>url.includes('/products?')?{status:200,json:{total:1,results:[{id:9,name:'귤타민 비타토닝 세럼'}]}}:{status:404,json:null});
  const p=await c.rules.findProduct(1,'귤타민 비타토닝 앰플');
  assert.equal(p.confident,false,'자동으로 보내지 않는다');
  assert.equal(p.pick.name,'귤타민 비타토닝 세럼','버튼으로 보낼 후보는 잡는다');
  assert.match(p.why,/종류 표기만 다름/);
});

test('partial search failure never turns into "missing" or an automatic pick',async()=>{
  /* 브랜드: 검색어 3개 중 일부만 성공 + 못 찾음 → 없음이 아니라 확인 불가, 캐시하지 않는다 */
  let n=0;const c=consoleRules();
  c.mock('get',async()=>{ n++; return n===1?{status:500,json:null}:{status:200,json:{total:0,results:[]}}; });
  const b=await c.rules.findBrand('부분실패 브랜드');
  assert.equal(b.lookupFailed,true,'일부 검색이 실패했으면 없다고 단정하지 않는다');
  c.mock('get',async()=>({status:200,json:{total:1,results:[{id:3,name:'부분실패 브랜드',approved:true}]}}));
  assert.equal((await c.rules.findBrand('부분실패 브랜드')).approvedBrand.id,3,'실패 결과는 캐시되지 않아 다시 찾는다');
  /* 제품: 전체 이름 검색이 실패하고 낱말 검색만 성공 → 유사 후보를 자동 확정하지 않는다 */
  const p=consoleRules(); let k=0;
  p.mock('get',async()=>{ k++; return k===1?{status:500,json:null}:{status:200,json:{total:1,results:[{id:1,name:'바디러브 로션 라이트 하이드레이션'}]}}; });
  const r=await p.rules.findProduct(1,'러브 라이트 하이드레이션 바디 로션');
  assert.notEqual(r.confident,true); assert.match(r.why,/일부 검색 실패/);
  const q=consoleRules(); let m=0;
  q.mock('get',async()=>{ m++; return m===1?{status:500,json:null}:{status:200,json:{total:0,results:[]}}; });
  const none=await q.rules.findProduct(1,'없는 제품 크림');
  assert.equal(none.lookupFailed,true,'상품등록 필요로 보내 중복 등록하게 만들지 않는다');
  const e=consoleRules(); let x=0;
  e.mock('get',async()=>{ x++; return x===2?{status:500,json:null}:{status:200,json:{total:1,results:[{id:4,name:'수분 크림'}]}}; });
  assert.equal((await e.rules.findProduct(1,'수분 크림')).confident,true,'정확히 일치하면 일부 실패여도 확정');
  assert.equal((await consoleRules().rules.findProduct(1,'')).lookupFailed,true,'제품명이 없으면 확인으로');
});

/* ── 업무일지 자동 반영 규칙 ─────────────────────────────── */
function monthOf(m,days){const n=new Date(Date.UTC(+m.slice(0,4),+m.slice(5,7),0)).getUTCDate(),d={};for(let i=1;i<=n;i++)d[String(i).padStart(2,'0')]={r:0,p:0,memo:'',unreg:''};Object.assign(d,days||{});return {month:m,target:1450000,days:d};}
test('auto sync fills the real work day, keeps what was typed before, and never double counts',()=>{
  const base={'2026-09':monthOf('2026-09',{'10':{r:172,p:25,memo:'m',unreg:''},'11':{r:13,p:7,memo:'',unreg:''},'28':{r:9,p:0,memo:'',unreg:''}}),
              '2026-08':monthOf('2026-08',{'31':{r:200,p:3,memo:'',unreg:''}})};
  const work={v:1,from:'2026-09-01',to:'2026-09-27',
    reviews:[...Array.from({length:8},(_,i)=>[String(100+i),'2026-09-10']),...Array.from({length:171},(_,i)=>[String(200+i),'2026-09-11']),['999','2026-08-31'],['998','2026-09-28']],
    products:[['1','2026-09-11'],['2','2026-09-11']]};
  const r=W.applyWork(base,work);
  const d=r.months['2026-09'].days;
  assert.equal(d['10'].r,8); assert.equal(d['11'].r,171,'9/10 리뷰를 9/11 에 했으면 9/11');
  assert.deepEqual(d['10'].manual,{r:172,p:25},'전에 적은 값은 남긴다');
  assert.equal(d['10'].memo,'m','메모는 그대로');
  assert.equal(d['10'].p,0); assert.equal(d['11'].p,2);
  assert.equal(r.months['2026-08'].days['31'].r,200,'자동 반영 시작일 전은 건드리지 않는다');
  assert.equal(d['28'].r,9,'오늘 이후는 건드리지 않는다');
  assert.equal(r.today.d,'2026-09-27');
  assert.ok(r.changes.some(c=>c.d==='2026-09-10'&&c.r[0]===172&&c.r[1]===8));
  const again=W.applyWork(r.months,work);
  assert.equal(again.changes.length,0,'같은 자료를 다시 받아도 그대로');
  assert.equal(again.months['2026-09'].days['11'].r,171);
  /* 사람이 다른 숫자를 적어 두어도 CMS 건수로 바로잡는다 */
  again.months['2026-09'].days['11'].r=175;
  const more=Object.assign({},work,{reviews:work.reviews.concat([['500','2026-09-11']])});
  const r3=W.applyWork(again.months,more);
  assert.equal(r3.months['2026-09'].days['11'].r,172,'CMS 171 + 새로 1 = 172 (직접 적은 175 는 무시)');
  assert.deepEqual(r3.months['2026-09'].days['11'].manual,{r:175,p:2},'바로잡기 전 값은 남긴다');
  /* 장부는 줄지 않는다 — 조회 범위에서 빠진 날도 그대로 */
  const r4=W.applyWork(r3.months,{v:1,from:'2026-09-01',to:'2026-09-27',reviews:[],products:[]});
  assert.equal(r4.months['2026-09'].days['10'].r,8); assert.equal(r4.changes.length,0);
  assert.throws(()=>W.applyWork(base,{v:1,from:'2026-09-01',to:'2026-09-27',reviews:[['x','2026-09-01']]}),/항목/);
  assert.throws(()=>W.applyWork(base,{v:2}),/형식/);
});
test('sync store keeps history, marks months for server upload, refuses a corrupt store',()=>{
  const now=new Date('2026-09-27T12:00:00Z');
  const work={v:1,from:'2026-09-01',to:'2026-09-27',reviews:[['1','2026-09-27']],products:[]};
  const base={v:1,months:{'2026-08':monthOf('2026-08',{'01':{r:5,p:0,memo:'',unreg:''}})},dirty:[]};
  const r=W.syncStore(null,work,base,now);
  const o=JSON.parse(r.value);
  assert.equal(o.months['2026-08'].days['01'].r,5,'처음 쓰는 브라우저면 저장소 기록부터 깐다');
  assert.equal(o.months['2026-09'].days['27'].r,1);
  assert.ok(o.dirty.includes('2026-09')); assert.equal(o.months['2026-09']._u,now.toISOString());
  assert.throws(()=>W.syncStore('{broken',work,null,now),'깨진 기록 위에 덮어쓰지 않는다');
  const a1=W.syncAudit(null,{'2026-09-24':{items:[{id:1,applied:true,action:'approve'}],executions:[{id:1,action:'approve',at:'t1'}]}},now);
  const a2=W.syncAudit(a1.value,{'2026-09-24':{items:[{id:1,applied:false,action:'approve'},{id:2,applied:false,action:'hold'}],executions:[{id:1,action:'approve',at:'t1'}]}},now);
  const day=JSON.parse(a2.value).days['2026-09-24'];
  assert.equal(day.items.length,2); assert.equal(day.items.find(x=>x.id===1).applied,true,'처리됨은 되돌리지 않는다');
  assert.equal(day.executions.length,1,'같은 실행 기록은 한 번만');
});

test('audit history keeps only recent days so the browser store does not fill up',()=>{
  const now=new Date('2026-09-27T12:00:00Z');
  const days={};for(let i=1;i<=5;i++)days['2026-09-0'+i]={items:[{id:i,applied:true,action:'approve'}]};
  const r=W.syncAudit(null,days,now,3);
  assert.deepEqual(Object.keys(JSON.parse(r.value).days).sort(),['2026-09-03','2026-09-04','2026-09-05']);
  assert.deepEqual(r.dropped,['2026-09-01','2026-09-02']);
});

/* ── 여러 컴퓨터 합치기 · 서버 동기화 ─────────────────────── */
function fakeCloud(){
  const rows={};
  return { rows,
    pull:async keys=>keys.filter(k=>rows[k]).map(k=>({month:k,data:JSON.parse(JSON.stringify(rows[k].data)),updated_at:rows[k].updated_at})),
    push:async list=>{ for(const r of list) rows[r.month]={data:JSON.parse(JSON.stringify(r.data)),updated_at:r.updated_at}; },
    skewMs:0, skew:async function(){ return this.skewMs; },
    /* 서버의 '안 바뀌었으면 쓰기': 없을 때만 insert, 있으면 nonce 가 같을 때만 update */
    list:async prefix=>Object.keys(rows).filter(k=>k.indexOf(prefix)===0).map(k=>({month:k,data:JSON.parse(JSON.stringify(rows[k].data))})),
    claim:async (K,expect,data)=>{ const cur=rows[K]&&rows[K].data;
      if(!expect){ if(cur) return false; rows[K]={data:JSON.parse(JSON.stringify(data)),updated_at:'x'}; return true; }
      if(!cur || (cur.nonce==null ? expect.nonce!=null : cur.nonce!==expect.nonce)) return false;
      rows[K]={data:JSON.parse(JSON.stringify(data)),updated_at:'x'}; return true; } };
}
test('office and home ledgers are merged without losing either side',()=>{
  const office=W.applyWork({},{v:1,from:'2026-09-01',to:'2026-09-27',reviews:[['1','2026-09-25'],['2','2026-09-25']],products:[['9','2026-09-25']]}).months['2026-09'];
  const home=W.applyWork({},{v:1,from:'2026-09-01',to:'2026-09-27',reviews:[['2','2026-09-25'],['3','2026-09-25'],['4','2026-09-26']],products:[]}).months['2026-09'];
  home.days['26'].memo='집에서 메모'; home.days['26']._t=Date.parse('2026-09-27T10:00:00Z');
  home.days['25'].r+=2; home.days['25']._t=Date.parse('2026-09-27T11:00:00Z');   /* 집에서 +2 조정 */
  office.days['25'].memo='회사 메모'; office.days['25']._t=Date.parse('2026-09-27T09:00:00Z');
  const m=W.mergeMonth(office,home);
  assert.equal(m.days['25'].auto.r,3,'장부는 합집합 (1,2,3)');
  assert.equal(m.days['25'].r,3,'직접 고친 +2 는 무시하고 합친 장부(CMS) 건수');
  assert.equal(m.days['25'].memo,'회사 메모','메모가 비어 있지 않은 쪽을 남긴다');
  assert.equal(m.days['26'].r,1); assert.equal(m.days['26'].memo,'집에서 메모');
  assert.equal(m.days['25'].p,1);
  assert.deepEqual(W.mergeMonth(home,office).days['25'].auto,m.days['25'].auto,'순서를 바꿔도 장부는 같다');
});
test('console experience from two computers merges: learned names, sends, done marks, fingerprints',()=>{
  const a={alias:{'5|미러블러':{pid:1,name:'A',n:1,t:'2026-09-20'}},sent:{'100':{action:'revise_product',at:'2026-09-20T01:00:00Z',rn:1}},
           done:{'7':{at:'2026-09-20T00:00:00Z'}},texts:{h1:{id:'10',d:'2026-09-10',t:'2026-09-10'}},gate:[{t:'2026-09-20',d:'x'}]};
  const b={alias:{'5|미러블러':{pid:2,name:'B',n:3,t:'2026-09-19'},'6|x':{pid:3,name:'C',n:1,t:'2026-09-21'}},
           sent:{'100':{action:'approve',at:'2026-09-25T01:00:00Z',u:'nick'},'101':{action:'hide',at:'2026-09-25T02:00:00Z'}},
           done:{'7':{off:true,at:'2026-09-21T00:00:00Z'}},texts:{h1:{id:'11',d:'2026-09-12',t:'2026-09-12'}},gate:[{t:'2026-09-21',d:'y'}]};
  const m=W.mergeConsole(a,b);
  assert.equal(m.alias['5|미러블러'].pid,2,'더 여러 번 확인된 연결을 쓴다'); assert.ok(m.alias['6|x']);
  assert.equal(m.sent['100'].action,'approve'); assert.equal(m.sent['100'].rn,1,'수정요청 횟수는 잃지 않는다'); assert.equal(m.sent['100'].u,'nick');
  assert.ok(m.sent['101']);
  assert.equal(m.done['7'].off,true,'나중에 해제한 것이 이긴다');
  assert.equal(m.texts.h1.id,'10','먼저 올라온 리뷰가 원본'); assert.equal(m.gate.length,2);
});
test('cloud sync: two computers converge through the server and nothing is lost',async()=>{
  const cloud=fakeCloud();
  const now1='2026-09-27T09:00:00.000Z', now2='2026-09-27T20:00:00.000Z';
  const offWork={v:1,from:'2026-09-01',to:'2026-09-27',reviews:[['1','2026-09-27','라운드랩','독도 토너','2026-09-24','c']],products:[['9','2026-09-27','오릭스','라데나 로션']]};
  const off=W.applyWork({},offWork);
  const r1=await W.cloudSync(cloud,{now:now1,months:off.months,touchedMonths:off.touched,evidence:W.evidenceFrom(offWork),touchedEv:['2026-09'],
    audit:{'2026-09-24':{date:'2026-09-24',items:[{id:1,action:'approve',applied:true}]}},pending:[{id:5,brand:'b',product:'p',action:'register_product'}],
    console:{alias:{'5|a':{pid:1,name:'A',n:1,t:now1}},sent:{'1':{action:'approve',at:now1}}},sentMonths:['2026-09','2026-08']});
  assert.ok(r1.pushed.includes('2026-09')&&r1.pushed.includes('~ev:2026-09')&&r1.pushed.includes('~audit:2026-09-24')&&r1.pushed.includes('~learn')&&r1.pushed.includes('~sent:2026-09'));
  /* 집: 다른 리뷰를 처리했고 콘솔 경험도 따로 있다 */
  const homeWork={v:1,from:'2026-09-01',to:'2026-09-27',reviews:[['2','2026-09-27','헤라','글로스','2026-09-26','m']],products:[]};
  const home=W.applyWork({},homeWork);
  const r2=await W.cloudSync(cloud,{now:now2,months:home.months,touchedMonths:home.touched,evidence:W.evidenceFrom(homeWork),touchedEv:['2026-09'],
    audit:{'2026-09-24':{date:'2026-09-24',items:[{id:2,action:'hold',applied:false}]}},
    console:{alias:{'6|b':{pid:2,name:'B',n:1,t:now2}},sent:{'2':{action:'approve',at:now2}}},sentMonths:['2026-09','2026-08']});
  assert.equal(r2.months['2026-09'].days['27'].r,2,'회사 1 + 집 1');
  assert.equal(r2.months['2026-09'].days['27'].p,1);
  assert.deepEqual(Object.keys(r2.evidence['2026-09'].r['27']).sort(),['1','2']);
  assert.equal(r2.evidence['2026-09'].r['27']['1'][3],'c');
  assert.equal(r2.audit['2026-09-24'].items.length,2);
  assert.ok(r2.console.alias['5|a']&&r2.console.alias['6|b'],'배운 것이 합쳐져 돌아온다');
  assert.ok(r2.console.sent['1']&&r2.console.sent['2'],'다른 컴퓨터의 전송 기록도 돌아온다');
  assert.equal(cloud.rows['2026-09'].data.days['27'].r,2,'서버에도 합친 값');
  assert.equal(cloud.rows['~pending'].data.items.length,1);
});
function fakeStore(){ const m={}; return { m, getItem:k=>m[k]==null?null:m[k], setItem:(k,v)=>{m[k]=String(v);}, removeItem:k=>{delete m[k];} }; }
test('sync window: office and home browsers end up with the same worklog through the server',async()=>{
  const cloud=fakeCloud(), office=fakeStore(), home=fakeStore();
  /* 집 브라우저는 로그인 전에 직접 적어 둔 8월 기록이 있다 */
  home.setItem('unpa-worklog-v1',JSON.stringify({v:1,months:{'2026-08':monthOf('2026-08',{'20':{r:150,p:3,memo:'직접',unreg:''}})},dirty:[]}));
  const payload=(rv,con)=>({v:1,seq:1,work:{v:1,from:'2026-09-01',to:'2026-09-27',reviews:rv,products:[]},audit:{},pending:[{id:'9',d:'2026-09-24',brand:'b',product:'p',action:'register_product'}],console:con});
  const r1=await W.syncWindow(office,payload([['1','2026-09-27','A','a','2026-09-24','c']],{alias:{'1|x':{pid:1,name:'X',n:1,t:'t1'}},sent:{'1':{action:'approve',at:'2026-09-27T01:00:00Z'}}}),cloud,{uid:'u1',now:new Date('2026-09-27T10:00:00Z')});
  assert.equal(r1.cloud,'on');
  const r2=await W.syncWindow(home,payload([['2','2026-09-27','B','b','2026-09-24','m']],{alias:{'2|y':{pid:2,name:'Y',n:1,t:'t2'}},sent:{}}),cloud,{uid:'u1',now:new Date('2026-09-27T20:00:00Z')});
  assert.equal(r2.today.r,1,'집 화면 오늘 값(이 브라우저 집계)'); 
  const homeStore=JSON.parse(home.getItem('unpa-worklog-v2:u1'));
  assert.equal(homeStore.months['2026-09'].days['27'].r,2,'서버와 합친 뒤 회사 1 + 집 1');
  assert.equal(homeStore.months['2026-08'].days['20'].r,150,'로그인 전 기록이 계정으로 옮겨졌다');
  assert.equal(cloud.rows['2026-08'].data.days['20'].memo,'직접','옮긴 기록이 서버에도 올라간다');
  assert.ok(r2.console.alias['1|x']&&r2.console.alias['2|y'],'콘솔 경험이 합쳐져 돌아온다');
  assert.equal(home.getItem('unpa-worklog-active'),'unpa-worklog-v2:u1');
  /* 회사가 다시 동기화하면 집의 것도 받아 온다 */
  await W.syncWindow(office,payload([],{}),cloud,{uid:'u1',now:new Date('2026-09-28T09:00:00Z')});
  const off=JSON.parse(office.getItem('unpa-worklog-v2:u1'));
  assert.equal(off.months['2026-09'].days['27'].r,2);
  const ev=JSON.parse(office.getItem('unpa-evidence-v1'));
  assert.deepEqual(Object.keys(ev.months['2026-09'].r['27']).sort(),['1','2'],'작업 증빙도 양쪽 것이 모인다');
  assert.equal(JSON.parse(office.getItem('unpa-pending-v1')).items.length,1);
});
test('sync window without login keeps everything on this browser and says so',async()=>{
  const s=fakeStore();
  const r=await W.syncWindow(s,{v:1,gk:7,device:'dev00001',seq:1,work:{v:1,from:'2026-09-01',to:'2026-09-27',reviews:[['1','2026-09-27','A','a','2026-09-24','c']],products:[]},audit:{'2026-09-24':{items:[{id:1,action:'approve',applied:true}]}}},null,{now:new Date('2026-09-27T10:00:00Z')});
  assert.equal(r.cloud,'off'); assert.equal(r.console,null);
  assert.equal(JSON.parse(s.getItem('unpa-worklog-v1')).months['2026-09'].days['27'].r,1);
  assert.ok(JSON.parse(s.getItem('unpa-audit-v1')).days['2026-09-24']);
  const failing={pull:async()=>{throw Error('network down');},push:async()=>{}};
  const r2=await W.syncWindow(s,{v:1,gk:7,device:'dev00001',seq:2,work:{v:1,from:'2026-09-01',to:'2026-09-27',reviews:[],products:[]}},failing,{uid:'u1',now:new Date('2026-09-27T11:00:00Z')});
  assert.match(r2.cloud,/^error: network down/,'서버가 안 돼도 이 브라우저 반영은 된다'); assert.equal(r2.ok,true);
});
test('abbreviated words find the registered product; different types or two candidates do not',async()=>{
  const run=async(user,names)=>{const c=consoleRules();c.mock('get',async()=>({status:200,json:{total:names.length,results:names.map((n,i)=>({id:i+1,name:n}))}}));return c.rules.findProduct(9,user);};
  let r=await run('미러 블러 멜팅 에센스',['미러링 블러 멜팅팟 에센스','미러링 블러 쿠션']);
  assert.equal(r.confident,true); assert.equal(r.pick.name,'미러링 블러 멜팅팟 에센스'); assert.match(r.why,/줄여/);
  r=await run('수분 크림',['수분충전 크림젤']); assert.notEqual(r.confident,true,'종류가 다르면(크림↔젤) 붙이지 않는다');
  r=await run('블루 세럼',['블루베리 세럼','블루라인 세럼']); assert.notEqual(r.confident,true,'후보가 둘이면 사람이');
  r=await run('블루 세럼',['블루베리 세럼','블루베리 크림']); assert.equal(r.confident,true);
});
test('remaining CMS reviews get their old verdicts back, so registration work is never shown as done',async()=>{
  const audit={days:{'2026-09-20':{items:[{id:475207,action:'register_brand',brand:'새브랜드',product:'새 크림',reason:'브랜드 없음',applied:false,manual_done:'t'},
                                        {id:475198,action:'approve',applied:false},{id:1,action:'approve',applied:true}]},
                     '2026-09-18':{items:[{id:475207,action:'hold',applied:false}]}}};
  const v=W.verdictsFor(audit,[{id:'475207',d:'2026-09-20'},{id:'475198',d:'2026-09-20'},{id:'477410',d:'2026-09-28'}]);
  assert.equal(v['475207'].action,'register_brand','가장 최근 판정'); assert.equal(v['475207'].manual_done,'t');
  assert.equal(v['475198'].action,'approve'); assert.equal(v['477410'],undefined,'판정 전');
  const s=fakeStore(); s.setItem('unpa-audit-v1',JSON.stringify({v:1,days:audit.days}));
  const r=await W.syncWindow(s,{v:1,gk:7,device:'dev00001',seq:1,work:{v:1,from:'2026-09-01',to:'2026-09-29',reviews:[],products:[]},pending:[],backlog:[{id:'475207',d:'2026-09-20',brand:'b',product:'p',status:'PENDING',blocked:false}]},null,{now:new Date('2026-09-29T12:00:00Z')});
  assert.equal(r.verdicts['475207'].action,'register_brand');
  assert.equal(JSON.parse(s.getItem('unpa-pending-v1')).backlog.length,1,'CMS 남은 목록을 업무일지에 둔다');
});
test('a changed monthly target carries into new months and wins on the computer that changed it last',()=>{
  const base={'2026-09':Object.assign(monthOf('2026-09'),{target:1800000,_t:5})};
  const r=W.applyWork(base,{v:1,from:'2026-09-01',to:'2026-10-02',reviews:[['1','2026-10-01']],products:[]});
  assert.equal(r.months['2026-10'].target,1800000,'새로 생긴 10월도 9월 목표를 이어받는다');
  assert.equal(W.applyWork({},{v:1,from:'2026-09-01',to:'2026-09-02',reviews:[],products:[]}).months['2026-09'].target,1450000,'처음에만 기본값');
  const a=Object.assign(monthOf('2026-10'),{target:1800000,_t:10}), b=Object.assign(monthOf('2026-10'),{target:2000000,_t:20});
  assert.equal(W.mergeMonth(a,b).target,2000000,'나중에 고친 목표'); assert.equal(W.mergeMonth(b,a).target,2000000);
});

test('a wrong number typed by hand is corrected to the CMS count on the next sync (9/30: 200 → 47)',()=>{
  const reviews=Array.from({length:47},(_,i)=>[String(9000+i),'2026-09-30']);
  const first=W.applyWork({},{v:1,from:'2026-09-01',to:'2026-09-30',reviews,products:[]});
  const m=first.months;
  assert.equal(m['2026-09'].days['30'].r,47);
  m['2026-09'].days['30'].r=200; m['2026-09'].days['30']._t=Date.now();     /* 업무일지에서 200 으로 고쳐 둠 */
  const again=W.applyWork(m,{v:1,from:'2026-09-01',to:'2026-09-30',reviews,products:[]});
  assert.equal(again.months['2026-09'].days['30'].r,47,'콘솔 동기화가 CMS 47건으로 바로잡는다');
  assert.equal(again.today.r,47);
  assert.deepEqual(again.months['2026-09'].days['30'].manual,{r:200,p:0});
  assert.ok(again.changes.some(c=>c.d==='2026-09-30'&&c.r[0]===200&&c.r[1]===47),'바뀐 날 목록에 200→47');
  /* 다른 컴퓨터 기록과 합칠 때도 200 이 되살아나지 않는다 */
  const other=JSON.parse(JSON.stringify(m['2026-09'])); other.days['30']._t=Date.now()+1000;
  assert.equal(W.mergeMonth(again.months['2026-09'],other).days['30'].r,47);
  /* 서버 기록과 합치는 단계에서 바로잡혀도 무엇을 고쳤는지 남긴다 */
  const typed=JSON.parse(JSON.stringify(first.months['2026-09'])); typed.days['30'].r=200; typed.days['30']._t=Date.now()+5000;
  const merged=W.mergeMonth(typed,first.months['2026-09']);
  assert.equal(merged.days['30'].r,47); assert.deepEqual(merged.days['30'].manual,{r:200,p:0});
});

test('the sync window hands the console this month\'s target and income',async()=>{
  const s=fakeStore();
  s.setItem('unpa-worklog-v1',JSON.stringify({v:1,months:{'2026-09':Object.assign(monthOf('2026-09'),{target:1430000})},dirty:[]}));
  const r=await W.syncWindow(s,{v:1,gk:7,device:'dev00001',seq:1,work:{v:1,from:'2026-09-01',to:'2026-09-30',reviews:[['1','2026-09-30'],['2','2026-09-29']],products:[['9','2026-09-29']]}},null,{now:new Date('2026-09-30T12:00:00Z')});
  assert.deepEqual({...r.goal,ids:undefined},{month:'2026-09',target:1430000,r:2,p:1,won:1600,ids:undefined,countedAt:null,lease:null});
  /* 이번 달 수입에 이미 들어간 번호 — 목표 가드가 같은 승인을 두 번 세지 않게 */
  assert.deepEqual([...r.goal.ids.r].sort(),['1','2']); assert.deepEqual(r.goal.ids.p,['9']);
});
test('remaining reviews per even date fill the 미등록 제품수 column without erasing notes',()=>{
  const base={'2026-09':monthOf('2026-09',{'14':{r:0,p:0,memo:'',unreg:'유민지'},'20':{r:0,p:0,memo:'',unreg:'24'},'26':{r:0,p:0,memo:'',unreg:'5'},'30':{r:47,p:0,memo:'',unreg:'이월'}})};
  const remain={at:'2026-10-09T13:00:00Z',days:{'2026-09-14':{n:3,reg:0,upd:0,blocked:0},'2026-09-20':{n:17,reg:15,upd:1,blocked:0},
                '2026-09-26':{n:0,reg:0,upd:0,blocked:0},'2026-09-30':{n:32,reg:4,upd:0,blocked:2},'2026-08-14':{n:2,reg:0,upd:1,blocked:1}}};
  const touched=W.applyRemain(base,remain);
  const d=base['2026-09'].days;
  assert.equal(d['20'].unreg,'17','숫자 칸은 CMS 건수로'); assert.equal(d['20'].pend.reg,15);
  assert.equal(d['26'].unreg,'','남은 게 없으면 비운다');
  assert.equal(d['14'].unreg,'유민지','메모는 그대로'); assert.equal(d['14'].pend.n,3,'건수는 따로 둔다');
  assert.equal(d['30'].unreg,'이월'); assert.equal(d['30'].pend.n,32);
  assert.equal(d['30'].r,47,'리뷰 수는 건드리지 않는다');
  assert.equal(base['2026-08'].days['14'].unreg,'2','지난달 짝수일도'); assert.equal(base['2026-08'].target,1450000);
  assert.ok(touched.includes('2026-09')&&touched.includes('2026-08'));
  assert.deepEqual(W.applyRemain(base,remain),[],'같은 결과를 다시 받으면 바뀐 달 없음');
  /* 두 컴퓨터: 더 최근에 CMS 를 훑은 쪽의 건수 */
  const older=JSON.parse(JSON.stringify(base['2026-09'])); older.days['20'].pend={n:20,reg:15,upd:1,blocked:0,at:'2026-10-01T00:00:00Z'}; older.days['20'].unreg='20';
  assert.equal(W.mergeMonth(older,base['2026-09']).days['20'].unreg,'17');
  assert.equal(W.mergeMonth(base['2026-09'],older).days['20'].unreg,'17');
});
test('the sync window writes remaining counts into the worklog',async()=>{
  const s=fakeStore();
  s.setItem('unpa-worklog-v1',JSON.stringify({v:1,months:{'2026-10':monthOf('2026-10')},dirty:[]}));
  await W.syncWindow(s,{v:1,gk:7,device:'dev00001',seq:1,work:{v:1,from:'2026-09-01',to:'2026-10-09',reviews:[],products:[]},remain:{at:'2026-10-09T13:00:00Z',days:{'2026-10-08':{n:13,reg:2,upd:0,blocked:0}}}},null,{now:new Date('2026-10-09T13:00:00Z')});
  const o=JSON.parse(s.getItem('unpa-worklog-v1'));
  assert.equal(o.months['2026-10'].days['08'].unreg,'13'); assert.ok(o.dirty.includes('2026-10'));
});
test('long genuine reviews are not "same syllable" gibberish; small photos alone do not hide a review',async()=>{
  const c=consoleRules();
  const long='요즘 데일리 베이스 메이크업으로 사용하기 좋은 헤라 실키스테이 파운데이션이에요. '.repeat(12);
  assert.equal(c.rules.gibberish(long),null,'600자 넘는 정상 리뷰');
  assert.ok(c.rules.gibberish('가가가가거거거거가가'),'짧은 반복은 여전히 잡는다');
  assert.ok(c.rules.gibberish('좋아요좋아요좋아요좋아요좋아요좋아요좋아요좋아요좋아요좋아요좋아요'),'글자 종류가 아주 적으면 길어도 잡는다');
  c.mock('get',async url=>({status:200,json:{total:1,results:url.includes('/brands?')?[{id:4,name:'브랜드',approved:true}]:[{id:1,name:'쿠션',brandId:4}]}}));
  c.mock('imgDims',async()=>({w:650,h:862}));
  const r=await c.rules.classify({id:11,brandName:'브랜드',productName:'쿠션'},{userBlocked:false,userBlockedCount:0,productId:1,productImageUrl:'https://img.test/p',productPrice:1000,contentText:'장미향 좋아해서 골라봤는데 생각보다 향이 부담스럽지 않고 은은하게 퍼져서 좋았어요.',attachments:['https://img.test/a','https://img.test/b']});
  assert.equal(r.action,'approve','사진이 작아도 미노출하지 않고 그리드로'); assert.equal(r.approvable,true);
  assert.match(r.reasons.join(' '),/눈으로 확인/);
});
test('merging console experience keeps hide corrections from the other computer',()=>{
  const m=W.mergeConsole({hidefp:{'1':{k:'low',st:'suggested',at:'2026-10-01'}}},{hidefp:{'1':{k:'low',st:'override',at:'2026-10-02'},'2':{k:'photo-web',st:'override',at:'2026-10-02'}}});
  assert.equal(m.hidefp['1'].st,'override'); assert.ok(m.hidefp['2']);
});

test('review exceptions merge per review, the later edit wins, nothing is lost across devices',()=>{
  const C=require('../worklog-core.js');
  const work={v:1,items:{'478541':{id:'478541',kind:'not_reviewable',status:'listed',at:'2026-10-13T10:00:00Z'},
                         '478414':{id:'478414',kind:'no_price',status:'hold',at:'2026-10-13T10:00:00Z'}}};
  const home={v:1,items:{'478541':{id:'478541',kind:'not_reviewable',status:'sent',at:'2026-10-13T11:00:00Z'},
                         '478416':{id:'478416',kind:'overseas',status:'done',at:'2026-10-13T09:00:00Z'}}};
  const m=C.mergeExceptions(work,home);
  assert.equal(Object.keys(m.items).length,3,'양쪽 항목이 모두 남는다');
  assert.equal(m.items['478541'].status,'sent','나중에 고친 상태가 이긴다');
  assert.deepEqual(C.mergeExceptions(null,home).items,home.items);
  assert.deepEqual(C.mergeExceptions(work,undefined).items,work.items);
});

test('a review id is counted on one day only: the console outbox day and the CMS approval day may differ, and a re-approval moves it',async()=>{
  const s=fakeStore();
  s.setItem('unpa-worklog-v1',JSON.stringify({v:1,months:{'2026-10':Object.assign(monthOf('2026-10'),{target:1000})},dirty:[]}));
  /* CMS 집계는 18일, 콘솔 보관함(내 컴퓨터 시계)은 19일로 같은 리뷰를 넘김 */
  let r=await W.syncWindow(s,{v:1,gk:7,device:'dev00001',seq:1,work:{v:1,from:'2026-10-01',to:'2026-10-19',reviews:[['1','2026-10-18'],['1','2026-10-19'],['2','2026-10-05']],products:[]}},null,{now:new Date('2026-10-19T12:00:00Z')});
  assert.equal(r.goal.won,1000,'두 건 — 1번을 두 번 세지 않는다'); assert.deepEqual([...r.goal.ids.r].sort(),['1','2']);
  /* 2번이 다시 대기로 돌아왔다가 19일에 또 승인됨 → 19일로 옮겨 한 번만 */
  r=await W.syncWindow(s,{v:1,gk:7,device:'dev00001',seq:2,work:{v:1,from:'2026-10-01',to:'2026-10-19',reviews:[['2','2026-10-19']],products:[]}},null,{now:new Date('2026-10-19T13:00:00Z')});
  assert.equal(r.goal.won,1000); assert.equal(r.goal.r,2);
});

test('merging with another computer keeps one day per review id (an old copy elsewhere does not come back), and old duplicates are cleaned on the next sync',()=>{
  const mk=(auto)=>{const m=monthOf('2026-10');m.target=1000;m._auto={r:auto,p:{}};for(const dd of Object.keys(auto)){m.days[dd].r=auto[dd].length;m.days[dd].auto={r:auto[dd].length,p:0};}return m;};
  const merged=W.mergeMonth(mk({'19':['2']}),mk({'05':['2'],'06':['3']}));
  assert.deepEqual(merged._auto.r['05'],[]); assert.deepEqual(merged._auto.r['19'],['2']); assert.deepEqual(merged._auto.r['06'],['3']);
  assert.equal(merged.days['05'].r,0); assert.equal(merged.days['19'].r,1);
  /* 예전 버전이 18일·19일 두 곳에 남긴 1번 — CMS 가 19일이라고 하면 18일 사본을 지운다 */
  const out=W.applyWork({'2026-10':mk({'18':['1'],'19':['1']})},{v:1,from:'2026-10-01',to:'2026-10-19',reviews:[['1','2026-10-19']],products:[]});
  assert.deepEqual(out.months['2026-10']._auto.r['18'],[]); assert.deepEqual(out.months['2026-10']._auto.r['19'],['1']);
  assert.equal(out.months['2026-10'].days['18'].r,0); assert.equal(out.months['2026-10'].days['19'].r,1);
});

test('with the cloud on, a review re-approved across a month boundary is counted once (latest date), in both the stored months and the server copy',async()=>{
  const io=fakeCloud(), st=fakeStore(), uid='u1';
  const sep=W.applyWork({},{v:1,from:'2026-09-01',to:'2026-09-30',reviews:[['7','2026-09-30'],['8','2026-09-29']],products:[]}).months['2026-09'];
  sep.target=1000; io.rows['2026-09']={data:sep,updated_at:'2026-09-30T12:00:00Z'};      /* 다른 기기가 9/30 에 센 7번 */
  st.setItem('unpa-worklog-v2:'+uid,JSON.stringify({v:1,months:{'2026-09':JSON.parse(JSON.stringify(sep))},dirty:[]}));
  const r=await W.syncWindow(st,{v:1,gk:7,device:'dev00001',seq:1,work:{v:1,from:'2026-09-01',to:'2026-10-02',reviews:[['7','2026-10-02']],products:[]}},io,{uid,now:new Date('2026-10-02T12:00:00Z')});
  const v=JSON.parse(st.getItem('unpa-worklog-v2:'+uid)).months;
  assert.deepEqual(v['2026-09']._auto.r['30'],[],'9월 사본은 지운다'); assert.equal(v['2026-09'].days['30'].r,0);
  assert.deepEqual(v['2026-10']._auto.r['02'],['7']); assert.equal(r.goal.won,500);
  assert.deepEqual(io.rows['2026-09'].data._auto.r['30'],[],'서버에도 정리된 사본을 보낸다');
});

test('the worklog remembers the latest complete CMS count time per account (merged across computers) and hands it to the guard',async()=>{
  const io=fakeCloud(), uid='u1';
  const home=fakeStore(), office=fakeStore();
  await W.syncWindow(home,{v:1,gk:7,device:'dev00001',seq:1,acct:'abc',countedAt:'2026-10-19T12:20:00.000Z',work:{v:1,from:'2026-10-01',to:'2026-10-19',reviews:[],products:[['9','2026-10-19']]}},io,{uid,now:new Date('2026-10-19T12:22:00Z')});
  const r=await W.syncWindow(office,{v:1,gk:7,device:'dev00001',seq:1,acct:'abc',countedAt:'2026-10-19T12:00:00.000Z',work:{v:1,from:'2026-10-01',to:'2026-10-19',reviews:[],products:[]}},io,{uid,now:new Date('2026-10-19T12:25:00Z')});
  assert.equal(r.goal.countedAt,'2026-10-19T12:20:00.000Z','집 컴퓨터가 더 나중에 센 시각'); assert.equal(r.goal.won,600);
  const p=await W.syncWindow(office,{v:1,gk:7,device:'dev00001',seq:2,acct:'zzz',countedAt:'2026-10-19T12:30:00.000Z',monthPartial:true,work:{v:1,from:'2026-10-01',to:'2026-10-19',reviews:[],products:[]}},io,{uid,now:new Date('2026-10-19T12:31:00Z')});
  assert.equal(p.goal.countedAt,null,'다른 계정·일부 실패 집계 시각은 쓰지 않는다');
});

test('the work right (lease) stays with one device until it hands it over; another device of the same account takes it only with a count started after the handover',async()=>{
  const io=fakeCloud(), uid='u1', mk=(dev,c,o)=>Object.assign({v:1,gk:7,seq:1,acct:'abc',device:dev,view:0,countedAt:c,work:{v:1,from:'2026-10-01',to:'2026-10-19',reviews:[],products:[]}},o||{});
  const office=fakeStore(), home=fakeStore();
  let r=await W.syncWindow(office,mk('office01','2026-10-19T10:00:00.000Z'),io,{uid,now:new Date('2026-10-19T10:02:00Z')});
  assert.equal(r.goal.lease.ok,true); assert.equal(r.goal.lease.until,'2026-10-19T11:02:00.000Z');
  r=await W.syncWindow(home,mk('home0001','2026-10-19T10:30:00.000Z'),io,{uid,now:new Date('2026-10-19T10:31:00Z')});
  assert.equal(r.goal.lease.ok,false); assert.equal(r.goal.lease.why,'other'); assert.equal(r.goal.lease.closed,false);
  r=await W.syncWindow(home,mk('home0001','2026-10-19T13:00:00.000Z'),io,{uid,now:new Date('2026-10-19T13:01:00Z')});
  assert.equal(r.goal.lease.ok,false,'권한이 끝났어도 넘기지 않았으면 넘어가지 않는다');
  r=await W.syncWindow(office,mk('office01','2026-10-19T13:10:00.000Z'),io,{uid,now:new Date('2026-10-19T13:11:00Z')});
  assert.equal(r.goal.lease.ok,true,'가진 기기는 이어서');
  r=await W.syncWindow(office,mk('office01','2026-10-19T13:20:00.000Z',{release:1}),io,{uid,now:new Date('2026-10-19T13:21:00Z')});
  assert.equal(r.goal.lease.why,'released'); assert.equal(io.rows['~lease'].data.closed,true);
  r=await W.syncWindow(office,mk('office01','2026-10-19T13:22:00.000Z',{release:1}),io,{uid,now:new Date('2026-10-19T13:23:00Z')});
  assert.equal(r.goal.lease.why,'released','넘겨 둔 기기는 다시 가져오기 전까지 받지 않는다');
  r=await W.syncWindow(home,mk('home0001','2026-10-19T13:24:00.000Z'),io,{uid,now:new Date('2026-10-19T13:25:00Z')});
  assert.equal(r.goal.lease.ok,false,'넘긴 뒤 5분 안에 시작한 집계로는 안 된다'); assert.ok(r.goal.lease.after);
  r=await W.syncWindow(home,mk('home0001','2026-10-19T13:30:00.000Z',{view:1}),io,{uid,now:new Date('2026-10-19T13:31:00Z')});
  assert.equal(r.goal.lease.ok,false,'조회 동기화로는 넘겨받지 않는다');
  r=await W.syncWindow(home,mk('home0001','2026-10-19T13:30:00.000Z'),io,{uid,now:new Date('2026-10-19T13:31:00Z')});
  assert.equal(r.goal.lease.ok,true,'넘긴 뒤 시작한 완전한 집계면 넘겨받는다');
  io.skewMs=90e3;
  r=await W.syncWindow(home,mk('home0001','2026-10-19T13:40:00.000Z'),io,{uid,now:new Date('2026-10-19T13:41:00Z')});
  assert.equal(r.goal.lease.why,'clock'); io.skewMs=0;
  const off=await W.syncWindow(fakeStore(),mk('solo0001','2026-10-19T12:00:00.000Z'),null,{now:new Date('2026-10-19T12:01:00Z')});
  assert.equal(off.goal.lease,null,'서버 로그인 안 함 = 한 기기');
});

test('two devices claiming the same free right at the same moment: the compare-and-set lets only one have it',async()=>{
  const io=fakeCloud(), uid='u1', mk=dev=>({v:1,gk:7,seq:1,acct:'abc',device:dev,countedAt:'2026-10-19T10:00:00.000Z',work:{v:1,from:'2026-10-01',to:'2026-10-19',reviews:[],products:[]}});
  const realPull=io.pull; let gate=null; const waitBoth=new Promise(r=>{gate=r;}); let pulls=0;
  io.pull=async keys=>{ const out=await realPull(keys); if(keys.some(k=>k.indexOf('~lease:')===0)){ pulls++; if(pulls===2) gate(); await waitBoth; } return out; };
  const [a,b]=await Promise.all([W.syncWindow(fakeStore(),mk('office01'),io,{uid,now:new Date('2026-10-19T10:02:00Z')}),
                                 W.syncWindow(fakeStore(),mk('home0001'),io,{uid,now:new Date('2026-10-19T10:02:00Z')})]);
  assert.equal([a.goal.lease.ok,b.goal.lease.ok].filter(Boolean).length,1,'둘 다 읽은 뒤 써도 한 기기만');
});

test('a logged-in browser whose sync window cannot reach the server gets no work right (not treated as a single device); an old console without a device id gets a goal no guard can use',async()=>{
  const st=fakeStore(); st.setItem('unpa-worklog-active','unpa-worklog-v2:u1');
  const p={v:1,gk:7,seq:1,acct:'abc',device:'office01',countedAt:'2026-10-19T10:00:00.000Z',work:{v:1,from:'2026-10-01',to:'2026-10-19',reviews:[['1','2026-10-19']],products:[]}};
  let r=await W.syncWindow(st,p,null,{uid:null,now:new Date('2026-10-19T10:02:00Z')});
  assert.deepEqual(r.goal.lease,{ok:false,why:'cloud'});
  r=await W.syncWindow(fakeStore(),Object.assign({},p,{device:undefined}),null,{now:new Date('2026-10-19T10:02:00Z')});
  assert.equal(r.goal.ids,undefined); assert.equal(r.goal.won,r.goal.target); assert.equal(r.goal.partial,true);
});

test('one work right per worklog user: another CMS account never takes it within the month (even after a handover), a right that ended last month is free, and a same-device race keeps it',async()=>{
  const io=fakeCloud(), uid='u1', mk=(dev,acct,c,o)=>Object.assign({v:1,gk:7,seq:1,acct,device:dev,countedAt:c,work:{v:1,from:'2026-10-01',to:'2026-10-19',reviews:[],products:[]}},o||{});
  let r=await W.syncWindow(fakeStore(),mk('office01','aaa','2026-10-19T10:00:00.000Z'),io,{uid,now:new Date('2026-10-19T10:02:00Z')});
  assert.equal(r.goal.lease.ok,true); assert.equal(io.rows['~lease'].data.acct,'aaa');
  await W.syncWindow(fakeStore(),mk('office01','aaa','2026-10-19T10:10:00.000Z',{release:1}),io,{uid,now:new Date('2026-10-19T10:11:00Z')});
  r=await W.syncWindow(fakeStore(),mk('home0001','bbb','2026-10-19T12:00:00.000Z'),io,{uid,now:new Date('2026-10-19T12:01:00Z')});
  assert.equal(r.goal.lease.why,'account','다른 CMS 계정은 이번 달 안에는 안 된다');
  io.rows['~lease'].data.until='2026-09-30T14:50:00.000Z';               /* 지난달(한국 시간 9/30 23:50)에 끝난 권한 */
  io.rows['~lease'].data.closed=false;
  r=await W.syncWindow(fakeStore(),mk('home0001','bbb','2026-10-19T12:10:00.000Z',{work:{v:1,from:'2026-10-01',to:'2026-10-19',reviews:[],products:[]}}),io,{uid,now:new Date('2026-10-19T12:11:00Z')});
  assert.equal(r.goal.lease.ok,true,'지난달에 끝난 권한은 누구든 새로');
  const realClaim=io.claim; let first=true;
  io.claim=async(K,e,d)=>{ if(first){ first=false; await realClaim(K,e,Object.assign({},d,{nonce:'zz'})); return false; } return realClaim(K,e,d); };
  r=await W.syncWindow(fakeStore(),mk('home0001','bbb','2026-10-19T12:20:00.000Z'),io,{uid,now:new Date('2026-10-19T12:21:00Z')});
  assert.equal(r.goal.lease.ok,true,'같은 기기가 방금 이어 간 권한');
});

test('a handover records this month\'s worklog income; a taker whose merged total is lower (a server write was lost) does not get the right',async()=>{
  const io=fakeCloud(), uid='u1', mk=(dev,c,rv,o)=>Object.assign({v:1,gk:7,seq:1,acct:'abc',device:dev,countedAt:c,work:{v:1,from:'2026-10-01',to:'2026-10-19',reviews:rv,products:[]}},o||{});
  await W.syncWindow(fakeStore(),mk('office01','2026-10-19T10:00:00.000Z',[['1','2026-10-19'],['2','2026-10-19']]),io,{uid,now:new Date('2026-10-19T10:02:00Z')});
  await W.syncWindow(fakeStore(),mk('office01','2026-10-19T10:05:00.000Z',[['1','2026-10-19'],['2','2026-10-19']],{release:1}),io,{uid,now:new Date('2026-10-19T10:06:00Z')});
  assert.equal(io.rows['~lease'].data.closedWon,1000);
  io.rows['2026-10'].data._auto.r['19']=['1']; io.rows['2026-10'].data.days['19'].r=1; io.rows['2026-10'].data.days['19'].auto={r:1,p:0};   /* 서버 달 기록이 덮여 2번이 빠졌다 */
  const r=await W.syncWindow(fakeStore(),mk('home0001','2026-10-19T10:20:00.000Z',[['1','2026-10-19']]),io,{uid,now:new Date('2026-10-19T10:21:00Z')});
  assert.equal(r.goal.lease.why,'behind');
});

test('a device whose clock is more than a minute off never writes its count time into the shared record; payloads without the current protocol marker get an unusable goal; outbox rows do not blank the evidence',async()=>{
  const io=fakeCloud(), uid='u1'; io.skewMs=10*60e3;
  const p={v:1,gk:7,seq:1,acct:'abc',device:'skew0001',countedAt:'2026-10-19T12:00:00.000Z',work:{v:1,from:'2026-10-01',to:'2026-10-19',reviews:[],products:[]}};
  const st=fakeStore(); await W.syncWindow(st,p,io,{uid,now:new Date('2026-10-19T12:01:00Z')});
  const v=JSON.parse(st.getItem('unpa-worklog-v2:'+uid)).months['2026-10'];
  assert.equal(v._countedAt,undefined,'시계가 틀린 기기의 집계 시각은 남기지 않는다');
  const r=await W.syncWindow(fakeStore(),Object.assign({},p,{gk:undefined,device:'dev00002'}),null,{now:new Date('2026-10-19T12:01:00Z')});
  assert.equal(r.goal.ids,undefined); assert.equal(r.goal.won,r.goal.target);
  const ev=W.evidenceFrom({reviews:[['9','2026-10-19','브랜드','제품','2026-10-10','m'],['9','2026-10-19','','','','m']],products:[]});
  assert.deepEqual(ev['2026-10'].r['19']['9'],['브랜드','제품','2026-10-10','m']);
});

test('while the previous version\'s per-account right is still live for another device, the new single right is not handed out',async()=>{
  const io=fakeCloud(), uid='u1';
  io.rows['~lease:abc']={data:{device:'office01',since:'2026-10-19T09:00:00.000Z',until:'2026-10-19T11:00:00.000Z'},updated_at:'x'};
  const mk=(dev,c)=>({v:1,gk:7,seq:1,acct:'abc',device:dev,countedAt:c,work:{v:1,from:'2026-10-01',to:'2026-10-19',reviews:[],products:[]}});
  let r=await W.syncWindow(fakeStore(),mk('home0001','2026-10-19T10:30:00.000Z'),io,{uid,now:new Date('2026-10-19T10:31:00Z')});
  assert.equal(r.goal.lease.ok,false); assert.equal(io.rows['~lease'],undefined);
  r=await W.syncWindow(fakeStore(),mk('office01','2026-10-19T10:40:00.000Z'),io,{uid,now:new Date('2026-10-19T10:41:00Z')});
  assert.equal(r.goal.lease.ok,true,'그 권한을 가진 기기는 새 행으로 이어 간다');
});

test('a right never runs past the month: renewing late on the last day ends 5 minutes before the month, so next month it is free; a handover in the last minutes does not block next month',async()=>{
  const io=fakeCloud(), uid='u1', mk=(dev,c,o)=>Object.assign({v:1,gk:7,seq:1,acct:'abc',device:dev,countedAt:c,work:{v:1,from:'2026-10-01',to:'2026-10-31',reviews:[],products:[]}},o||{});
  let r=await W.syncWindow(fakeStore(),mk('office01','2026-10-31T14:20:00.000Z'),io,{uid,now:new Date('2026-10-31T14:30:00Z')});   /* 한국 10/31 23:30 */
  assert.equal(r.goal.lease.until,'2026-10-31T14:55:00.000Z','한국 10/31 23:55까지만');
  const nov=p=>Object.assign(p,{work:{v:1,from:'2026-10-01',to:'2026-11-01',reviews:[],products:[]}});
  r=await W.syncWindow(fakeStore(),nov(mk('home0001','2026-10-31T15:10:00.000Z')),io,{uid,now:new Date('2026-10-31T15:11:00Z')});
  assert.equal(r.goal.lease.ok,true,'다음 달엔 다른 기기도 바로 받는다');
  const io2=fakeCloud();
  await W.syncWindow(fakeStore(),mk('office01','2026-10-31T14:30:00.000Z',{work:{v:1,from:'2026-10-01',to:'2026-10-31',reviews:[['1','2026-10-31']],products:[]}}),io2,{uid,now:new Date('2026-10-31T14:31:00Z')});
  await W.syncWindow(fakeStore(),mk('office01','2026-10-31T14:56:00.000Z',{release:1}),io2,{uid,now:new Date('2026-10-31T14:57:00Z')});   /* 23:57 넘기기 */
  r=await W.syncWindow(fakeStore(),nov(mk('home0001','2026-10-31T15:10:00.000Z')),io2,{uid,now:new Date('2026-10-31T15:11:00Z')});
  assert.equal(r.goal.lease.ok,true,'지난달 마지막 몇 분에 넘긴 권한은 다음 달 금액과 비교하지 않는다');
});

test('an inherited target keeps the time it was set, so merging with a stale computer keeps the target the user raised later',()=>{
  const mkM=(target,o)=>Object.assign({month:'2026-11',target,days:{}},o||{});
  /* 사용자가 10월에 목표를 1,600,000 으로 올림(_t) → 11월이 이어받음(_tc) / 오래 동기화 안 한 기기는 옛 1,430,000 을 이어받음(_tc 옛 시각) */
  let m=W.mergeMonth(mkM(1430000,{_tc:1000}),mkM(1600000,{_tc:5000}));
  assert.equal(m.target,1600000);
  m=W.mergeMonth(mkM(1600000,{_tc:5000}),mkM(1430000,{_tc:1000}));
  assert.equal(m.target,1600000);
  m=W.mergeMonth(mkM(1600000),mkM(1430000));
  assert.equal(m.target,1430000,'둘 다 시각이 없으면 낮은 쪽');
});

test('a view sync never takes a free right; a second hand-over does not move the hand-over time; reviews left on the handing-over computer go with the right',async()=>{
  const io=fakeCloud(), uid='u1', mk=(dev,c,o)=>Object.assign({v:1,gk:7,seq:1,acct:'abc',device:dev,countedAt:c,work:{v:1,from:'2026-10-01',to:'2026-10-19',reviews:[],products:[]}},o||{});
  let r=await W.syncWindow(fakeStore(),mk('home0001','2026-10-19T09:00:00.000Z',{view:1}),io,{uid,now:new Date('2026-10-19T09:01:00Z')});
  assert.equal(r.goal.lease.why,'view'); assert.equal(io.rows['~lease'],undefined,'빈 권한도 조회 동기화로는 안 받는다');
  await W.syncWindow(fakeStore(),mk('office01','2026-10-19T10:00:00.000Z'),io,{uid,now:new Date('2026-10-19T10:02:00Z')});
  await W.syncWindow(fakeStore(),mk('office01','2026-10-19T10:10:00.000Z',{release:1,pendR:['77','x']}),io,{uid,now:new Date('2026-10-19T10:11:00Z')});
  const at=io.rows['~lease'].data.closedAt; assert.deepEqual(io.rows['~lease'].data.closedPendR,['77']);
  await W.syncWindow(fakeStore(),mk('office01','2026-10-19T10:30:00.000Z',{release:1}),io,{uid,now:new Date('2026-10-19T10:31:00Z')});
  assert.equal(io.rows['~lease'].data.closedAt,at,'다시 넘겨도 넘긴 시각은 그대로');
  r=await W.syncWindow(fakeStore(),mk('home0001','2026-10-19T10:20:00.000Z'),io,{uid,now:new Date('2026-10-19T10:21:00Z')});
  assert.equal(r.goal.lease.ok,true); assert.deepEqual(r.goal.lease.pendR,['77'],'넘긴 기기에 남았던 승인 번호를 넘겨받는다');
});

test('recovering a right whose device id was lost: only after it expired, with a confirmed (force) count that covers what that device could have approved',async()=>{
  const io=fakeCloud(), uid='u1', mk=(dev,c,o)=>Object.assign({v:1,gk:7,seq:1,acct:'abc',device:dev,countedAt:c,work:{v:1,from:'2026-10-01',to:'2026-10-19',reviews:[],products:[]}},o||{});
  await W.syncWindow(fakeStore(),mk('lost0001','2026-10-19T10:00:00.000Z'),io,{uid,now:new Date('2026-10-19T10:02:00Z')});
  let r=await W.syncWindow(fakeStore(),mk('new00001','2026-10-19T10:30:00.000Z',{force:1,countFrom:'2026-07-01'}),io,{uid,now:new Date('2026-10-19T10:31:00Z')});
  assert.equal(r.goal.lease.ok,false,'권한이 아직 살아 있으면 안 된다');
  r=await W.syncWindow(fakeStore(),mk('new00001','2026-10-19T11:10:00.000Z',{countFrom:'2026-07-01'}),io,{uid,now:new Date('2026-10-19T11:11:00Z')});
  assert.equal(r.goal.lease.ok,false,'사람이 확인(force)하지 않으면 안 된다'); assert.equal(r.goal.lease.need,'2026-08-09');
  r=await W.syncWindow(fakeStore(),mk('new00001','2026-10-19T11:10:00.000Z',{force:1,countFrom:'2026-08-20'}),io,{uid,now:new Date('2026-10-19T11:11:00Z')});
  assert.equal(r.goal.lease.ok,false,'그 기기가 승인할 수 있었던 리뷰를 다 덮지 못하는 집계로는 안 된다');
  r=await W.syncWindow(fakeStore(),mk('new00001','2026-10-19T11:10:00.000Z',{force:1,countFrom:'2026-08-01'}),io,{uid,now:new Date('2026-10-19T11:11:00Z')});
  assert.equal(r.goal.lease.ok,true);
});

test('a month created from a stale previous month re-inherits the target once the merge shows a later-set previous target',async()=>{
  const io=fakeCloud(), uid='u1';
  const octOld=Object.assign(monthOf('2026-10'),{target:10000,_t:1000}), octNew=Object.assign(monthOf('2026-10'),{target:5000,_t:2000});
  io.rows['2026-10']={data:octNew,updated_at:'x'};
  const office=fakeStore(); office.setItem('unpa-worklog-v2:'+uid,JSON.stringify({v:1,months:{'2026-10':octOld},dirty:[]}));
  const r=await W.syncWindow(office,{v:1,gk:7,seq:1,acct:'abc',device:'office01',countedAt:'2026-11-02T00:30:00.000Z',work:{v:1,from:'2026-10-01',to:'2026-11-02',reviews:[],products:[]}},io,{uid,now:new Date('2026-11-02T00:31:00Z')});
  assert.equal(r.goal.month,'2026-11'); assert.equal(r.goal.target,5000,'옛 10,000 이 아니라 나중에 정한 5,000');
});

test('recovering a lost device\'s right also inherits what that device was still counting: reviews it had taken over, its own ledger-only reviews (its latest list replaces the earlier one) and its month halt',async()=>{
  const io=fakeCloud(), uid='u1', at=s=>({uid,now:new Date(s)}), mk=(dev,c,o)=>Object.assign({v:1,gk:7,seq:1,acct:'abc',device:dev,countedAt:c,work:{v:1,from:'2026-10-01',to:'2026-10-19',reviews:[],products:[]}},o||{});
  await W.syncWindow(fakeStore(),mk('home0001','2026-10-19T09:00:00.000Z'),io,at('2026-10-19T09:01:00Z'));
  await W.syncWindow(fakeStore(),mk('home0001','2026-10-19T09:10:00.000Z',{release:1,pendR:['77']}),io,at('2026-10-19T09:11:00Z'));
  let r=await W.syncWindow(fakeStore(),mk('lost0001','2026-10-19T09:20:00.000Z'),io,at('2026-10-19T09:21:00Z'));
  assert.deepEqual(r.goal.lease.pendR,['77']);
  await W.syncWindow(fakeStore(),mk('lost0001','2026-10-19T09:30:00.000Z',{ownPendR:['88','x']}),io,at('2026-10-19T09:31:00Z'));
  assert.deepEqual(io.rows['~lease'].data.ownPendR,['88'],'이 기기 원장에만 있는 승인 번호를 권한 행에 적는다');
  const halt={v:7,month:'2026-10',target:1430000,t:Date.parse('2026-10-19T09:40:30Z'),won:1429800};
  await W.syncWindow(fakeStore(),mk('lost0001','2026-10-19T09:40:00.000Z',{ownPendR:['89'],halt}),io,at('2026-10-19T09:41:00Z'));
  assert.deepEqual(io.rows['~lease'].data.ownPendR,['89'],'합치지 않고 바꾼다 — 이 기기 원장이 기준');
  await W.syncWindow(fakeStore(),mk('lost0001','2026-10-19T09:45:00.000Z',{view:1}),io,at('2026-10-19T09:46:00Z'));
  assert.deepEqual(io.rows['~lease'].data.ownPendR,['89'],'목록을 보내지 않은 동기화(조회)는 그대로 둔다');
  /* lost0001 의 기기 번호를 잃었다 — 권한이 끝난(10:46) 뒤 넓게 센 집계로 사람이 확인하고 가져온다 */
  r=await W.syncWindow(fakeStore(),mk('new00001','2026-10-19T10:52:00.000Z',{force:1,countFrom:'2026-08-01'}),io,at('2026-10-19T10:53:00Z'));
  assert.equal(r.goal.lease.ok,true);
  assert.deepEqual([...r.goal.lease.pendR].sort(),['77','89'],'그 기기가 넘겨받았던 번호와 그 기기 원장에만 있던 번호를 이어서 센다');
  assert.deepEqual(r.goal.lease.halt,halt,'그 기기가 멈춘 달이면 가져온 쪽도 멈춘 채로');
});

test('a sync built before the hand-over click that reaches the server after the hand-over does not re-open the right; a take-back click (higher epoch) does',async()=>{
  const uid='u1', at=s=>({uid,now:new Date(s)}), mk=(dev,c,o)=>Object.assign({v:1,gk:7,seq:1,acct:'abc',device:dev,countedAt:c,work:{v:1,from:'2026-10-01',to:'2026-10-19',reviews:[],products:[]}},o||{});
  let io=fakeCloud();
  await W.syncWindow(fakeStore(),mk('office01','2026-10-19T10:00:00.000Z',{leaseEpoch:0}),io,at('2026-10-19T10:01:00Z'));
  let r=await W.syncWindow(fakeStore(),mk('office01','2026-10-19T10:05:00.000Z',{leaseEpoch:1,release:1}),io,at('2026-10-19T10:06:00Z'));
  assert.equal(r.goal.lease.why,'released'); assert.equal(io.rows['~lease'].data.closedEpoch,1);
  const closedAt=io.rows['~lease'].data.closedAt;
  r=await W.syncWindow(fakeStore(),mk('office01','2026-10-19T10:04:00.000Z',{leaseEpoch:0}),io,at('2026-10-19T10:07:00Z'));   /* 넘기기 전에 만든 동기화가 늦게 닿음 */
  assert.equal(r.goal.lease.ok,false); assert.equal(r.goal.lease.why,'released');
  assert.equal(io.rows['~lease'].data.closed,true,'권한 행은 닫힌 채로'); assert.equal(io.rows['~lease'].data.closedAt,closedAt);
  r=await W.syncWindow(fakeStore(),mk('home0001','2026-10-19T10:12:00.000Z'),io,at('2026-10-19T10:13:00Z'));
  assert.equal(r.goal.lease.ok,true,'넘겨받는 쪽은 그대로 받는다');
  io=fakeCloud();
  await W.syncWindow(fakeStore(),mk('office01','2026-10-19T10:00:00.000Z',{leaseEpoch:0}),io,at('2026-10-19T10:01:00Z'));
  await W.syncWindow(fakeStore(),mk('office01','2026-10-19T10:05:00.000Z',{leaseEpoch:1,release:1}),io,at('2026-10-19T10:06:00Z'));
  r=await W.syncWindow(fakeStore(),mk('office01','2026-10-19T10:06:00.000Z',{leaseEpoch:1}),io,at('2026-10-19T10:07:00Z'));
  assert.equal(r.goal.lease.why,'released','넘길 때와 같은 순번도 안 된다');
  r=await W.syncWindow(fakeStore(),mk('office01','2026-10-19T10:08:00.000Z',{leaseEpoch:2}),io,at('2026-10-19T10:09:00Z'));   /* [다시 가져오기] */
  assert.equal(r.goal.lease.ok,true); assert.equal(io.rows['~lease'].data.closed,false);
  await W.syncWindow(fakeStore(),mk('office01','2026-10-19T10:10:00.000Z',{leaseEpoch:3,release:1}),io,at('2026-10-19T10:11:00Z'));
  delete io.rows['~lease'].data.closedEpoch;                              /* 순번을 적지 않던 판이 닫은 행 */
  r=await W.syncWindow(fakeStore(),mk('office01','2026-10-19T10:12:00.000Z',{leaseEpoch:0}),io,at('2026-10-19T10:13:00Z'));
  assert.equal(r.goal.lease.ok,true,'순번이 없는 예전 행은 예전처럼 다시 연다');
});

test('a handed-over review that the taker\'s count sees as not approved by me is dropped from the right, but only by a count started after the hand-over; the device\'s own list and the release are untouched',async()=>{
  const io=fakeCloud(), uid='u1', at=s=>({uid,now:new Date(s)}), mk=(dev,c,o)=>Object.assign({v:1,gk:7,seq:1,acct:'abc',device:dev,countedAt:c,work:{v:1,from:'2026-10-01',to:'2026-10-19',reviews:[],products:[]}},o||{});
  await W.syncWindow(fakeStore(),mk('home0001','2026-10-19T09:50:00.000Z'),io,at('2026-10-19T09:51:00Z'));
  await W.syncWindow(fakeStore(),mk('home0001','2026-10-19T10:00:00.000Z',{release:1,pendR:['77','78']}),io,at('2026-10-19T10:01:00Z'));
  let r=await W.syncWindow(fakeStore(),mk('office01','2026-10-19T10:10:00.000Z'),io,at('2026-10-19T10:11:00Z'));
  assert.deepEqual(r.goal.lease.pendR,['77','78']); assert.equal(io.rows['~lease'].data.pendFrom,'2026-10-19T10:06:00.000Z');
  r=await W.syncWindow(fakeStore(),mk('office01','2026-10-19T10:00:00.000Z',{dropR:['77']}),io,at('2026-10-19T10:12:00Z'));   /* 넘기기 전에 시작한 다른 탭의 집계 */
  assert.deepEqual(r.goal.lease.pendR,['77','78'],'넘기기 전 집계로는 빼지 않는다 — 그 뒤에 승인됐을 수 있다');
  r=await W.syncWindow(fakeStore(),mk('office01','2026-10-19T10:10:00.000Z',{dropR:['77','999','x'],ownPendR:['55']}),io,at('2026-10-19T10:13:00Z'));
  assert.deepEqual(r.goal.lease.pendR,['78'],'넘겨받은 뒤 시작한 집계가 내 승인 아님으로 본 번호는 승인된 적이 없다');
  assert.deepEqual(io.rows['~lease'].data.pendR,['78']); assert.deepEqual(io.rows['~lease'].data.ownPendR,['55']);
  r=await W.syncWindow(fakeStore(),mk('office01','2026-10-19T10:14:00.000Z',{dropR:['55']}),io,at('2026-10-19T10:15:00Z'));
  assert.deepEqual(io.rows['~lease'].data.ownPendR,['55'],'이 기기 원장 목록은 dropR 로 바뀌지 않는다');
  await W.syncWindow(fakeStore(),mk('office01','2026-10-19T10:20:00.000Z',{release:1,dropR:['78']}),io,at('2026-10-19T10:21:00Z'));
  assert.deepEqual(io.rows['~lease'].data.closedPendR,['78'],'넘기는 동기화는 번호를 빼지 않는다');
});

test('the month halt goes with the right: kept on the row while held, handed over on release, given to the taker; malformed halts are ignored',async()=>{
  const io=fakeCloud(), uid='u1', at=s=>({uid,now:new Date(s)}), mk=(dev,c,o)=>Object.assign({v:1,gk:7,seq:1,acct:'abc',device:dev,countedAt:c,work:{v:1,from:'2026-10-01',to:'2026-10-19',reviews:[],products:[]}},o||{});
  const halt={v:7,month:'2026-10',target:1430000,t:Date.parse('2026-10-19T09:59:00Z'),won:1429800};
  await W.syncWindow(fakeStore(),mk('home0001','2026-10-19T10:00:00.000Z',{halt:Object.assign({note:'x',deep:{a:1}},halt)}),io,at('2026-10-19T10:01:00Z'));
  assert.deepEqual(io.rows['~lease'].data.halt,halt,'정해진 칸의 숫자·문자만');
  for(const bad of [Object.assign({},halt,{v:'7',t:halt.t+1}),Object.assign({},halt,{month:{},t:halt.t+1}),Object.assign({},halt,{t:'soon'}),[halt],'halt'])
    await W.syncWindow(fakeStore(),mk('home0001','2026-10-19T10:02:00.000Z',{halt:bad}),io,at('2026-10-19T10:03:00Z'));
  assert.deepEqual(io.rows['~lease'].data.halt,halt,'모양이 틀린 정지 표시는 받지 않는다');
  await W.syncWindow(fakeStore(),mk('home0001','2026-10-19T10:04:00.000Z',{release:1}),io,at('2026-10-19T10:05:00Z'));
  assert.deepEqual(io.rows['~lease'].data.closedHalt,halt);
  let r=await W.syncWindow(fakeStore(),mk('office01','2026-10-19T10:12:00.000Z'),io,at('2026-10-19T10:13:00Z'));
  assert.equal(r.goal.lease.ok,true); assert.deepEqual(r.goal.lease.halt,halt,'넘겨받은 쪽도 이번 달은 멈춘 채로');
  r=await W.syncWindow(fakeStore(),mk('office01','2026-10-19T10:14:00.000Z'),io,at('2026-10-19T10:15:00Z'));
  assert.deepEqual(r.goal.lease.halt,halt,'넘겨받은 정지는 이어 가는 동안 계속 돌려준다');
  const halt2={v:7,month:'2026-10',target:1500000,t:Date.parse('2026-10-19T10:30:00Z'),won:1499800};
  r=await W.syncWindow(fakeStore(),mk('office01','2026-10-19T10:31:00.000Z',{halt:halt2}),io,at('2026-10-19T10:32:00Z'));
  assert.deepEqual(r.goal.lease.halt,halt2,'더 나중에 멈춘 것');
  await W.syncWindow(fakeStore(),mk('office01','2026-10-19T10:33:00.000Z',{release:1,halt}),io,at('2026-10-19T10:34:00Z'));
  assert.deepEqual(io.rows['~lease'].data.closedHalt,halt2,'넘길 때도 더 나중에 멈춘 것');
});

test('a hand-over sync made before a take-back click that reaches the server after the take-back does not close the taken-back right, so no second computer can take it; the row keeps the epoch the right is used at',async()=>{
  const io=fakeCloud(), uid='u1', at=s=>({uid,now:new Date(s)}), mk=(dev,c,o)=>Object.assign({v:1,gk:7,seq:1,acct:'abc',device:dev,countedAt:c,work:{v:1,from:'2026-10-01',to:'2026-10-19',reviews:[],products:[]}},o||{});
  let r=await W.syncWindow(fakeStore(),mk('office01','2026-10-19T10:00:00.000Z',{leaseEpoch:0}),io,at('2026-10-19T10:01:00Z'));
  assert.equal(r.goal.lease.ok,true); assert.equal(io.rows['~lease'].data.grantEpoch,0);
  /* [넘기기](순번 1)의 동기화 창이 멈췄고, [다시 가져오기](순번 2)의 동기화가 먼저 서버에 닿았다 */
  r=await W.syncWindow(fakeStore(),mk('office01','2026-10-19T10:05:00.000Z',{leaseEpoch:2}),io,at('2026-10-19T10:06:00Z'));
  assert.equal(r.goal.lease.ok,true); assert.equal(io.rows['~lease'].data.grantEpoch,2);
  r=await W.syncWindow(fakeStore(),mk('office01','2026-10-19T10:03:00.000Z',{leaseEpoch:1,release:1,pendR:['77']}),io,at('2026-10-19T10:07:00Z'));   /* 멈췄던 넘기기가 늦게 닿음 */
  assert.equal(r.goal.lease.ok,false); assert.equal(r.goal.lease.why,'stale');
  assert.equal(io.rows['~lease'].data.closed,false,'다시 받은 권한은 열린 채로'); assert.equal(io.rows['~lease'].data.closedAt,undefined);
  r=await W.syncWindow(fakeStore(),mk('home0001','2026-10-19T10:20:00.000Z',{leaseEpoch:0}),io,at('2026-10-19T10:21:00Z'));
  assert.equal(r.goal.lease.ok,false,'같은 CMS 계정의 다른 컴퓨터도 받지 못한다'); assert.equal(r.goal.lease.closed,false);
  r=await W.syncWindow(fakeStore(),mk('office01','2026-10-19T10:22:00.000Z',{leaseEpoch:1}),io,at('2026-10-19T10:23:00Z'));   /* 앞 순번의 늦은 보통 동기화 */
  assert.equal(r.goal.lease.ok,true); assert.equal(io.rows['~lease'].data.grantEpoch,2,'순번은 내려가지 않는다');
  /* 새로 누른 넘기기(순번 3)는 그대로 닫고, 넘겨받은 기기는 제 순번부터 */
  r=await W.syncWindow(fakeStore(),mk('office01','2026-10-19T10:30:00.000Z',{leaseEpoch:3,release:1}),io,at('2026-10-19T10:31:00Z'));
  assert.equal(r.goal.lease.why,'released'); assert.equal(io.rows['~lease'].data.closed,true);
  r=await W.syncWindow(fakeStore(),mk('home0001','2026-10-19T10:40:00.000Z',{leaseEpoch:0}),io,at('2026-10-19T10:41:00Z'));
  assert.equal(r.goal.lease.ok,true); assert.equal(io.rows['~lease'].data.grantEpoch,0,'다른 기기가 받으면 그 기기 순번부터');
  r=await W.syncWindow(fakeStore(),mk('home0001','2026-10-19T10:42:00.000Z',{leaseEpoch:0,release:1}),io,at('2026-10-19T10:43:00Z'));
  assert.equal(r.goal.lease.why,'released','넘겨받은 기기의 넘기기는 앞 기기 순번과 비교하지 않는다');
  /* 같은 기기의 두 동기화가 겹쳐 앞 순번(2)이 먼저 썼다 — 뒤 순번(4)은 순번을 올려 적은 뒤에만 권한으로 받는다 */
  const io2=fakeCloud();
  await W.syncWindow(fakeStore(),mk('office01','2026-10-19T10:00:00.000Z',{leaseEpoch:2}),io2,at('2026-10-19T10:01:00Z'));
  const realClaim=io2.claim; let first=true;
  io2.claim=async(K,e,d)=>{ if(first){ first=false; await realClaim(K,e,Object.assign({},d,{nonce:'zz',grantEpoch:2})); return false; } return realClaim(K,e,d); };
  r=await W.syncWindow(fakeStore(),mk('office01','2026-10-19T10:10:00.000Z',{leaseEpoch:4}),io2,at('2026-10-19T10:11:00Z'));
  assert.equal(r.goal.lease.ok,true); assert.equal(io2.rows['~lease'].data.grantEpoch,4);
  r=await W.syncWindow(fakeStore(),mk('office01','2026-10-19T10:05:00.000Z',{leaseEpoch:3,release:1}),io2,at('2026-10-19T10:12:00Z'));
  assert.equal(r.goal.lease.why,'stale'); assert.equal(io2.rows['~lease'].data.closed,false);
  io2.claim=async(K,e,d)=>{ await realClaim(K,e,Object.assign({},d,{nonce:'yy'+Math.random(),grantEpoch:4})); return false; };   /* 순번을 올려 적지도 못했다 */
  r=await W.syncWindow(fakeStore(),mk('office01','2026-10-19T10:20:00.000Z',{leaseEpoch:6}),io2,at('2026-10-19T10:21:00Z'));
  assert.equal(r.goal.lease.ok,false,'못 올렸으면 권한으로 주지 않는다'); assert.equal(r.goal.lease.why,'stale');
});

test('a hand-over that is the first sync of a new month hands over only this month\'s reviews and halt — the taker does not count last month\'s handed-over reviews all month',async()=>{
  const io=fakeCloud(), uid='u1', at=s=>({uid,now:new Date(s)}), mk=(dev,c,to,o)=>Object.assign({v:1,gk:7,seq:1,acct:'abc',device:dev,countedAt:c,work:{v:1,from:'2026-10-01',to,reviews:[],products:[]}},o||{});
  /* 10월: 집 컴퓨터가 넘기며 남긴 101·102 를 회사 컴퓨터가 넘겨받았고, 회사 컴퓨터는 10월 마지막 날 목표 직전에서 멈췄다 */
  await W.syncWindow(fakeStore(),mk('home0001','2026-10-10T00:00:00.000Z','2026-10-10'),io,at('2026-10-10T00:01:00Z'));
  await W.syncWindow(fakeStore(),mk('home0001','2026-10-10T00:10:00.000Z','2026-10-10',{release:1,pendR:['101','102']}),io,at('2026-10-10T00:11:00Z'));
  let r=await W.syncWindow(fakeStore(),mk('office01','2026-10-10T00:20:00.000Z','2026-10-10'),io,at('2026-10-10T00:21:00Z'));
  assert.deepEqual(r.goal.lease.pendR,['101','102']);
  const octHalt={v:7,month:'2026-10',target:1450000,t:Date.parse('2026-10-31T13:59:00Z'),won:1449800};
  await W.syncWindow(fakeStore(),mk('office01','2026-10-31T14:00:00.000Z','2026-10-31',{halt:octHalt}),io,at('2026-10-31T14:01:00Z'));
  assert.deepEqual(io.rows['~lease'].data.pendR,['101','102']); assert.deepEqual(io.rows['~lease'].data.halt,octHalt);
  /* 11/2: 회사 컴퓨터의 11월 첫 동기화가 넘기기(10월 정지 표시가 원장에 남아 함께 왔다) */
  await W.syncWindow(fakeStore(),mk('office01','2026-11-01T23:50:00.000Z','2026-11-02',{release:1,pendR:['300'],halt:octHalt}),io,at('2026-11-02T00:00:00Z'));
  const row=io.rows['~lease'].data;
  assert.equal(row.closed,true); assert.equal(row.closedMonth,'2026-11');
  assert.deepEqual(row.closedPendR,['300'],'지난달에 넘겨받은 번호는 넘기지 않는다'); assert.equal(row.closedHalt,null,'지난달 정지도');
  r=await W.syncWindow(fakeStore(),mk('home0001','2026-11-02T00:10:00.000Z','2026-11-02'),io,at('2026-11-02T00:11:00Z'));
  assert.equal(r.goal.lease.ok,true); assert.equal(r.goal.month,'2026-11');
  assert.deepEqual(r.goal.lease.pendR,['300'],'넘겨받는 쪽은 이번 달 번호만 센다'); assert.equal(r.goal.lease.halt,null);
});

test('the device\'s own ledger-only list and its halt do not outlive the month: a first sync of a new month that sends no list clears them, so recovering that device\'s right does not count last month\'s reviews',async()=>{
  const io=fakeCloud(), uid='u1', at=s=>({uid,now:new Date(s)}), mk=(dev,c,to,o)=>Object.assign({v:1,gk:7,seq:1,acct:'abc',device:dev,countedAt:c,work:{v:1,from:'2026-10-01',to,reviews:[],products:[]}},o||{});
  const octHalt={v:7,month:'2026-10',target:1450000,t:Date.parse('2026-10-31T11:59:00Z'),won:1449800};
  await W.syncWindow(fakeStore(),mk('lost0001','2026-10-31T12:00:00.000Z','2026-10-31',{ownPendR:['500','501'],halt:octHalt}),io,at('2026-10-31T12:01:00Z'));
  assert.deepEqual(io.rows['~lease'].data.ownPendR,['500','501']);
  /* 11/1 첫 동기화가 조회([업데이트]) — 목록도 정지 표시도 보내지 않는다 */
  let r=await W.syncWindow(fakeStore(),mk('lost0001','2026-11-01T00:00:00.000Z','2026-11-01',{view:1}),io,at('2026-11-01T00:01:00Z'));
  assert.equal(r.goal.lease.ok,true); assert.equal(io.rows['~lease'].data.month,'2026-11');
  assert.deepEqual(io.rows['~lease'].data.ownPendR,[],'지난달 목록은 비운다'); assert.equal(io.rows['~lease'].data.halt,null,'지난달 정지도');
  /* 그 기기 번호를 잃었다 — 권한이 끝난 뒤 넓게 센 집계로 가져온다 */
  r=await W.syncWindow(fakeStore(),mk('new00001','2026-11-01T01:10:00.000Z','2026-11-01',{force:1,countFrom:'2026-08-01'}),io,at('2026-11-01T01:12:00Z'));
  assert.equal(r.goal.lease.ok,true); assert.deepEqual(r.goal.lease.pendR,[],'지난달 승인 번호는 이번 달에 세지 않는다');
  /* 이번 달에 쓴 행이 아니면(지난달 목록이 남은 행) 가져올 때 그 목록을 잇지 않는다 */
  const io2=fakeCloud();
  io2.rows['~lease']={data:{device:'lost0002',acct:'abc',since:'2026-11-01T00:00:00.000Z',until:'2026-11-01T01:01:00.000Z',nonce:'n1',closed:false,renewWon:0,
                            pendR:['700'],ownPendR:['701'],month:'2026-10'},updated_at:'x'};
  r=await W.syncWindow(fakeStore(),mk('new00002','2026-11-01T01:10:00.000Z','2026-11-01',{force:1,countFrom:'2026-08-01'}),io2,at('2026-11-01T01:12:00Z'));
  assert.equal(r.goal.lease.ok,true); assert.deepEqual(r.goal.lease.pendR,[]);
  /* 이번 달에 보낸 목록은 그대로 이어서 센다 */
  const io3=fakeCloud();
  await W.syncWindow(fakeStore(),mk('lost0003','2026-10-31T12:00:00.000Z','2026-10-31',{ownPendR:['500']}),io3,at('2026-10-31T12:01:00Z'));
  await W.syncWindow(fakeStore(),mk('lost0003','2026-11-01T00:00:00.000Z','2026-11-01',{ownPendR:['800']}),io3,at('2026-11-01T00:01:00Z'));
  r=await W.syncWindow(fakeStore(),mk('new00003','2026-11-01T01:10:00.000Z','2026-11-01',{force:1,countFrom:'2026-08-01'}),io3,at('2026-11-01T01:12:00Z'));
  assert.equal(r.goal.lease.ok,true); assert.deepEqual(r.goal.lease.pendR,['800']);
});

test('a hand-over clicked seconds before midnight at month end that reaches the server after midnight: the November row gets no October income, reviews or halt, so the same-account taker gets the right in November',async()=>{
  const io=fakeCloud(), uid='u1', at=s=>({uid,now:new Date(s)}), oct=[['1','2026-10-31'],['2','2026-10-31']];
  const mk=(dev,c,b,to,rv,o)=>Object.assign({v:1,gk:7,seq:1,acct:'abc',device:dev,countedAt:c,builtAt:b,work:{v:1,from:'2026-10-01',to,reviews:rv,products:[]}},o||{});
  const octHalt={v:7,month:'2026-10',target:1450000,t:Date.parse('2026-10-31T14:50:00Z'),won:1000};
  await W.syncWindow(fakeStore(),mk('office01','2026-10-31T13:59:00.000Z','2026-10-31T13:59:30.000Z','2026-10-31',oct),io,at('2026-10-31T14:00:00Z'));   /* 한국 10/31 23:00 — 10월 1,000원 */
  /* 23:59:55 에 누른 넘기기 — 동기화 창이 서버 확인을 기다리다 11/1 00:00:03 에 반영 */
  let r=await W.syncWindow(fakeStore(),mk('office01','2026-10-31T14:58:00.000Z','2026-10-31T14:59:55.000Z','2026-10-31',oct,{release:1,pendR:['555'],halt:octHalt}),io,at('2026-10-31T15:00:03Z'));
  assert.equal(r.goal.lease.why,'released');
  const row=io.rows['~lease'].data;
  assert.equal(row.closed,true); assert.equal(row.closedMonth,'2026-11');
  assert.equal(row.closedWon,null,'10월 금액(1,000)을 11월에 닫은 행에 적지 않는다 — 이 기록엔 11월이 아직 없다');
  assert.deepEqual(row.closedPendR,[],'10월에 만든 넘기기의 번호(10월 승인)는 넘기지 않는다'); assert.equal(row.closedHalt,null);
  /* 자정 전에 시작한 집계(그 동기화가 11월에 닿아도)로는 넘겨받지 못한다 — 넘긴 뒤 5분 지나 시작한 집계여야 */
  r=await W.syncWindow(fakeStore(),mk('home0001','2026-10-31T14:59:50.000Z','2026-10-31T15:00:20.000Z','2026-11-01',oct),io,at('2026-10-31T15:00:30Z'));
  assert.equal(r.goal.lease.ok,false); assert.equal(r.goal.lease.closed,true); assert.equal(r.goal.lease.after,'2026-10-31T15:05:03.000Z');
  r=await W.syncWindow(fakeStore(),mk('home0001','2026-10-31T15:06:00.000Z','2026-10-31T15:06:40.000Z','2026-11-01',oct),io,at('2026-10-31T15:07:00Z'));
  assert.equal(r.goal.lease.ok,true,'같은 CMS 계정의 다른 컴퓨터가 11월에 받는다 (예전: 한 달 내내 behind)'); assert.equal(r.goal.month,'2026-11');
  assert.deepEqual(r.goal.lease.pendR,[]); assert.equal(r.goal.lease.halt,null);
  /* 만든 시각이 없는 동기화(예전 형식)는 같은 달로 본다 — 번호를 더 세는 쪽 */
  const io2=fakeCloud();
  await W.syncWindow(fakeStore(),mk('office01','2026-10-31T13:59:00.000Z',undefined,'2026-10-31',oct),io2,at('2026-10-31T14:00:00Z'));
  await W.syncWindow(fakeStore(),mk('office01','2026-10-31T14:58:00.000Z',undefined,'2026-10-31',oct,{release:1,pendR:['556']}),io2,at('2026-10-31T15:00:03Z'));
  assert.deepEqual(io2.rows['~lease'].data.closedPendR,['556']);
});

test('a sync built last month that reaches the server in the new month does not put last month\'s ledger-only list on the row: it neither replaces this month\'s list nor survives a month-change renewal',async()=>{
  const io=fakeCloud(), uid='u1', at=s=>({uid,now:new Date(s)});
  const mk=(dev,c,b,to,o)=>Object.assign({v:1,gk:7,seq:1,acct:'abc',device:dev,countedAt:c,builtAt:b,work:{v:1,from:'2026-10-01',to,reviews:[],products:[]}},o||{});
  await W.syncWindow(fakeStore(),mk('office01','2026-10-31T12:00:00.000Z','2026-10-31T12:00:30.000Z','2026-10-31',{ownPendR:['500']}),io,at('2026-10-31T12:01:00Z'));
  /* 10/31 23:59:50 에 만든 동기화가 늦어지는 사이 11/1 00:03 에 만든 동기화가 먼저 닿았다 */
  await W.syncWindow(fakeStore(),mk('office01','2026-10-31T15:02:00.000Z','2026-10-31T15:03:00.000Z','2026-11-01',{ownPendR:['600']}),io,at('2026-10-31T15:03:10Z'));
  assert.deepEqual(io.rows['~lease'].data.ownPendR,['600']);
  let r=await W.syncWindow(fakeStore(),mk('office01','2026-10-31T14:58:00.000Z','2026-10-31T14:59:50.000Z','2026-10-31',{ownPendR:['500','501']}),io,at('2026-10-31T15:03:30Z'));
  assert.equal(r.goal.lease.ok,true); assert.deepEqual(io.rows['~lease'].data.ownPendR,['600'],'지난달 목록으로 바꾸지 않는다');
  /* 11월 첫 갱신이 10월에 만든 동기화 — 10월 목록을 11월 행에 남기지 않으니, 그 기기 번호를 잃어 가져와도 10월 번호를 세지 않는다 */
  const io2=fakeCloud();
  await W.syncWindow(fakeStore(),mk('lost0001','2026-10-31T12:00:00.000Z','2026-10-31T12:00:30.000Z','2026-10-31',{ownPendR:['500']}),io2,at('2026-10-31T12:01:00Z'));
  await W.syncWindow(fakeStore(),mk('lost0001','2026-10-31T14:58:00.000Z','2026-10-31T14:59:50.000Z','2026-10-31',{ownPendR:['500','501']}),io2,at('2026-10-31T15:00:05Z'));
  assert.equal(io2.rows['~lease'].data.month,'2026-11'); assert.deepEqual(io2.rows['~lease'].data.ownPendR,[]);
  r=await W.syncWindow(fakeStore(),mk('new00001','2026-10-31T16:06:00.000Z','2026-10-31T16:06:30.000Z','2026-11-01',{force:1,countFrom:'2026-08-01'}),io2,at('2026-10-31T16:07:00Z'));
  assert.equal(r.goal.lease.ok,true); assert.deepEqual(r.goal.lease.pendR,[],'10월 번호는 11월에 세지 않는다');
});

test('a renewal built last month that reaches the server in the new month does not record last month\'s income as the renewal amount, so recovering that lost device in the new month is not blocked',async()=>{
  const io=fakeCloud(), uid='u1', at=s=>({uid,now:new Date(s)}), oct=[['1','2026-10-31'],['2','2026-10-31']];
  const mk=(dev,c,b,to,rv,o)=>Object.assign({v:1,gk:7,seq:1,acct:'abc',device:dev,countedAt:c,builtAt:b,work:{v:1,from:'2026-10-01',to,reviews:rv,products:[]}},o||{});
  await W.syncWindow(fakeStore(),mk('lost0001','2026-10-31T12:00:00.000Z','2026-10-31T12:00:30.000Z','2026-10-31',oct),io,at('2026-10-31T12:01:00Z'));
  assert.equal(io.rows['~lease'].data.renewWon,1000);
  await W.syncWindow(fakeStore(),mk('lost0001','2026-10-31T14:58:00.000Z','2026-10-31T14:59:50.000Z','2026-10-31',oct),io,at('2026-10-31T15:00:05Z'));
  assert.equal(io.rows['~lease'].data.month,'2026-11');
  assert.equal(io.rows['~lease'].data.renewWon,null,'11월 행에 10월 금액(1,000)을 적지 않는다 — 이 기록엔 11월이 아직 없다');
  const r=await W.syncWindow(fakeStore(),mk('new00001','2026-10-31T16:06:00.000Z','2026-10-31T16:06:30.000Z','2026-11-01',oct,{force:1,countFrom:'2026-08-01'}),io,at('2026-10-31T16:07:00Z'));
  assert.equal(r.goal.lease.ok,true,'11월 금액이 10월 금액보다 적어도 가져온다 (예전: 11월 내내 못 가져옴)');
  assert.equal(io.rows['~lease'].data.renewWon,0,'가져온 쪽 갱신 금액은 11월 것');
});

test('a device not on Korean time: the row gets the Korean month\'s income, and the lists it sends are judged by when they were built (Korean month), not by its local date',async()=>{
  const uid='u1', at=s=>({uid,now:new Date(s)}), oct=[['1','2026-10-31'],['2','2026-10-31']];
  const mk=(dev,c,b,to,rv,o)=>Object.assign({v:1,gk:7,seq:1,acct:'abc',device:dev,countedAt:c,builtAt:b,work:{v:1,from:'2026-10-01',to,reviews:rv,products:[]}},o||{});
  /* 한국보다 늦은 시간대(UTC) 기기 — 한국은 11/1 04:00~05:00 인데 기기 날짜(work.to)는 10/31 */
  let io=fakeCloud();
  await W.syncWindow(fakeStore(),mk('office01','2026-10-31T18:59:00.000Z','2026-10-31T18:59:30.000Z','2026-10-31',oct),io,at('2026-10-31T19:00:00Z'));
  assert.equal(io.rows['~lease'].data.month,'2026-11'); assert.equal(io.rows['~lease'].data.renewWon,null,'기기 날짜의 달(10월) 금액이 아니다');
  await W.syncWindow(fakeStore(),mk('office01','2026-10-31T19:58:00.000Z','2026-10-31T19:59:00.000Z','2026-10-31',oct,{release:1,pendR:['901']}),io,at('2026-10-31T20:00:00Z'));
  let row=io.rows['~lease'].data;
  assert.equal(row.closedMonth,'2026-11'); assert.equal(row.closedWon,null);
  assert.deepEqual(row.closedPendR,['901'],'한국 11월에 만든 목록은 기기 날짜가 10월이어도 넘긴다');
  let r=await W.syncWindow(fakeStore(),mk('home0001','2026-10-31T20:06:00.000Z','2026-10-31T20:06:30.000Z','2026-11-01',oct),io,at('2026-10-31T20:07:00Z'));
  assert.equal(r.goal.lease.ok,true); assert.deepEqual(r.goal.lease.pendR,['901']);
  /* 한국보다 이른 시간대(UTC+10) 기기 — 한국은 10/31 23:00~23:30 인데 기기 날짜는 11/1 */
  io=fakeCloud();
  await W.syncWindow(fakeStore(),mk('office01','2026-10-31T13:59:00.000Z','2026-10-31T13:59:30.000Z','2026-11-01',oct),io,at('2026-10-31T14:00:00Z'));
  assert.equal(io.rows['~lease'].data.month,'2026-10'); assert.equal(io.rows['~lease'].data.renewWon,1000,'기기 날짜의 달(11월, 0원)이 아니라 한국 10월 금액');
  await W.syncWindow(fakeStore(),mk('office01','2026-10-31T14:28:00.000Z','2026-10-31T14:29:00.000Z','2026-11-01',oct,{release:1,pendR:['902']}),io,at('2026-10-31T14:30:00Z'));
  row=io.rows['~lease'].data;
  assert.equal(row.closedMonth,'2026-10'); assert.equal(row.closedWon,1000);
  assert.deepEqual(row.closedPendR,['902'],'한국 10월에 만든 목록은 기기 날짜가 11월이어도 버리지 않는다');
  const saved=JSON.parse(JSON.stringify(io.rows['2026-10']));
  io.rows['2026-10'].data._auto.r['31']=['1']; io.rows['2026-10'].data.days['31'].r=1; io.rows['2026-10'].data.days['31'].auto={r:1,p:0};   /* 서버 달 기록이 덮여 2번이 빠졌다 */
  r=await W.syncWindow(fakeStore(),mk('home0001','2026-10-31T14:36:00.000Z','2026-10-31T14:36:30.000Z','2026-10-31',[['1','2026-10-31']]),io,at('2026-10-31T14:37:00Z'));
  assert.equal(r.goal.lease.why,'behind','닫을 때 금액이 10월 것이라 빠진 기록을 알아챈다');
  io.rows['2026-10']=saved;
  r=await W.syncWindow(fakeStore(),mk('home0001','2026-10-31T14:38:00.000Z','2026-10-31T14:38:30.000Z','2026-10-31',oct),io,at('2026-10-31T14:39:00Z'));
  assert.equal(r.goal.lease.ok,true); assert.deepEqual(r.goal.lease.pendR,['902']);
});
