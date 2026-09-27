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
  /* 사람이 고친 것은 조정값으로 유지 */
  again.months['2026-09'].days['11'].r=175;
  const more=Object.assign({},work,{reviews:work.reviews.concat([['500','2026-09-11']])});
  const r3=W.applyWork(again.months,more);
  assert.equal(r3.months['2026-09'].days['11'].r,176,'자동 172 + 직접 조정 +4');
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
