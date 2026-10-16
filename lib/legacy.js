// Somente ferramenta de migração; o aplicativo não lê estas chaves para trabalhar.
export const legacyKeys=['lex7_aud','lex7_proc','lex7_praz','lex7_pub','lex6_fila','lex7_adv','lex7_adv_per_user'];
export function stripSecrets(value){
 if(Array.isArray(value))return value.map(stripSecrets);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>!/(pass|senha|token|secret|session)/i.test(k)).map(([k,v])=>[k,stripSecrets(v)]));
 return value;
}
export function exportLegacy(storage){
 const data={},errors=[];
 for(const key of legacyKeys){const text=storage.getItem(key);if(text){try{data[key]=stripSecrets(JSON.parse(text));}catch{errors.push({key,erro:'JSON inválido',conteudo:text});}}}
 // Apenas identificadores e nomes de responsáveis; nunca credenciais locais.
 try{data.responsaveis=JSON.parse(storage.getItem('lex7_users')||'[]').map(u=>({id:u.id,nome:u.nome,email:u.email}));}catch{}
 return {format:'lex-legacy',version:1,exported_at:new Date().toISOString(),data,errors};
}
const map={lex7_proc:'processos',lex7_pub:'publicacoes',lex7_praz:'compromissos',lex7_aud:'audiencias',lex6_fila:'fila'};
export function legacyRows(backup){
 const data=backup.data||backup;const rows=[];
 for(const [key,kind] of Object.entries(map)){
  if(data[key]&&!Array.isArray(data[key]))throw new Error('Backup inválido em '+key);
  for(const raw of data[key]||[])rows.push({kind,raw:stripSecrets(raw),owner:String(raw.owner??raw.user_id??'SEM_TITULAR')});
 }
 return rows;
}
export const ownersOf=backup=>[...new Set(legacyRows(backup).map(r=>r.owner))];
export function selectLegacy(backup,owner,confirmed){
 if(!confirmed||!owner)throw new Error('Selecione explicitamente o titular legado e confirme a conta de destino.');
 return legacyRows(backup).filter(r=>r.owner===owner);
}
export function legacyKey(row){return row.owner+':'+String(row.raw.id??JSON.stringify(row.raw));}
export function prepareLegacy(row){
 const r=row.raw;
 return {...row,key:legacyKey(row),data:row.kind==='publicacoes'?{
  fonte:r.fonte||'DJEN',id_externo:r.idCNJ==null?(r.id_externo??null):String(r.idCNJ),numero:r.proc||r.numero_processo||r.numero||(r.titulo||'').match(/\d{7}-?\d{2}\.?\d{4}\.?\d\.?\d{2}\.?\d{4}/)?.[0]||'',
  texto_integral:r.corpo||r.texto_integral||r.texto||'',data_disponibilizacao:r.data||r.data_disponibilizacao||null,
  tribunal:r.trib||r.tribunal||'',orgao:r.orgao||'',tipo:r.tipo||r.titulo||'',link_origem:r.link||r.link_origem||'',raw:r,
  triagem_status:r.triagem_status,classificacao:r.classificacao,providencia:r.providencia,observacoes:r.observacoes
 }:r};
}
