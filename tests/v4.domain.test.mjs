import {test} from 'node:test';
import assert from 'node:assert/strict';
import {personalBackup,operationalPending,filterScope} from '../lib/v4-domain.js';
test('backup pessoal inclui extensões próprias e nunca copia linhas do colega',()=>{
 const d={profiles:[{user_id:'A'}],compromissos:[{user_id:'A',id:'1'},{user_id:'B',id:'2'}],publicacoes:[{user_id:'A',id:'p1'},{user_id:'B',id:'p2'}],v4_pastas:[{user_id:'A',id:'f1'},{user_id:'B',id:'f2'}],v4_decisoes:[{user_id:'A',publicacao_id:'p1'},{user_id:'A',publicacao_id:'p2'},{user_id:'B',publicacao_id:'p1'}],v4_membros:[{user_id:'A'}],v4_colaboracoes:[{user_id:'A'}]};
 const b=personalBackup(d,'A');assert.equal(b.data.compromissos.length,1);assert.equal(b.data.v4_pastas.length,1);assert.equal(b.data.v4_decisoes.length,1);assert.equal(b.data.v4_membros,undefined);assert.equal(b.colaboracao_referencia.membros.length,1);
});
test('resolução operacional mantém classificação V3 e revisão individual explícita',()=>{
 const p={triagem_status:'classificada'};assert.equal(operationalPending(p),false);assert.equal(operationalPending(p,{individual:true}),true);assert.equal(operationalPending({triagem_status:'pendente_de_analise'},{decisao_id:'d'}),false);assert.equal(operationalPending(p,{nao_me_compete:true}),false);
});
test('filtros responsabilidade, sem data e acompanhamento não duplicam tarefas',()=>{
 const tasks=[{id:1,user_id:'A',status:'pendente'},{id:2,user_id:'B',responsabilidade_definida:true,responsavel:null},{id:3,user_id:'B',status:'aguardando_terceiro',data_fatal_confirmada:'2026-11-01'}];
 assert.deepEqual(tasks.filter(t=>filterScope(t,'meus','A')).map(t=>t.id),[1]);assert.deepEqual(tasks.filter(t=>filterScope(t,'acompanho','A')).map(t=>t.id),[3]);assert.deepEqual(tasks.filter(t=>filterScope(t,'sem_responsavel','A')).map(t=>t.id),[2]);assert.deepEqual(tasks.filter(t=>filterScope(t,'sem_data','A')).map(t=>t.id),[1,2]);
});
