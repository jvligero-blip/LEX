export const digits = value => String(value ?? '').replace(/\D/g, '');
export function validCNJ(value) {
 const n=digits(value);
 return n.length===20 && !/^0+$/.test(n) && Number(n.slice(7,9))===98-Number(BigInt(n.slice(0,7)+n.slice(9)+'00')%97n);
}
export function maskCNJ(value) {
 const n=digits(value);
 return n.length===20?`${n.slice(0,7)}-${n.slice(7,9)}.${n.slice(9,13)}.${n[13]}.${n.slice(14,16)}.${n.slice(16)}`:String(value??'');
}
export const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo'}).format(new Date());
export function addDays(date,n){const d=new Date(`${date}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
export const validDate=s=>/^\d{4}-\d{2}-\d{2}$/.test(s||'')&&!isNaN(Date.parse(s+'T12:00:00Z'))&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;
export const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function safeURL(value){try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)?u.href:'';}catch{return '';}}
export function suggestion(text){const found=String(text).match(/senten[çc]a|ac[oó]rd[aã]o|intima[çc][aã]o|embargos|(?:\d+|cinco|dez|quinze)\s+dias/gi);return found?[...new Set(found)].join(' · ')+' — revisar, sem prazo calculado':'';}
export function normalizeDJEN(item){
 if(!item||typeof item!=='object'||typeof item.texto!=='string')throw new Error('Resposta DJEN inválida: item sem texto; lote não confirmado.');
 const date=s=>{if(!s)return null;const d=String(s).slice(0,10);if(!validDate(d))throw new Error('Data inválida na resposta DJEN');return d;};
 return {fonte:'DJEN',id_externo:item.id==null?null:String(item.id),numero:item.numero_processo||item.numeroprocessocommascara||'',texto_integral:item.texto,tribunal:item.siglaTribunal||'',orgao:item.nomeOrgao||'',tipo:item.tipoComunicacao||item.tipoDocumento||'',data_disponibilizacao:date(item.data_disponibilizacao),data_publicacao:date(item.data_publicacao),link_origem:item.link||'',raw:item};
}
export function parsePage(body,page,size=100){
 if(!body||!Array.isArray(body.items))throw new Error('Formato inesperado da API DJEN; carga interrompida.');
 const total=body.count==null?null:Number(body.count);
 if(total!==null&&(!Number.isFinite(total)||total<0))throw new Error('Contagem inválida do DJEN');
 // Uma página cheia pede outra mesmo quando count é um teto da fonte (p.ex. 10.000).
 const more=body.items.length===size || (total!==null&&page*size<total);
 if(total!==null&&body.items.length<Math.min(size,Math.max(total-(page-1)*size,0)))throw new Error('DJEN retornou menos itens que o esperado na página; carga parcial para evitar omissões.');
 if((more&&body.items.length===0)||body.items.length>size)throw new Error('Paginação inconsistente no DJEN');
 return {items:body.items.map(normalizeDJEN),more,total};
}
export function incrementalStart(jobs,oabId){const last=jobs.filter(j=>j.oab_id===oabId&&j.estado==='concluida').sort((a,b)=>b.fim.localeCompare(a.fim))[0];return last?(addDays(last.fim,-7)<'2026-10-01'?'2026-10-01':addDays(last.fim,-7)):'2026-10-01';}
