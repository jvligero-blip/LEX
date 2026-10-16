import {createClient} from '@supabase/supabase-js';
import assert from 'node:assert/strict';
const required=['SUPABASE_URL','SUPABASE_ANON_KEY','LEX_TEST_EMAIL_A','LEX_TEST_PASSWORD_A','LEX_TEST_EMAIL_B','LEX_TEST_PASSWORD_B'];
const missing=required.filter(n=>!process.env[n]||/SEU-PROJETO|SUA_CHAVE/.test(process.env[n]));
if(missing.length){console.log('NÃO EXECUTADO: faltam '+missing.join(', '));process.exit(2);}
if(process.env.LEX_TEST_CONFIRM!=='homologacao'){console.log('NÃO EXECUTADO: defina LEX_TEST_CONFIRM=homologacao em projeto de teste. O script grava registros de teste e os remove ao final; a auditoria permanece.');process.exit(2);}
const clients=['A','B'].map(()=>createClient(process.env.SUPABASE_URL,process.env.SUPABASE_ANON_KEY,{auth:{persistSession:false}}));
const ok=({data,error})=>{if(error)throw error;return data;};
const suffix=String(crypto.getRandomValues(new Uint32Array(1))[0]%9999999).padStart(7,'0'),rest='20268260562',cnj=suffix+String(98-Number(BigInt(suffix+rest+'00')%97n)).padStart(2,'0')+rest;
let aid,bid,pub,task;
try{
 const [a,b]=clients;const sa=ok(await a.auth.signInWithPassword({email:process.env.LEX_TEST_EMAIL_A,password:process.env.LEX_TEST_PASSWORD_A}));const sb=ok(await b.auth.signInWithPassword({email:process.env.LEX_TEST_EMAIL_B,password:process.env.LEX_TEST_PASSWORD_B}));assert.notEqual(sa.user.id,sb.user.id);
 aid=ok(await a.rpc('ensure_processo',{p_numero:cnj}));bid=ok(await b.rpc('ensure_processo',{p_numero:cnj}));assert.notEqual(aid,bid);
 assert.equal(ok(await b.from('processos').select().eq('id',aid)).length,0);
 assert.equal(ok(await b.from('processos').update({payload:{teste:'invasao'}}).eq('id',aid).select()).length,0);
 assert.ok((await b.from('compromissos').insert({processo_id:aid,descricao:'Tentativa cruzada'})).error);
 const item={fonte:'TESTE',id_externo:crypto.randomUUID(),numero:cnj,texto_integral:'Teste de homologação LEX',data_disponibilizacao:'2026-10-15'};
 pub=ok(await a.rpc('ingest_publicacao',{p_item:item})).id;assert.equal(ok(await a.rpc('ingest_publicacao',{p_item:item})).inserida,false);
 ok(await a.rpc('classificar_publicacao',{p_id:pub,p_categoria:'Ciência, sem providência',p_providencia:'',p_obs:'teste',p_reabrir:false}));
 assert.equal(ok(await a.from('publicacoes').select().eq('id',pub).single()).triagem_status,'classificada');
 task=ok(await a.from('compromissos').insert({processo_id:aid,publicacao_id:pub,descricao:'Teste online',data_fatal_confirmada:'2026-10-20'}).select().single()).id;
 assert.equal(ok(await a.from('compromissos').select().eq('id',task).single()).data_fatal_confirmada,'2026-10-20');
 const fresh=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_ANON_KEY,{auth:{persistSession:false}});ok(await fresh.auth.signInWithPassword({email:process.env.LEX_TEST_EMAIL_A,password:process.env.LEX_TEST_PASSWORD_A}));assert.equal(ok(await fresh.from('processos').select().eq('id',aid)).length,1);await fresh.auth.signOut();
 console.log('PASSOU: Auth A/B, persistência em nova sessão, CRUD, CNJ por titular, deduplicação, triagem, data civil e RLS negativa online.');
}catch(e){console.error('FALHOU:',e.message);process.exitCode=1;}finally{
 const [a,b]=clients;for(const [table,id]of [['compromissos',task],['publicacoes',pub],['processos',aid]])if(id){const {error}=await a.from(table).delete().eq('id',id);if(error){console.error('Limpeza pendente:',table,id);process.exitCode=1;}}
 if(bid)await b.from('processos').delete().eq('id',bid);for(const client of clients)await client.auth.signOut();
}
