import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {database,as,rpc,count,pub,cnj,A,B} from './db-helper.mjs';
const migration=()=>readFile(new URL('../supabase/migrations/004_v3_fluxos.sql',import.meta.url),'utf8');
test('V3 aditiva preserva registros, IDs, Auth, classificações e RLS anteriores',async()=>{
 const db=await database({v3:false});try{
 const p=await rpc(db,'ingest_publicacao',[pub('pre-v3')]);await rpc(db,'classificar_publicacao',[p.id,'Ciência, sem providência','legado','observação antiga',false]);
 await db.query("insert into compromissos(processo_id,publicacao_id,descricao,status) values($1,$2,'Legado sem data','concluido')",[p.processo_id,p.id]);
 await db.query("insert into audiencias(processo_id,data,hora) values($1,'2026-10-20','09:30')",[p.processo_id]);
 const before={};for(const table of ['processos','publicacoes','compromissos','audiencias'])before[table]=(await db.query('select * from '+table)).rows;
 await db.exec('reset role');await db.exec(await migration());await as(db,A);
 for(const [table,records]of Object.entries(before)){const current=(await db.query('select * from '+table)).rows;assert.equal(current.length,records.length);for(const row of records){const after=current.find(x=>x.id===row.id);for(const k of Object.keys(row))assert.deepEqual(after[k],row[k]);}}
 assert.equal((await db.query('select exige_providencia from publicacoes')).rows[0].exige_providencia,null);
 await as(db,B);for(const table of ['processos','publicacoes','compromissos','audiencias','compromisso_atividades'])assert.equal(await count(db,table),0);
 await db.exec('reset role');assert.equal(Number((await db.query('select count(*) n from auth.users')).rows[0].n),2);
 // Reexecução idempotente da única migration nova.
 await db.exec(await migration());
 }finally{await db.close();}
});
test('classificação exige tarefa transacional, rollback integral e retry idempotente',async()=>{
 const db=await database();try{
 const p=await rpc(db,'ingest_publicacao',[pub('atomic')]);const args=[p.id,'Outro',true,'Solicitar autorização','',[],false,null];
 await assert.rejects(()=>rpc(db,'classificar_publicacao_v3',args));assert.equal((await db.query('select triagem_status from publicacoes where id=$1',[p.id])).rows[0].triagem_status,'pendente_de_analise');
 const task={id:crypto.randomUUID(),processo_id:p.processo_id,descricao:'Solicitar autorização'};
 await assert.rejects(()=>rpc(db,'classificar_publicacao_v3',[...args.slice(0,5),[task,{id:crypto.randomUUID(),processo_id:p.processo_id,descricao:''}],false,null]));assert.equal(await count(db,'compromissos'),0);
 args[5]=[task];await Promise.all([rpc(db,'classificar_publicacao_v3',args),rpc(db,'classificar_publicacao_v3',args)]);assert.equal(await count(db,'compromissos'),1);
 const old=(await db.query('select * from publicacoes where id=$1',[p.id])).rows[0];assert.equal(old.exige_providencia,true);assert.equal(old.triagem_status,'classificada');
 await rpc(db,'classificar_publicacao_v3',[p.id,'',false,'','',[],true,'Conferir autos']);assert.equal(await count(db,'publicacoes'),1);assert.equal(await count(db,'compromissos'),1);
 await rpc(db,'ingest_publicacao',[pub('atomic')]);assert.equal((await db.query('select triagem_status from publicacoes where id=$1',[p.id])).rows[0].triagem_status,'pendente_de_analise');
 await rpc(db,'classificar_publicacao_v3',[p.id,'Ciência, sem providência',false,'','Confirmado',[],false,null]);assert.equal(await count(db,'compromissos'),1);
 await assert.rejects(()=>db.query("update publicacoes set texto_integral='alterado' where id=$1",[p.id]));
 }finally{await db.close();}
});
test('proteção contra baixa direta sem compromisso e contra RPC de outra conta',async()=>{
 const db=await database();try{
 const p=await rpc(db,'ingest_publicacao',[pub('guard')]);await assert.rejects(()=>db.query("update publicacoes set triagem_status='classificada',exige_providencia=true where id=$1",[p.id]));
 await as(db,B);await assert.rejects(()=>rpc(db,'classificar_publicacao_v3',[p.id,'Outro',false,'x','',[],false,null]));
 }finally{await db.close();}
});
test('andamentos preservam título, datas, vínculos; estados, conclusão/reabertura e RLS',async()=>{
 const db=await database();try{
 const p=await rpc(db,'ingest_publicacao',[pub('activities')]),task=(await db.query("insert into compromissos(processo_id,publicacao_id,descricao,data_fatal_confirmada) values($1,$2,'Interpor apelação','2026-10-20') returning id",[p.processo_id,p.id])).rows[0].id;
 const id1=crypto.randomUUID();await rpc(db,'registrar_atividade_v3',[id1,task,'Solicitada autorização','aguardando_terceiro','Gerar guia','2026-10-18']);await rpc(db,'registrar_atividade_v3',[id1,task,'Solicitada autorização','aguardando_terceiro','Gerar guia','2026-10-18']);
 await rpc(db,'registrar_atividade_v3',[crypto.randomUUID(),task,'Guia emitida','em_andamento','Elaborar recurso',null]);
 let t=(await db.query('select *,data_fatal_confirmada::text fatal from compromissos where id=$1',[task])).rows[0];assert.equal(t.descricao,'Interpor apelação');assert.equal(t.fatal,'2026-10-20');assert.equal(t.status,'em_andamento');assert.equal(await count(db,'compromisso_atividades'),2);
 await rpc(db,'registrar_atividade_v3',[crypto.randomUUID(),task,'Protocolado','concluido',null,null]);t=(await db.query('select * from compromissos where id=$1',[task])).rows[0];assert.ok(t.concluido_em);assert.equal(t.concluido_por,A);
 await rpc(db,'registrar_atividade_v3',[crypto.randomUUID(),task,'Conferir protocolo','pendente',null,null]);assert.equal(await count(db,'compromisso_atividades'),4);
 assert.equal((await db.query('select concluido_em from compromissos where id=$1',[task])).rows[0].concluido_em,null);
 await as(db,B);assert.equal(await count(db,'compromisso_atividades'),0);await assert.rejects(()=>rpc(db,'registrar_atividade_v3',[crypto.randomUUID(),task,'invasão','concluido',null,null]));
 await assert.rejects(()=>db.query("insert into compromisso_atividades(compromisso_id,texto) values($1,'invasão')",[task]));
 }finally{await db.close();}
});
test('backup V3 restaura classificação com providência e timeline sem recriar tarefas',async()=>{
 const db=await database(),target=await database();try{
 const p=await rpc(db,'ingest_publicacao',[pub('backup-v3')]),task=crypto.randomUUID();
 await rpc(db,'classificar_publicacao_v3',[p.id,'Prazo processual',true,'Recurso','',[{id:task,processo_id:p.processo_id,descricao:'Recurso'}],false,null]);
 await rpc(db,'registrar_atividade_v3',[crypto.randomUUID(),task,'Preparando minuta','em_andamento',null,null]);
 const data={};for(const table of ['processos','publicacoes','compromissos','compromisso_atividades','historico_alteracoes'])data[table]=(await db.query('select * from '+table)).rows;
 const backup={format:'lex-online',user_id:A,data};assert.ok(await rpc(target,'restaurar_backup',[backup])>0);assert.equal(await rpc(target,'restaurar_backup',[backup]),0);
 assert.equal(await count(target,'compromisso_atividades'),1);assert.equal(await count(target,'compromissos'),1);assert.equal((await target.query('select exige_providencia from publicacoes')).rows[0].exige_providencia,true);
 }finally{await db.close();await target.close();}
});
