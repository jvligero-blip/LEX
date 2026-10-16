import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {database,as,rpc,count,pub,cnj,A,B} from './db-helper.mjs';
let db;
before(async()=>{db=await database();});after(async()=>db?.close());
test('3 publicações, 1 pasta; repetição não duplica nem cria tarefas',async()=>{
 for(const id of ['p1','p2','p3'])await rpc(db,'ingest_publicacao',[pub(id)]);
 assert.equal(await count(db,'processos'),1);assert.equal(await count(db,'publicacoes'),3);
 for(const id of ['p1','p2','p3'])assert.equal((await rpc(db,'ingest_publicacao',[pub(id)])).inserida,false);
 assert.equal(await count(db,'compromissos'),0);assert.equal(await count(db,'publicacoes'),3);
});
test('triagem é permanente; captura e classificação preservadas na revisão',async()=>{
 const old=(await db.query("select * from publicacoes where id_externo='p1'")).rows[0];
 await rpc(db,'classificar_publicacao',[old.id,'Ciência, sem providência','','visto',false]);
 await rpc(db,'ingest_publicacao',[pub('p1',1,{texto_integral:'Texto revisado pela fonte'})]);
 const p=(await db.query('select * from publicacoes where id=$1',[old.id])).rows[0];
 assert.equal(p.triagem_status,'classificada');assert.deepEqual(p.first_seen_at,old.first_seen_at);assert.equal(p.texto_integral,old.texto_integral);assert.equal(p.revisao_detectada,true);
 assert.equal(Number((await db.query("select count(*) n from historico_alteracoes where acao='REVISAO_FONTE'")).rows[0].n),1);
});
test('duas tarefas independentes, conclusão e reabertura; sync não recria',async()=>{
 const p=(await db.query("select * from publicacoes where id_externo='p2'")).rows[0];
 await rpc(db,'classificar_publicacao',[p.id,'Prazo processual','Providenciar documentos','',false]);
 const tasks=(await db.query("insert into compromissos(processo_id,publicacao_id,descricao,data_fatal_confirmada) values($1,$2,'A','2026-10-20'),($1,$2,'B',null) returning *",[p.processo_id,p.id])).rows;
 await db.query("update compromissos set status='concluido' where id=$1",[tasks[0].id]);
 assert.equal((await db.query('select status from compromissos where id=$1',[tasks[1].id])).rows[0].status,'pendente');
 await rpc(db,'ingest_publicacao',[pub('p2')]);assert.equal(await count(db,'compromissos'),2);
 await db.query("update compromissos set status='pendente' where id=$1",[tasks[0].id]);assert.equal(await count(db,'compromissos'),2);
 assert.equal((await db.query('select data_fatal_confirmada::text d from compromissos where id=$1',[tasks[0].id])).rows[0].d,'2026-10-20');
 await rpc(db,'classificar_publicacao',[p.id,'','','',true]);assert.equal((await db.query('select triagem_status from publicacoes where id=$1',[p.id])).rows[0].triagem_status,'pendente_de_analise');
});
test('CNJ normalizado, máscara e inválidos sem descarte da publicação',async()=>{
 const n=cnj(1),masked=n.slice(0,7)+'-'+n.slice(7,9)+'.'+n.slice(9,13)+'.'+n[13]+'.'+n.slice(14,16)+'.'+n.slice(16);
 assert.equal(await rpc(db,'ensure_processo',[n]),await rpc(db,'ensure_processo',[masked]));
 const r=await rpc(db,'ingest_publicacao',[pub('invalid',1,{numero:'123'})]);assert.equal(r.processo_id,null);
 await assert.rejects(()=>rpc(db,'ensure_processo',['123']));assert.equal(await count(db,'publicacoes'),4);
});
test('fingerprint estável sem ID; IDs diferentes com texto igual são preservados',async()=>{
 const item=pub(null,2,{texto_integral:'Sem id'});const a=await rpc(db,'ingest_publicacao',[item]);assert.equal((await rpc(db,'ingest_publicacao',[item])).id,a.id);
 const promoted=await rpc(db,'ingest_publicacao',[{...item,id_externo:'promoted'}]);assert.equal(promoted.id,a.id);
 const other=await rpc(db,'ingest_publicacao',[{...item,id_externo:'distinct'}]);assert.notEqual(other.id,a.id);
});
test('fallback distingue retificações, datas e identificadores da fonte',async()=>{
 const base=pub(null,8,{texto_integral:'Texto igual',raw:{hash:'certidao-1'}}),a=await rpc(db,'ingest_publicacao',[base]);
 const b=await rpc(db,'ingest_publicacao',[{...base,raw:{hash:'certidao-2'}}]);assert.notEqual(a.id,b.id);
 const c=await rpc(db,'ingest_publicacao',[{...base,data_publicacao:'2026-10-16'}]);assert.notEqual(a.id,c.id);
 const {fingerprint}= (await db.query('select fingerprint from publicacoes where id=$1',[a.id])).rows[0];assert.equal(fingerprint.length,64);
 await assert.rejects(()=>db.query("insert into publicacoes(fonte,id_externo,fingerprint,texto_integral) values('DJEN','p1','other','x')"));
});
test('duas OABs da mesma conta capturam uma publicação lógica',async()=>{
 const oabs=(await db.query("insert into oabs_monitoradas(numero_oab,uf) values('1','SP'),('2','RJ') returning id")).rows;
 const one=await rpc(db,'ingest_publicacao',[pub('multi'),oabs[0].id]);const two=await rpc(db,'ingest_publicacao',[pub('multi'),oabs[1].id]);assert.equal(one.id,two.id);
 assert.equal(Number((await db.query('select count(*) n from publicacao_oabs where publicacao_id=$1',[one.id])).rows[0].n),2);
});
test('RLS: mesmo CNJ em A/B, leitura/alteração/exclusão alheias e FK cruzada negadas',async()=>{
 const a=await rpc(db,'ensure_processo',[cnj(1)]);const pa=(await rpc(db,'ingest_publicacao',[pub('ownedA')])).id;
 await as(db,B);assert.equal(await count(db,'publicacoes'),0);const b=await rpc(db,'ensure_processo',[cnj(1)]);assert.notEqual(a,b);
 assert.equal((await db.query('select * from processos where id=$1',[a])).rows.length,0);
 assert.equal((await db.query("update processos set payload='{}' where id=$1 returning id",[a])).rows.length,0);
 assert.equal((await db.query('delete from processos where id=$1 returning id',[a])).rows.length,0);
 await assert.rejects(()=>db.query('insert into processos(user_id,numero_cnj) values($1,$2)',[A,cnj(3)]));
 await assert.rejects(()=>db.query("insert into compromissos(processo_id,descricao) values($1,'tentativa')",[a]));
 await assert.rejects(()=>db.query("insert into compromissos(processo_id,publicacao_id,descricao) values($1,$2,'tentativa')",[b,pa]));
 await assert.rejects(()=>rpc(db,'classificar_publicacao',[pa,'Outro','x','',false]));await as(db,A);
});
test('paginação transacional, falha intermediária, replay e retomada 205 itens',async()=>{
 const oab=(await db.query('select id from oabs_monitoradas limit 1')).rows[0].id;
 const j=await rpc(db,'iniciar_sync',[oab,'2026-10-15','2026-10-15']);
 const items=Array.from({length:100},(_,i)=>pub('batch'+i,3));
 let job=await rpc(db,'aplicar_lote_sync',[j,'2026-10-15',1,items,true]);assert.equal(job.checkpoint_pagina,2);
 await rpc(db,'registrar_falha_sync',[j,'HTTP 500']);assert.equal((await db.query('select estado from sincronizacoes where id=$1',[j])).rows[0].estado,'parcial');
 job=await rpc(db,'aplicar_lote_sync',[j,'2026-10-15',1,items,true]);assert.equal(job.paginas,1);
 job=await rpc(db,'aplicar_lote_sync',[j,'2026-10-15',2,items.map((_,i)=>pub('batch'+(i+100),3)),true]);
 job=await rpc(db,'aplicar_lote_sync',[j,'2026-10-15',3,Array.from({length:5},(_,i)=>pub('batch'+(i+200),3)),false]);
 assert.equal(job.estado,'concluida');assert.equal(job.itens,205);assert.equal(job.inseridos,205);assert.equal(job.paginas,3);
});
test('falha em um item reverte página inteira e mantém checkpoint',async()=>{
 const oab=(await db.query('select id from oabs_monitoradas limit 1')).rows[0].id,j=await rpc(db,'iniciar_sync',[oab,'2026-10-15','2026-10-15']);const previous=await count(db,'publicacoes');
 await assert.rejects(()=>rpc(db,'aplicar_lote_sync',[j,'2026-10-15',1,[pub('rollbackA'),pub('rollbackB',1,{data_disponibilizacao:'INVALID'})],false]));
 assert.equal(await count(db,'publicacoes'),previous);assert.equal((await db.query('select checkpoint_pagina from sincronizacoes where id=$1',[j])).rows[0].checkpoint_pagina,1);
});
test('legado reimportável, inválidos em revisão e nenhuma sugestão gera tarefa',async()=>{
 const d={num:cnj(4),parte:'Legado',obs:'Preservar'},params=['processos','OLD:proc1',d,d];
 assert.equal((await rpc(db,'importar_legado',params)).estado,'importado');assert.equal((await rpc(db,'importar_legado',params)).estado,'existente');
 const p=pub('legacy',4,{triagem_status:'classificada',classificacao:'Ciência, sem providência'});
 await rpc(db,'importar_legado',['publicacoes','OLD:pub1',p,p]);await rpc(db,'importar_legado',['publicacoes','OLD:pub1',p,p]);
 const task={proc:cnj(4),desc:'Legacy task',data:'2026-10-20',status:'concluido',pubId:'pub1'};
 const a=await rpc(db,'importar_legado',['compromissos','OLD:task1',task,task]);assert.equal((await rpc(db,'importar_legado',['compromissos','OLD:task1',task,task])).estado,'existente');
 const persisted=(await db.query('select * from compromissos where id=$1',[a.id])).rows[0];assert.equal(persisted.status,'concluido');assert.ok(persisted.publicacao_id);
 const before=await count(db,'compromissos');await rpc(db,'importar_legado',['fila','OLD:suggestion',{idCNJ:'legacy',confirmado:false},{}]);assert.equal(await count(db,'compromissos'),before);
 assert.equal((await rpc(db,'importar_legado',['processos','OLD:bad',{num:'12'},{num:'12',parte:'não perder'}])).estado,'revisao');
 assert.equal(await count(db,'migracao_revisao'),1);
});
test('revisão humana obrigatória e menções não calculam fatal',async()=>{
 const p=await rpc(db,'ingest_publicacao',[pub('regex',5,{texto_integral:'Sentença, embargos, prazo de cinco dias'})]);
 await assert.rejects(()=>rpc(db,'classificar_publicacao',[p.id,'Outro','','',false]));
 assert.equal((await db.query('select count(*) n from compromissos where publicacao_id=$1',[p.id])).rows[0].n,0);
});
test('audiência manual sem cliente vincula pasta; restrição impede exclusão da pasta',async()=>{
 const id=await rpc(db,'ensure_processo',[cnj(6)]);await db.query("insert into audiencias(processo_id,data,hora) values($1,'2026-10-20','14:30')",[id]);await assert.rejects(()=>db.query('delete from processos where id=$1',[id]));
});
test('vínculo corrigido move acompanhamentos derivados e registra auditoria',async()=>{
 const publication=await rpc(db,'ingest_publicacao',[pub('unlinked',1,{numero:''})]);const task=(await db.query("insert into compromissos(publicacao_id,descricao) values($1,'Vincular depois') returning id",[publication.id])).rows[0].id;
 const folder=await rpc(db,'vincular_publicacao',[publication.id,cnj(9)]);assert.equal((await db.query('select processo_id from compromissos where id=$1',[task])).rows[0].processo_id,folder);
 assert.ok((await db.query("select id from historico_alteracoes where registro_id=$1 and acao='UPDATE'",[task])).rows.length>0);
});
test('restauração é idempotente, pertence à conta e não sobrescreve dados atuais',async()=>{
 const pid=crypto.randomUUID(),snapshot={format:'lex-online',user_id:A,data:{processos:[{id:pid,user_id:A,numero_cnj:cnj(7),payload:{parte:'Backup'},created_at:new Date().toISOString(),updated_at:new Date().toISOString()}]}};
 assert.equal(await rpc(db,'restaurar_backup',[snapshot]),1);assert.equal(await rpc(db,'restaurar_backup',[snapshot]),0);
 await as(db,B);await assert.rejects(()=>rpc(db,'restaurar_backup',[snapshot]));await as(db,A);
});
test('backup completo restaura publicações, tarefas, audiências, vínculos e auditoria em outra instância local',async()=>{
 const names=['profiles','processos','oabs_monitoradas','publicacoes','publicacao_oabs','compromissos','audiencias','sincronizacoes','migracao_refs','migracao_revisao','historico_alteracoes'],data={};
 for(const name of names)data[name]=(await db.query('select * from '+name)).rows;
 const backup={format:'lex-online',user_id:A,data};const target=await database();
 try{assert.ok(await rpc(target,'restaurar_backup',[backup])>0);assert.equal(await rpc(target,'restaurar_backup',[backup]),0);
 for(const name of ['publicacoes','compromissos','audiencias','publicacao_oabs'])assert.equal(await count(target,name),data[name].length);
 const classified=data.publicacoes.find(p=>p.triagem_status==='classificada');assert.equal((await target.query('select triagem_status from publicacoes where id=$1',[classified.id])).rows[0].triagem_status,'classificada');
 assert.ok(await count(target,'historico_alteracoes')>=data.historico_alteracoes.length);
 }finally{await target.close();}
});
test('sem acesso anônimo ou adulteração da auditoria; cota persistente',async()=>{
 await assert.rejects(()=>db.query("insert into historico_alteracoes(entidade,registro_id,acao) values('x',gen_random_uuid(),'fake')"));
 for(let i=0;i<30;i++)assert.equal(await rpc(db,'reservar_consulta'),true);assert.equal(await rpc(db,'reservar_consulta'),false);
 await db.exec('reset role;set role anon;');await assert.rejects(()=>db.query('select * from publicacoes'));await assert.rejects(()=>rpc(db,'ingest_publicacao',[pub('anon')]));await as(db,A);
});
