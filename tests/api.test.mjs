import {databaseV42 as database} from './v42-helper.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/publicacoes.js';
import {rpc,cnj,A} from './db-helper.mjs';
test('API autenticada + SQL: 205 itens, falha HTTP intermediária e retomada completa',async()=>{
 const db=await database(),originalFetch=globalThis.fetch,oldURL=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_ANON_KEY;
 const oab=(await db.query("insert into oabs_monitoradas(numero_oab,uf) values('123456','SP') returning id")).rows[0].id;
 const id=await rpc(db,'iniciar_sync',[oab,'2026-10-15','2026-10-15']);let failPage2=true;
 process.env.SUPABASE_URL='https://fake.supabase.co';process.env.SUPABASE_ANON_KEY='public-test-key';
 globalThis.fetch=async(input,opts={})=>{
  const url=new URL(input);
  if(url.pathname==='/auth/v1/user')return Response.json({id:A});
  if(url.pathname.startsWith('/rest/v1/rpc/')){const body=JSON.parse(opts.body||'{}');return Response.json(await rpc(db,url.pathname.split('/').pop(),Object.values(body)));}
  if(url.pathname.startsWith('/rest/v1/')){const table=url.pathname.split('/').pop();if(!['sincronizacoes','oabs_monitoradas'].includes(table))throw new Error('Rota inesperada');return Response.json((await db.query('select * from '+table+' where id=$1',[url.searchParams.get('id').slice(3)])).rows.map(r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k,v instanceof Date?(['inicio','fim','checkpoint_data'].includes(k)?v.toISOString().slice(0,10):v.toISOString()):v]))));}
  assert.equal(url.hostname,'comunicaapi.pje.jus.br');assert.equal(url.searchParams.get('numeroOab'),'123456');
  const page=Number(url.searchParams.get('pagina'));if(page===2&&failPage2)return new Response('indisponível',{status:500});
  const start=(page-1)*100;return Response.json({count:205,items:Array.from({length:Math.min(100,205-start)},(_,i)=>({id:'real-protocol-'+(start+i),texto:'Comunicação teste '+(start+i),numero_processo:cnj(1),data_disponibilizacao:'2026-10-15',siglaTribunal:'TJSP'}))});
 };
 const call=async()=>{const res={setHeader(){},status(n){this.code=n;return this;},json(body){this.body=body;return this;}};await handler({method:'POST',headers:{authorization:'Bearer test'},body:{sincronizacao_id:id}},res);return res;};
 try{
  let response=await call();assert.equal(response.code,200);assert.equal(response.body.checkpoint_pagina,2);
  response=await call();assert.equal(response.code,502);assert.equal((await db.query('select estado from sincronizacoes where id=$1',[id])).rows[0].estado,'parcial');
  failPage2=false;response=await call();assert.equal(response.body.checkpoint_pagina,3);response=await call();assert.equal(response.body.estado,'concluida');assert.equal(response.body.inseridos,205);assert.equal(response.body.falhas,1);
  const pid=(await db.query('select id from publicacoes order by id limit 1')).rows[0].id;await rpc(db,'classificar_publicacao_v3',[pid,'Ciência, sem providência',false,'Preservada','',[],false,null]);
  const repeated=await rpc(db,'iniciar_sync',[oab,'2026-10-15','2026-10-15']);
  for(let page=1;page<=3;page++){const j=(await db.query('select * from sincronizacoes where id=$1',[repeated])).rows[0];const start=(page-1)*100;const items=Array.from({length:Math.min(100,205-start)},(_,i)=>({fonte:'DJEN',id_externo:'real-protocol-'+(start+i),texto_integral:'Comunicação teste '+(start+i),numero:cnj(1),data_disponibilizacao:'2026-10-15',tribunal:'TJSP'}));await rpc(db,'aplicar_lote_sync',[repeated,'2026-10-15',page,items,page<3]);}
  assert.equal(Number((await db.query('select count(*) n from publicacoes')).rows[0].n),205);assert.equal((await db.query('select duplicados from sincronizacoes where id=$1',[repeated])).rows[0].duplicados,205);assert.equal((await db.query('select triagem_status from publicacoes where id=$1',[pid])).rows[0].triagem_status,'classificada');
 }finally{globalThis.fetch=originalFetch;if(oldURL===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldURL;if(oldKey===undefined)delete process.env.SUPABASE_ANON_KEY;else process.env.SUPABASE_ANON_KEY=oldKey;await db.close();}
});
