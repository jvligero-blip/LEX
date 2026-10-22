import {test} from 'node:test';
import assert from 'node:assert/strict';
import {as,rpc,pub,cnj,A,B,count} from './db-helper.mjs';
import {C,databaseV4} from './v4-helper.mjs';
import {upgradeNotifications,migration007} from './notifications-helper.mjs';
import {databaseV42 as databaseNotifications,upgradeV42} from './v42-helper.mjs';
const id=()=>crypto.randomUUID();
async function relation(db){await as(db,A);const r=await rpc(db,'v4_convidar',['b@lex.test',true]);await as(db,B);await rpc(db,'v4_responder_convite',[r,'aceitar']);await as(db,A);return r;}
async function task(db,folder=null,title='Compromisso privado'){const t=id();await rpc(db,'v4_salvar_compromisso',[t,folder,{descricao:title,responsavel:A}]);return t;}
const inbox=db=>rpc(db,'v4_listar_notificacoes');
test('reproduz a recusa V4.1 com relação ativa; 008 concede só após aceite, inclusive sem pasta',async()=>{
 const db=await databaseV4();try{
 await relation(db);const t=await task(db);await assert.rejects(()=>rpc(db,'v4_delegar',[id(),t,B]),/Destinatário não autorizado/);
 await upgradeNotifications(db);await upgradeV42(db);const pre=await rpc(db,'v4_destinatarios_delegacao',[t]);assert.equal(pre.candidatos[0].tem_acesso,false);assert.equal(pre.candidatos[0].pode_autorizar,true);
 await assert.rejects(()=>rpc(db,'v4_delegar_com_acesso',[id(),t,B,false]),/ainda é privada/);const req=id();await rpc(db,'v4_delegar_com_acesso',[req,t,B,true]);await rpc(db,'v4_delegar_com_acesso',[req,t,B,true]);assert.equal(await count(db,'v4_delegacoes'),1);
 await as(db,B);assert.equal((await db.query('select id from compromissos')).rows.length,0);assert.equal((await inbox(db)).itens.filter(n=>n.tipo==='delegacao').length,1);
 await rpc(db,'v4_responder_delegacao',[req,true]);assert.equal((await db.query('select responsavel from compromissos')).rows[0].responsavel,B);await rpc(db,'v4_atividade',[id(),t,'Providência realizada','concluido']);
 await as(db,A);const n=await inbox(db);assert.ok(n.itens.some(n=>n.tipo==='delegacao_aceita'));assert.ok(n.itens.some(n=>n.tipo==='compromisso_concluido'));
 }finally{await db.close();}
});
test('autorização individual não revela pasta, publicação nem outras tarefas; C é bloqueado',async()=>{
 const db=await databaseNotifications();try{
 await relation(db);const p=await rpc(db,'ingest_publicacao',[pub('privada')]);const f=(await db.query('select id from v4_pastas where processo_id=$1',[p.processo_id])).rows[0].id;const t=await task(db,f);await task(db,f,'Outra obrigação privada');
 const request=id();await rpc(db,'v4_delegar_com_acesso',[request,t,B,true]);await as(db,B);assert.equal(await count(db,'compromissos'),0);await rpc(db,'v4_responder_delegacao',[request,true]);assert.equal(await count(db,'compromissos'),1);assert.equal(await count(db,'v4_pastas'),0);assert.equal(await count(db,'processos'),0);assert.equal(await count(db,'publicacoes'),0);
 let row=(await db.query('select * from compromissos')).rows[0];await rpc(db,'v4_salvar_compromisso',[t,null,{descricao:'Descrição ajustada',responsavel:B},row.versao]);
 row=(await db.query('select * from compromissos')).rows[0];await assert.rejects(()=>rpc(db,'v4_salvar_compromisso',[t,null,{descricao:row.descricao,responsavel:A},row.versao]),/aceite/);
 await as(db,C);for(const tab of ['compromissos','compromisso_atividades','v4_notificacoes','v4_compromisso_acessos'])assert.equal(await count(db,tab),0,tab);
 await assert.rejects(()=>rpc(db,'v4_destinatarios_delegacao',[t]));await assert.rejects(()=>rpc(db,'v4_delegar_com_acesso',[id(),t,C,true]));await assert.rejects(()=>rpc(db,'v4_n_criar',[C,'atividade',A,'compromissos',t,'fraude']));
 }finally{await db.close();}
});
test('convite aparece no sininho; lida não significa aceita; sem recibo individual de leitura',async()=>{
 const db=await databaseNotifications();try{
 const r=await rpc(db,'v4_convidar',['b@lex.test',true]);await as(db,B);let n=await inbox(db);const convite=n.itens.find(n=>n.tipo==='convite');assert.ok(convite.responder);assert.equal(n.nao_lidas,1);
 await rpc(db,'v4_marcar_notificacoes_lidas',[[convite.id]]);await rpc(db,'v4_marcar_notificacoes_lidas',[[convite.id]]);assert.equal((await inbox(db)).nao_lidas,0);assert.equal((await db.query('select estado from v4_colaboracoes where id=$1',[r])).rows[0].estado,'pendente');
 await as(db,A);assert.equal((await inbox(db)).itens.filter(n=>n.tipo==='leitura').length,0);await as(db,B);await rpc(db,'v4_responder_convite',[r,'aceitar']);await as(db,A);assert.ok((await inbox(db)).itens.some(n=>n.tipo==='convite_aceito'));
 }finally{await db.close();}
});
test('notificações de atividade/análise só para membros; dados são ocultados após revogação',async()=>{
 const db=await databaseNotifications();try{
 const rel=await relation(db);const p=await rpc(db,'ingest_publicacao',[pub('notificar')]);const f=(await db.query('select id from v4_pastas where processo_id=$1',[p.processo_id])).rows[0].id;await rpc(db,'v4_compartilhar',[f,B]);const t=await task(db,f,'Título sigiloso compartilhado');await rpc(db,'v4_atividade',[id(),t,'Andamento de A','em_andamento']);await rpc(db,'v4_analisar',[p.id,'nada_a_fazer',id()]);
 await as(db,B);let n=await inbox(db);assert.ok(n.itens.some(n=>n.tipo==='publicacao_analisada'));assert.ok(n.itens.some(n=>n.tipo==='atividade'&&n.titulo==='Título sigiloso compartilhado'));
 await as(db,A);await rpc(db,'v4_responder_convite',[rel,'revogar']);await as(db,B);n=await inbox(db);assert.ok(!JSON.stringify(n).includes('Título sigiloso'));assert.ok(n.itens.filter(n=>['atividade','compromisso_criado'].includes(n.tipo)).every(n=>!n.acessivel&&n.registro_id===null));await assert.rejects(()=>rpc(db,'v4_atividade',[id(),t,'Negado']));
 await as(db,A);await rpc(db,'v4_convidar',['b@lex.test',true]);await as(db,B);const rr=(await db.query("select id from v4_colaboracoes where estado='pendente'")).rows[0].id;await rpc(db,'v4_responder_convite',[rr,'aceitar']);assert.equal(await count(db,'compromissos'),0);
 }finally{await db.close();}
});
test('upgrade histórico 001–006 -> 007 preserva registros V4, recupera pendências e não duplica na reaplicação',async()=>{
 const db=await databaseV4();try{
 const rel=await relation(db);const f=id();await rpc(db,'v4_salvar_pasta',[f,'Assunto',null,{},false]);await rpc(db,'v4_compartilhar',[f,B]);const t=await task(db,f);await rpc(db,'v4_delegar',[id(),t,B]);const old={};for(const tab of ['compromissos','publicacoes','processos','compromisso_atividades','v4_colaboracoes'])old[tab]=(await db.query('select * from '+tab)).rows;
 await upgradeNotifications(db);for(const [tab,rows] of Object.entries(old))assert.deepEqual((await db.query('select * from '+tab)).rows,rows,tab);
 await as(db,B);assert.equal((await inbox(db)).itens.filter(n=>n.tipo==='delegacao').length,1);await db.exec('reset role');await db.exec(await migration007());await as(db,B);assert.equal((await inbox(db)).itens.filter(n=>n.tipo==='delegacao').length,1);
 }finally{await db.close();}
});
test('notificações paginadas, leitura somente própria e helper de emissão bloqueado',async()=>{
 const db=await databaseNotifications();try{
 await relation(db);const t=await task(db);const request=id();await rpc(db,'v4_delegar_com_acesso',[request,t,B,true]);await as(db,B);await rpc(db,'v4_responder_delegacao',[request,true]);await as(db,A);for(let i=0;i<35;i++)await rpc(db,'v4_atividade',[id(),t,'Andamento '+i]);
 await as(db,B);const first=await rpc(db,'v4_listar_notificacoes',[10,null,false]);assert.equal(first.itens.length,10);assert.equal(first.tem_mais,true);const next=await rpc(db,'v4_listar_notificacoes',[10,first.itens.at(-1).id,false]);assert.ok(!next.itens.some(n=>first.itens.some(f=>f.id===n.id)));
 const privateId=first.itens[0].id;await as(db,C);assert.equal(await rpc(db,'v4_marcar_notificacoes_lidas',[[privateId]]),0);assert.equal((await inbox(db)).itens.length,0);await assert.rejects(()=>rpc(db,'v4_listar_notificacoes',[10,privateId,false]));
 await db.exec("reset role;set role anon;set request.jwt.claim.sub='';");await assert.rejects(()=>rpc(db,'v4_listar_notificacoes'));await assert.rejects(()=>rpc(db,'v4_n_criar',[B,'atividade',A,'compromissos',t,'fraude']));
 }finally{await db.close();}
});
test('terceiro com colaboração ativa continua fora do compromisso privado; revogação individual e da pasta',async()=>{
 const db=await databaseNotifications();try{
 await relation(db);const r=await rpc(db,'v4_convidar',['c@lex.test',false]);await as(db,C);await rpc(db,'v4_responder_convite',[r,'aceitar']);await as(db,A);
 const f=id();await rpc(db,'v4_salvar_pasta',[f,'Assunto reservado']);const t=await task(db,f);await rpc(db,'v4_delegar_com_acesso',[id(),t,B,true]);await as(db,C);assert.equal(await count(db,'compromissos'),0);assert.ok(!(await inbox(db)).itens.some(n=>n.destino==='compromisso'));
 await as(db,A);await rpc(db,'v4_compartilhar',[f,B]);await rpc(db,'v4_compartilhar',[f,B,false]);await as(db,B);assert.equal(await count(db,'compromissos'),0);
 await as(db,A);await rpc(db,'v4_delegar_com_acesso',[id(),t,B,true]);await rpc(db,'v4_revogar_acesso_compromisso',[t,B]);await as(db,B);assert.equal(await count(db,'compromissos'),0);
 }finally{await db.close();}
});
test('encaminhar publicação é atômico com a permissão: falha mantém pendente; retry não duplica',async()=>{
 const db=await databaseNotifications();try{
 await relation(db);const p=await rpc(db,'ingest_publicacao',[pub('encaminhar')]);const req=id(),t=id();const args=[p.id,req,B,'Executar providência',{id:t,descricao:'Providência'},false,'Providência administrativa','',false];
 await assert.rejects(()=>rpc(db,'v4_analisar_com_encaminhamento',args),/ainda é privada/);assert.equal(await count(db,'compromissos'),0);assert.equal((await db.query('select triagem_status from publicacoes')).rows[0].triagem_status,'pendente_de_analise');args[8]=true;
 await rpc(db,'v4_analisar_com_encaminhamento',args);await rpc(db,'v4_analisar_com_encaminhamento',args);assert.equal(await count(db,'compromissos'),1);assert.equal(await count(db,'v4_delegacoes'),1);
 await as(db,B);assert.equal(await count(db,'publicacoes'),0);assert.equal((await inbox(db)).itens.filter(n=>n.tipo==='delegacao').length,1);
 }finally{await db.close();}
});
