import {test} from 'node:test';
import assert from 'node:assert/strict';
import {notificationCard,delegateExplanation} from '../src/notifications.js';
test('notificações distinguem leitura, aceite e tarefa a fazer; conteúdo dinâmico escapado',()=>{
 const base={id:'id',tipo:'compromisso_criado',estado:'pendente',acessivel:true,titulo:'<img src=x onerror=alert(1)>',ator:'<script>fraude</script>',created_at:'2026-10-22T12:00:00Z'};
 const html=notificationCard(base);assert.match(html,/Situação: A fazer/);assert.match(html,/&lt;img/);assert.ok(!html.includes('<script>'));assert.ok(!html.includes('Aceitar compromisso'));
 const pending=notificationCard({...base,tipo:'delegacao',responder:true,lida_em:'2026-10-22T13:00:00Z'});assert.match(pending,/Aguardando aceite/);assert.match(pending,/Aceitar compromisso/);assert.match(pending,/>Lida</);
});
test('seletor explica colaboração ativa sem permissão e exige autorização mínima do titular',()=>{
 assert.equal(delegateExplanation({tem_acesso:true}).needsConsent,false);assert.equal(delegateExplanation({tem_acesso:false,pode_autorizar:true}).needsConsent,true);assert.equal(delegateExplanation({tem_acesso:false,pode_autorizar:false}).blocked,true);
});
