const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
function harness(reply){
  const ST={'2026-09':{target:1,days:{},_u:'2026-09-09T00:00:00.000Z',_remote:'2026-09-08T00:00:00.000Z'}};const calls=[];
  const q={update(v){calls.push(['update',v]);return this;},insert(v){calls.push(['insert',v]);return this;},eq(k,v){calls.push(['eq',k,v]);return this;},select:async()=>reply(ST)};
  const ctx={ST,STORAGE_CONFLICT:false,SB_BUSY:false,SB_USER:{id:'test-user'},SB:{from:()=>q},LS:'test-storage',dirty:new Set(['2026-09']),month:m=>ST[m],persist:()=>true,sync:()=>{},toast:()=>{}};vm.createContext(ctx);
  const src=fs.readFileSync(require.resolve('../index.html'),'utf8').split('let PUSH_QUEUE=')[1].split('/* ── 모달 ── */')[0];vm.runInContext('let PUSH_QUEUE='+src+';globalThis.run=pushMonth;',ctx);return {ctx,calls,ST};
}
test('failed server write preserves dirty data',async()=>{
  const h=harness(()=>({error:Error('offline')}));assert.equal(await h.ctx.run('2026-09'),false);assert.equal(h.ctx.dirty.has('2026-09'),true);
});
test('successful version is cleared using conditional timestamp update',async()=>{
  const h=harness(()=>({data:[{month:'2026-09'}]}));assert.equal(await h.ctx.run('2026-09'),true);assert.equal(h.ctx.dirty.size,0);
  assert.ok(h.calls.some(x=>x[0]==='eq'&&x[1]==='updated_at'&&x[2]==='2026-09-08T00:00:00.000Z'));
});
test('editing while a write is in flight remains dirty',async()=>{
  const h=harness(ST=>{ST['2026-09']._u='2026-09-09T01:00:00.000Z';return {data:[{month:'2026-09'}]};});await h.ctx.run('2026-09');assert.equal(h.ctx.dirty.has('2026-09'),true);
});
test('remote conflict is not reported successful',async()=>{
  const h=harness(()=>({data:[]}));assert.equal(await h.ctx.run('2026-09'),false);assert.equal(h.ctx.dirty.has('2026-09'),true);
});
