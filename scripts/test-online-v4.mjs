// Opt-in: projeto descartável de HOMOLOGAÇÃO, 3 contas de teste. Conserva fixtures e auditoria.
import {createClient} from '@supabase/supabase-js';
import assert from 'node:assert/strict';
const vars=['SUPABASE_URL','SUPABASE_ANON_KEY',...['A','B','C'].flatMap(x=>['LEX_TEST_EMAIL_'+x,'LEX_TEST_PASSWORD_'+x]),'LEX_TEST_PROJECT_HOST'];
const missing=vars.filter(n=>!process.env[n]||/SEU-PROJETO|SUA_CHAVE/.test(process.env[n]));
if(missing.length){console.log('NÃO EXECUTADO: faltam '+missing.join(', '));process.exit(2);}
if(process.env.LEX_TEST_CONFIRM!=='homologacao'||new URL(process.env.SUPABASE_URL).hostname!==process.env.LEX_TEST_PROJECT_HOST){console.log('NÃO EXECUTADO: confirme LEX_TEST_CONFIRM=homologacao e LEX_TEST_PROJECT_HOST do projeto de teste. Grava fixtures, não executa migrations/deploy.');process.exit(2);}
const clients=['A','B','C'].map(()=>createClient(process.env.SUPABASE_URL,process.env.SUPABASE_ANON_KEY,{auth:{persistSession:false}}));
const ok=r=>{if(r.error)throw r.error;return r.data;},rid=()=>crypto.randomUUID();
let relation,folder,task;const [a,b,c]=clients;
try{
 const sessions=await Promise.all(clients.map(async(client,i)=>{const x=['A','B','C'][i];return ok(await client.auth.signInWithPassword({email:process.env['LEX_TEST_EMAIL_'+x],password:process.env['LEX_TEST_PASSWORD_'+x]}));}));
 const [A,B,C]=sessions.map(s=>s.user.id);assert.equal(new Set([A,B,C]).size,3);
 for(const client of clients)assert.equal(ok(await client.from('v4_colaboracoes').select('id')).length,0,'Use contas novas, sem relações anteriores');
 folder=rid();ok(await a.rpc('v4_salvar_pasta',{p_id:folder,p_titulo:'HOMOLOGAÇÃO V4 '+new Date().toISOString()}));
 relation=ok(await a.rpc('v4_convidar',{p_email:process.env.LEX_TEST_EMAIL_B,p_automatico:false}));
 assert.equal(ok(await b.from('v4_pastas').select('id').eq('id',folder)).length,0);ok(await b.rpc('v4_responder_convite',{p_id:relation,p_acao:'aceitar'}));
 assert.equal(ok(await b.from('v4_pastas').select('id').eq('id',folder)).length,0);ok(await a.rpc('v4_compartilhar',{p_pasta:folder,p_membro:B}));
 task=rid();ok(await b.rpc('v4_salvar_compromisso',{p_id:task,p_pasta:folder,p_dados:{descricao:'Providência de homologação',responsavel:B}}));
 const owned=ok(await a.from('compromissos').select().eq('id',task).single());assert.equal(owned.user_id,A);assert.equal(owned.criado_por,B);assert.equal(owned.responsavel,B);
 assert.equal(ok(await c.from('compromissos').select('id').eq('id',task)).length,0);assert.ok((await c.rpc('v4_atividade',{p_id:rid(),p_compromisso:task,p_texto:'Ataque de homologação'})).error);
 ok(await a.rpc('v4_atividade',{p_id:rid(),p_compromisso:task,p_texto:'Concluído no teste online',p_estado:'concluido'}));
 const completed=ok(await b.from('compromissos').select().eq('id',task).single());assert.equal(completed.concluido_por,A);assert.equal(completed.descricao,owned.descricao);
 const activity=ok(await b.from('compromisso_atividades').select().eq('compromisso_id',task));assert.equal(activity[0].ator,A);
 ok(await a.rpc('v4_responder_convite',{p_id:relation,p_acao:'revogar'}));assert.equal(ok(await b.from('compromissos').select('id').eq('id',task)).length,0);
 assert.ok((await b.rpc('v4_atividade',{p_id:rid(),p_compromisso:task,p_texto:'Revogado'})).error);
 console.log('PASSOU: Auth real A/B/C, RLS/PostgREST, convite, aceite, escrita compartilhada, ator real, conclusão e revogação.');
 console.log('Fixtures no projeto descartável:',JSON.stringify({folder,task,relation}));
 console.log('Ainda conferir DJEN real/repetido, backup representativo, paginação PostgREST e concorrência em conexões independentes.');
}catch(e){console.error('FALHOU:',e.message);process.exitCode=1;}
finally{
 if(relation){const r=await a.rpc('v4_responder_convite',{p_id:relation,p_acao:'revogar'});if(r.error)console.error('Confira revogação da relação de teste:',relation);}
 for(const client of clients)await client.auth.signOut();
}
