import {test} from 'node:test';
import assert from 'node:assert/strict';
import {database,as,rpc,count,pub,cnj,A,B} from './db-helper.mjs';
import {databaseV4,upgrade,sqlV4,sqlV4Extra,C} from './v4-helper.mjs';
import {personalBackup} from '../lib/v4-domain.js';
const id=()=>crypto.randomUUID();
const task=(descricao='Protocolar ação',extra={})=>({descricao,responsavel:A,...extra});
async function subject(db,title='Maria — Preparar ação'){const fid=id();await rpc(db,'v4_salvar_pasta',[fid,title,null,{},false]);return fid;}
async function collaborate(db,auto=false){await as(db,A);const c=await rpc(db,'v4_convidar',['b@lex.test',auto]);await as(db,B);await rpc(db,'v4_responder_convite',[c,'aceitar']);await as(db,A);return c;}
async function folder(db,p){return (await db.query('select id from v4_pastas where processo_id=$1',[p])).rows[0].id;}
const strong=(ext='ato',seq=1,extra={})=>pub(ext,seq,{orgao:'1ª Vara',tipo:'Intimação',texto_integral:'Intimação para conferência de documento original do ato '+ext,...extra});
async function pair(db,auto=false){await collaborate(db,auto);const a=await rpc(db,'ingest_publicacao',[strong()]);const f=await folder(db,a.processo_id);await rpc(db,'v4_compartilhar',[f,B,true]);await as(db,B);const b=await rpc(db,'ingest_publicacao',[strong()]);const bf=await folder(db,b.processo_id);await rpc(db,'v4_compartilhar',[bf,A,true]);await as(db,A);return {a,b,f,bf};}
test('V4 migration aditiva/reexecutável preserva cada campo, ID e status V3',async()=>{
 const db=await database();try{
 const p=await rpc(db,'ingest_publicacao',[pub('old')]);await rpc(db,'classificar_publicacao_v3',[p.id,'Ciência, sem providência',false,'Observação histórica','original',[],false,null]);
 const t=id();await db.query("insert into compromissos(id,processo_id,descricao) values($1,$2,'Título antigo')",[t,p.processo_id]);await rpc(db,'registrar_atividade_v3',[id(),t,'Feito','concluido']);
 const before={};for(const table of ['processos','publicacoes','compromissos','compromisso_atividades','historico_alteracoes'])before[table]=(await db.query('select * from '+table)).rows;
 await upgrade(db);await db.exec('reset role');await db.exec(await sqlV4());await db.exec(await sqlV4Extra());await as(db,A);
 for(const [table,records] of Object.entries(before)){const after=(await db.query('select * from '+table)).rows;assert.equal(after.length,records.length);for(const row of records)for(const k in row)assert.deepEqual(after.find(r=>r.id===row.id)[k],row[k],table+'.'+k);}
 await rpc(db,'ingest_publicacao',[pub('old')]);assert.equal((await db.query('select triagem_status from publicacoes')).rows[0].triagem_status,'classificada');
 }finally{await db.close();}
});
test('isolamento A/B/C, convite pendente, aceite sem escopo, busca exata e sem listagem',async()=>{
 const db=await databaseV4();try{
 const f=await subject(db);await rpc(db,'v4_salvar_compromisso',[id(),f,task()]);const inv=await rpc(db,'v4_convidar',['b@lex.test',false]);
 await as(db,B);for(const t of ['v4_pastas','compromissos','compromisso_atividades','historico_alteracoes'])assert.equal(await count(db,t),0);
 await assert.rejects(()=>rpc(db,'v4_compartilhar',[f,B,true]));await rpc(db,'v4_responder_convite',[inv,'aceitar']);assert.equal(await count(db,'v4_pastas'),0);
 await as(db,C);assert.equal(await count(db,'v4_colaboracoes'),0);await assert.rejects(()=>rpc(db,'v4_responder_convite',[inv,'aceitar']));assert.equal(await rpc(db,'v4_convidar',['%lex.test',false]),null);for(let n=0;n<5;n++)assert.equal(await rpc(db,'v4_convidar',['inexistente@lex.test',false]),null);assert.equal(await rpc(db,'v4_convidar',['a@lex.test',false]),null,'tentativas inválidas consomem a cota; não pode enumerar sem limite');
 }finally{await db.close();}
});
test('compromisso manual é uma linha; Ana cria/atualiza na pasta de A com autoria real',async()=>{
 const db=await databaseV4();try{
 await collaborate(db);const f=await subject(db);await rpc(db,'v4_compartilhar',[f,B]);const t=id();await rpc(db,'v4_salvar_compromisso',[t,f,task('Protocolar ação',{data_fatal_confirmada:'2026-11-10'})]);
 await as(db,B);assert.equal((await db.query('select id from compromissos')).rows[0].id,t);
 await rpc(db,'v4_atividade',[id(),t,'Minuta pronta','aguardando_terceiro','Pedir guia','2026-10-28']);
 let row=(await db.query('select * from compromissos')).rows[0];assert.equal(row.descricao,'Protocolar ação');assert.equal(row.data_fatal_confirmada.toISOString().slice(0,10),'2026-11-10');assert.equal(row.criado_por,A);assert.equal(row.responsavel,A);assert.equal(row.atualizado_por,B);
 const bt=id();await rpc(db,'v4_salvar_compromisso',[bt,f,task('Pedir documento',{responsavel:B})]);assert.equal((await db.query('select * from compromissos where id=$1',[bt])).rows[0].user_id,A);
 await as(db,A);assert.equal(await count(db,'compromissos'),2);assert.equal((await db.query('select ator from compromisso_atividades')).rows[0].ator,B);
 await rpc(db,'v4_atividade',[id(),t,'Protocolo concluído','concluido']);await as(db,B);row=(await db.query('select * from compromissos where id=$1',[t])).rows[0];assert.equal(row.status,'concluido');assert.equal(row.concluido_por,A);
 }finally{await db.close();}
});
test('terceiro não lista/conta/lê/escreve por ID conhecido, nem RPC ou anônimo',async()=>{
 const db=await databaseV4();try{
 const {a,f}=await pair(db);const t=id();await rpc(db,'v4_salvar_compromisso',[t,f,task()]);await rpc(db,'v4_atividade',[id(),t,'Passo registrado']);await as(db,C);
 for(const table of ['processos','publicacoes','publicacao_oabs','audiencias','compromissos','compromisso_atividades','v4_pastas','v4_membros','v4_decisoes','historico_alteracoes'])assert.equal(await count(db,table),0,table);
 for(const [fn,args] of [['v4_atividade',[id(),t,'Ataque']],['v4_salvar_compromisso',[t,f,task(),1]],['v4_assumir',[t]],['v4_analisar',[a.id,'nada_a_fazer',id()]],['v4_compartilhar',[f,C,true]],['v4_reabrir',[a.id,false]]])await assert.rejects(()=>rpc(db,fn,args),fn);
 assert.equal((await rpc(db,'v4_contexto')).publicacoes.length,0);assert.equal((await db.query("update compromissos set descricao='Ataque' where id=$1 returning id",[t])).rows.length,0);
 await db.exec("reset role;set role anon;set request.jwt.claim.sub='';");await assert.rejects(()=>rpc(db,'v4_contexto'));await assert.rejects(()=>rpc(db,'v4_atividade',[id(),t,'Ataque']));
 }finally{await db.close();}
});
test('revogar pasta/relação encerra leitura/escrita, retém tarefa e atividades e não reativa grants antigos',async()=>{
 const db=await databaseV4();try{
 const relation=await collaborate(db);const f=await subject(db);await rpc(db,'v4_compartilhar',[f,B]);const t=id();await rpc(db,'v4_salvar_compromisso',[t,f,task()]);await as(db,B);await rpc(db,'v4_atividade',[id(),t,'Histórico']);
 await as(db,A);await rpc(db,'v4_compartilhar',[f,B,false]);await as(db,B);assert.equal(await count(db,'compromissos'),0);await assert.rejects(()=>rpc(db,'v4_atividade',[id(),t,'Negado']));
 await as(db,A);assert.equal(await count(db,'compromissos'),1);assert.equal(await count(db,'compromisso_atividades'),1);await rpc(db,'v4_compartilhar',[f,B]);await rpc(db,'v4_responder_convite',[relation,'revogar']);await as(db,B);assert.equal(await count(db,'v4_pastas'),0);
 await collaborate(db);await as(db,B);assert.equal(await count(db,'v4_pastas'),0);
 }finally{await db.close();}
});
test('CNJ igual privado permanece privado; auto exige cliente compatível e respeita restrição',async()=>{
 const db=await databaseV4();try{
 const pa=await rpc(db,'ensure_processo',[cnj(9),{cliente_nome:'Maria',lado:'autora'}]);await as(db,B);await rpc(db,'ensure_processo',[cnj(9),{cliente_nome:'Carlos',lado:'réu'}]);await as(db,A);await collaborate(db,true);
 assert.equal(await count(db,'processos'),1);await as(db,B);assert.equal(await count(db,'processos'),1);
 await db.query("update processos set payload=$1 where user_id=$2",[{cliente_nome:'Maria',lado:'autora'},B]);assert.equal(await count(db,'processos'),2);
 await as(db,A);const f=await folder(db,pa);await rpc(db,'v4_salvar_pasta',[f,'Restrita',cnj(9),{cliente_nome:'Maria',lado:'autora'},true]);await as(db,B);assert.equal(await count(db,'processos'),1);
 }finally{await db.close();}
});
test('assunto título somente, sem data/responsável; assumir e anexar CNJ preservam IDs/histórico/membros',async()=>{
 const db=await databaseV4();try{
 await collaborate(db);const f=await subject(db,'Carlos — Analisar contrato');await rpc(db,'v4_compartilhar',[f,B]);const t=id();await rpc(db,'v4_salvar_compromisso',[t,f,task('Analisar contrato',{responsavel:null})]);
 await as(db,B);let row=(await db.query('select * from compromissos')).rows[0];assert.equal(row.responsavel,null);assert.equal(row.data_fatal_confirmada,null);await rpc(db,'v4_assumir',[t]);assert.equal((await db.query('select responsavel from compromissos')).rows[0].responsavel,B);
 await as(db,A);await rpc(db,'v4_salvar_pasta',[f,'Carlos — Ação protocolada',cnj(45),{},false]);await as(db,B);row=(await db.query('select * from compromissos')).rows[0];assert.equal(row.id,t);assert.equal(row.pasta_id,f);assert.equal(await count(db,'compromisso_atividades'),1);assert.equal(await count(db,'v4_membros'),1);assert.equal(await count(db,'processos'),1);
 await rpc(db,'v4_atividade',[id(),t,'Passo posterior ao CNJ','em_andamento']);
 }finally{await db.close();}
});
test('delegação aguarda aceite; responsável/criador independentes; conflito de edição bloqueia perda de atualização',async()=>{
 const db=await databaseV4();try{
 await collaborate(db);const f=await subject(db);await rpc(db,'v4_compartilhar',[f,B]);const t=id();await rpc(db,'v4_salvar_compromisso',[t,f,task()]);await assert.rejects(()=>rpc(db,'v4_salvar_compromisso',[id(),f,task('Inválido',{responsavel:B})]));
 const d=id();await rpc(db,'v4_delegar',[d,t,B]);assert.equal((await db.query('select responsavel from compromissos')).rows[0].responsavel,A);await as(db,B);await rpc(db,'v4_responder_delegacao',[d,true]);assert.equal((await db.query('select responsavel from compromissos')).rows[0].responsavel,B);
 await assert.rejects(()=>rpc(db,'v4_salvar_compromisso',[t,f,task('Edição obsoleta',{responsavel:B}),1]));assert.equal((await db.query('select descricao from compromissos')).rows[0].descricao,'Protocolar ação');
 }finally{await db.close();}
});
test('Nada a fazer um clique / Já fiz não criam tarefa; decisão colaborativa não reescreve fonte B',async()=>{
 const db=await databaseV4();try{
 const {a,b}=await pair(db);const req=id();await rpc(db,'v4_analisar',[a.id,'nada_a_fazer',req]);await rpc(db,'v4_analisar',[a.id,'nada_a_fazer',req]);assert.equal(await count(db,'compromissos'),0);assert.equal(await count(db,'v4_decisoes'),1);
 await as(db,B);const context=await rpc(db,'v4_contexto');assert.equal(context.publicacoes.find(p=>p.id===b.id).decisao_id,req);assert.equal((await db.query('select triagem_status from publicacoes where id=$1',[b.id])).rows[0].triagem_status,'pendente_de_analise');
 const p=await rpc(db,'ingest_publicacao',[strong('outro-ato')]);await rpc(db,'v4_analisar',[p.id,'ja_fiz',id(),'Documento já enviado']);assert.equal(await count(db,'compromissos'),0);
 }finally{await db.close();}
});
test('Vou fazer atômico; dois usuários/retries mesmo ato geram uma obrigação; distinto/incerto segue pendente',async()=>{
 const db=await databaseV4();try{
 const {a,b}=await pair(db);await assert.rejects(()=>rpc(db,'v4_analisar',[a.id,'vou_fazer',id(),'',{id:id(),descricao:''}]));assert.equal(await count(db,'compromissos'),0);assert.equal((await db.query('select triagem_status from publicacoes where id=$1',[a.id])).rows[0].triagem_status,'pendente_de_analise');
 const first=await rpc(db,'v4_analisar',[a.id,'vou_fazer',id(),'Peticionar',{id:id(),descricao:'Peticionar'}]);await as(db,B);const second=await rpc(db,'v4_analisar',[b.id,'vou_fazer',id(),'Peticionar',{id:id(),descricao:'Peticionar'}]);assert.equal(first.compromisso_id,second.compromisso_id);assert.equal(await count(db,'compromissos'),1);
 const distinct=await rpc(db,'ingest_publicacao',[strong('ato-diferente')]);const uncertain=await rpc(db,'ingest_publicacao',[strong('ato-incerto',1,{orgao:null})]);const ctx=await rpc(db,'v4_contexto');for(const p of [distinct,uncertain])assert.equal(ctx.publicacoes.find(x=>x.id===p.id).decisao_id,null);
 }finally{await db.close();}
});
test('não é minha responsabilidade é individual; reabrir conserva fonte e histórico; revisão independente',async()=>{
 const db=await databaseV4();try{
 const {a,b}=await pair(db);await rpc(db,'v4_analisar',[a.id,'nao_me_compete',id()]);await as(db,B);let ctx=await rpc(db,'v4_contexto');assert.equal(ctx.publicacoes.find(p=>p.id===b.id).nao_me_compete,false);
 await rpc(db,'v4_analisar',[b.id,'nada_a_fazer',id()]);await as(db,A);await rpc(db,'v4_reabrir',[a.id,true]);ctx=await rpc(db,'v4_contexto');assert.equal(ctx.publicacoes.find(p=>p.id===a.id).decisao_id,null);assert.equal(await count(db,'publicacoes'),2);assert.equal(await count(db,'v4_decisoes'),2);
 }finally{await db.close();}
});
test('classificações antigas contraditórias identificadas, intactas, sem nova obrigação automática',async()=>{
 const db=await databaseV4();try{
 const {a,b}=await pair(db);await db.query("update publicacoes set triagem_status='classificada',exige_providencia=false,classificacao='Ciência, sem providência',providencia='A',analisado_por=$2,analisado_em=now() where id=$1",[a.id,A]);await as(db,B);await db.query("update publicacoes set triagem_status='classificada',exige_providencia=false,classificacao='Outro',providencia='B',analisado_por=$2,analisado_em=now() where id=$1",[b.id,B]);
 const ctx=await rpc(db,'v4_contexto');assert.ok(ctx.publicacoes.every(p=>p.conflito));await assert.rejects(()=>rpc(db,'v4_analisar',[b.id,'nada_a_fazer',id()]));assert.equal(await count(db,'compromissos'),0);
 const before=(await db.query('select * from publicacoes order by id')).rows;
 await assert.rejects(()=>rpc(db,'v4_unificar_ato',[b.id,a.id,null,false]));const chosen=await rpc(db,'v4_unificar_ato',[b.id,a.id,null,true]);assert.deepEqual((await db.query('select * from publicacoes order by id')).rows,before);assert.ok((await rpc(db,'v4_contexto')).publicacoes.every(p=>p.decisao_id===chosen));
 }finally{await db.close();}
});
test('gravação direta não forja criador/responsável/ator e não vincula pasta de terceiro',async()=>{
 const db=await databaseV4();try{
 const f=await subject(db);const t=id();await assert.rejects(()=>db.query("insert into compromissos(id,pasta_id,descricao,responsavel) values($1,$2,'Forjado',$3)",[t,f,B]));
 await db.query("insert into compromissos(id,pasta_id,descricao,criado_por) values($1,$2,'Teste',$3)",[t,f,B]);assert.equal((await db.query('select criado_por from compromissos')).rows[0].criado_por,A);
 await db.query("insert into compromisso_atividades(compromisso_id,texto,ator) values($1,'Teste',$2)",[t,B]);assert.equal((await db.query('select ator from compromisso_atividades')).rows[0].ator,A);
 await as(db,B);await assert.rejects(()=>db.query("insert into compromissos(pasta_id,descricao) values($1,'Ataque')",[f]));
 }finally{await db.close();}
});
test('origem OAB única compartilhada, audiências compartilhadas e exclusão de OAB privada',async()=>{
 const db=await databaseV4();try{
 await collaborate(db);const o=(await db.query("insert into oabs_monitoradas(numero_oab,uf) values('12345','SP') returning id")).rows[0].id;
 const p=await rpc(db,'ingest_publicacao',[strong('only-a'),o]);const f=await folder(db,p.processo_id);await rpc(db,'v4_compartilhar',[f,B]);await as(db,B);
 assert.equal(await count(db,'oabs_monitoradas'),0);const ctx=await rpc(db,'v4_contexto');assert.equal(ctx.destinatarios[0].titular,A);assert.equal(ctx.destinatarios[0].numero,'12345');
 const aud=id();await rpc(db,'v4_salvar_audiencia',[aud,f,{publicacao_id:p.id,data:'2026-11-01',hora:'14:30',status:'agendada',payload:{tipo:'Conciliação'}}]);await as(db,A);assert.equal((await db.query('select id from audiencias')).rows[0].id,aud);assert.equal((await db.query("select ator from historico_alteracoes where registro_id=$1",[aud])).rows[0].ator,B);
 await as(db,C);await assert.rejects(()=>rpc(db,'v4_salvar_audiencia',[aud,f,{data:'2027-01-01',hora:'09:00',status:'cancelada'}]));assert.equal(await count(db,'audiencias'),0);
 }finally{await db.close();}
});
test('reabertura compartilhada preserva decisão anterior e permite nova resolução comum sem recriar fontes',async()=>{
 const db=await databaseV4();try{
 const {a,b}=await pair(db);await rpc(db,'v4_analisar',[a.id,'nada_a_fazer',id()]);await as(db,B);await rpc(db,'v4_reabrir',[b.id,false]);
 let ctx=await rpc(db,'v4_contexto');assert.equal(ctx.publicacoes.find(p=>p.id===a.id).reaberto,true);
 await as(db,A);const r=await rpc(db,'v4_analisar',[a.id,'ja_fiz',id(),'Executado após revisão']);await as(db,B);ctx=await rpc(db,'v4_contexto');assert.equal(ctx.publicacoes.find(p=>p.id===b.id).decisao_id,r.decisao_id);assert.equal(await count(db,'publicacoes'),2);assert.equal(await count(db,'v4_decisoes'),3);
 }finally{await db.close();}
});
test('RPC legada V3 também passa pela trava comum e preserva classificação flexível',async()=>{
 const db=await databaseV4();try{
 const {a,b}=await pair(db);const r=await rpc(db,'classificar_publicacao_v3',[a.id,'Outro',true,'Conferência','observação',[{id:id(),processo_id:a.processo_id,descricao:'Conferir ato'}],false,null]);
 await as(db,B);const rr=await rpc(db,'classificar_publicacao_v3',[b.id,'Outro',true,'Conferência','',[{id:id(),processo_id:b.processo_id,descricao:'Conferir ato'}],false,null]);assert.equal(r.compromisso_id,rr.compromisso_id);assert.equal(await count(db,'compromissos'),1);
 }finally{await db.close();}
});
test('backup V4 restaura assunto/tarefa/decisão/histórico próprios, sem reativar compartilhamento',async()=>{
 const source=await databaseV4(),target=await databaseV4();try{
 await collaborate(source);const f=await subject(source);await rpc(source,'v4_compartilhar',[f,B]);const t=id();await rpc(source,'v4_salvar_compromisso',[t,f,task()]);await as(source,B);await rpc(source,'v4_atividade',[id(),t,'Feito em colaboração','concluido']);await as(source,A);
 const p=await rpc(source,'ingest_publicacao',[strong('backup')]);await rpc(source,'v4_analisar',[p.id,'ja_fiz',id(),'Enviado']);
 const data={};for(const table of ['profiles','processos','publicacoes','compromissos','compromisso_atividades','historico_alteracoes','v4_pastas','v4_decisoes','v4_revisoes','v4_colaboracoes','v4_membros'])data[table]=(await source.query('select * from '+table)).rows;
 const backup=JSON.parse(JSON.stringify(personalBackup(data,A)));await rpc(target,'restaurar_backup',[backup]);assert.equal(await count(target,'compromissos'),1);const restored=(await target.query('select * from compromissos')).rows[0];assert.equal(restored.id,t);assert.equal(restored.pasta_id,f);assert.equal(restored.concluido_por,B);assert.equal((await target.query('select ator from compromisso_atividades')).rows[0].ator,B);assert.equal(await count(target,'v4_decisoes'),1);
 await rpc(target,'restaurar_backup',[backup]);assert.equal(await count(target,'compromissos'),1);await as(target,B);assert.equal(await count(target,'compromissos'),0);await assert.rejects(()=>rpc(target,'restaurar_backup',[backup]));
 }finally{await source.close();await target.close();}
});
test('backup V3 sem colunas novas continua restaurável; backup misto rejeitado com rollback',async()=>{
 const db=await databaseV4();try{
 const pid=id(),tid=id();const backup={format:'lex-online',user_id:A,data:{processos:[{id:pid,user_id:A,numero_cnj:cnj(98),payload:{},created_at:'2026-10-15T12:00:00Z',updated_at:'2026-10-15T12:00:00Z'}],compromissos:[{id:tid,user_id:A,processo_id:pid,descricao:'Legado',tipo:'Administrativo',status:'pendente',payload:{},prioridade:'normal',created_at:'2026-10-15T12:00:00Z',updated_at:'2026-10-15T12:00:00Z'}]}};
 await rpc(db,'restaurar_backup',[backup]);assert.equal(await count(db,'compromissos'),1);
 const bad=structuredClone(backup);bad.data.compromissos[0].user_id=B;await assert.rejects(()=>rpc(db,'restaurar_backup',[bad]));assert.equal(await count(db,'compromissos'),1);
 }finally{await db.close();}
});
test('duas solicitações simultâneas A/B usam uma resolução/obrigação (executor local serializado)',async()=>{
 const db=await databaseV4();try{
 const {a,b}=await pair(db);const requests=[[A,a.id],[B,b.id]].map(([uid,pid])=>db.transaction(async tx=>{await tx.exec(`set local role authenticated;set local request.jwt.claim.sub='${uid}';`);return rpc(tx,'v4_analisar',[pid,'vou_fazer',id(),'Conferir',{id:id(),descricao:'Conferir'}]);}));
 const result=await Promise.all(requests);assert.equal(result[0].compromisso_id,result[1].compromisso_id);assert.equal(await count(db,'compromissos'),1);
 }finally{await db.close();}
});
