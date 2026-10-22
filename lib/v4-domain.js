export const decisions={nada_a_fazer:'Nada a fazer',ja_fiz:'Já fiz',vou_fazer:'Vou fazer',encaminhar:'Encaminhada para aceite',reabrir:'Reaberta'};
export const responsible=t=>t.responsabilidade_definida?t.responsavel:t.user_id;
export function operationalPending(p,context={}){
 if(context.nao_me_compete)return false;
 if(context.decisao_id)return false;
 if(context.individual||context.reaberto)return true;
 return p.triagem_status==='pendente_de_analise'&&!context.legado_id;
}
export function filterScope(t,scope,uid){
 const r=responsible(t);
 return !scope||({meus:r===uid,acompanho:!!r&&r!==uid,sem_responsavel:!r,aguardando_terceiro:t.status==='aguardando_terceiro',sem_data:!t.data_fatal_confirmada&&!t.data_interna})[scope];
}
// Exportação pessoal: SELECT compartilhado nunca vira um backup do acervo do colega.
export function personalBackup(data,uid,date=new Date().toISOString()){
 const own={};for(const [t,list] of Object.entries(data))if(Array.isArray(list)&&!t.startsWith('v4_'))own[t]=list.filter(r=>r.user_id===uid);
 own.v4_pastas=(data.v4_pastas||[]).filter(r=>r.user_id===uid);
 const pubs=new Set((own.publicacoes||[]).map(r=>r.id));
 own.v4_decisoes=(data.v4_decisoes||[]).filter(r=>r.user_id===uid&&pubs.has(r.publicacao_id));
 own.v4_revisoes=(data.v4_revisoes||[]).filter(r=>r.user_id===uid&&pubs.has(r.publicacao_id));
 own.v4_exclusoes=(data.v4_exclusoes||[]).filter(r=>r.user_id===uid);
 return {format:'lex-online',version:4.1,user_id:uid,exported_at:date,data:own,
  colaboracao_referencia:{relacoes:data.v4_colaboracoes||[],membros:(data.v4_membros||[]).filter(r=>r.user_id===uid),delegacoes:(data.v4_delegacoes||[]).filter(r=>r.user_id===uid)},
  aviso:'Permissões de colaboração são referência histórica. Restaurar não reativa acesso: requer novo aceite/autorização.'};
}
