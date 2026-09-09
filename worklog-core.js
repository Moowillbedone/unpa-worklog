/* Shared, dependency-free validation and merge rules. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.WorklogCore=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function date(s){return typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;}
  function integer(n){return typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;}
  function months(input){
    if(!input||typeof input!=='object'||Array.isArray(input))throw Error('월 데이터 형식 오류');
    const result={};
    for(const [m,v] of Object.entries(input)){
      if(!date(m+'-01')||!v||typeof v.days!=='object'||Array.isArray(v.days)||!integer(v.target))throw Error('월/목표 형식 오류: '+m);
      const copy=JSON.parse(JSON.stringify(v));
      for(const [d,x] of Object.entries(copy.days))if(!date(m+'-'+d)||!x||!integer(x.r)||!integer(x.p)||typeof (x.memo||'')!=='string'||typeof (x.unreg||'')!=='string')throw Error('일별 데이터 형식 오류: '+m+'-'+d);
      result[m]=copy;
    }return result;
  }
  function mergeAudit(old,incoming){
    if(!incoming||!date(incoming.date)||!Array.isArray(incoming.items))throw Error('검수 기록 형식 오류');
    const rows=new Map((old&&old.items||[]).map(x=>[String(x.id),x]));
    for(const x of incoming.items){
      if(!x||!/^\d+$/.test(String(x.id))||(x.applied!==undefined&&typeof x.applied!=='boolean'))throw Error('검수 항목 형식 오류');
      const prior=rows.get(String(x.id));
      rows.set(String(x.id),prior&&prior.applied&&!x.applied?prior:{...x,applied:x.applied===true});
    }
    const events=new Map();
    for(const x of [...(old&&old.executions||[]),...(incoming.executions||[])])events.set([x.id,x.action,x.at].join(':'),x);
    return {...old,...incoming,items:[...rows.values()],executions:[...events.values()]};
  }
  function unappliedIds(ids,ledger){if(!Array.isArray(ids)||ids.some(id=>!/^\d+$/.test(String(id))))throw Error('리뷰 식별자 오류');return [...new Set(ids.map(String))].filter(id=>!ledger[id]);}
  return {date,months,mergeAudit,unappliedIds};
});
