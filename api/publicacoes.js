import {authenticate,fail} from '../lib/server.js';
import {parsePage} from '../lib/domain.js';
const DJEN='https://comunicaapi.pje.jus.br/api/v1/comunicacao';
export async function fetchDJEN(oab,day,page,fetcher=fetch){
 if(!/^[0-9]{1,12}$/.test(oab.numero_oab)||/^0+$/.test(oab.numero_oab))throw new Error('OAB inválida ou zerada.');
 const qs=new URLSearchParams({numeroOab:oab.numero_oab,ufOab:oab.uf,dataDisponibilizacaoInicio:day,dataDisponibilizacaoFim:day,pagina:String(page),itensPorPagina:'100'});
 // Uma página por chamada Vercel. Gravação e checkpoint formam uma transação.
 for(let attempt=0;attempt<3;attempt++){
  let r;try{r=await fetcher(DJEN+'?'+qs,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(10000)});}catch{if(attempt===2)throw new Error('DJEN indisponível ou timeout; retome a carga.');continue;}
  if((r.status===429||r.status>=500)&&attempt<2){await new Promise(resolve=>setTimeout(resolve,500*(attempt+1)));continue;}
  if(!r.ok)throw new Error(`DJEN respondeu HTTP ${r.status}. O checkpoint foi preservado.`);
  return parsePage(await r.json(),page);
 }
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).json({erro:'Use POST com sincronizacao_id e sessão autenticada.'});
 let db,job;
 try{
  ({db}=await authenticate(req));const id=req.body?.sincronizacao_id;
  if(!/^[0-9a-f-]{36}$/i.test(id||''))return res.status(400).json({erro:'Sincronização inválida.'});
  const rows=await db('sincronizacoes?id=eq.'+id);job=rows[0];
  if(!job)return res.status(404).json({erro:'Sincronização não acessível.'});
  if(job.estado==='concluida')return res.status(200).json(job);
  if(!await db('rpc/reservar_consulta',{})){await db('rpc/registrar_falha_sync',{p_job:job.id,p_erro:'Limite de consultas; aguarde um minuto e retome.'});return res.status(429).json({erro:'Limite de 30 páginas por minuto. Aguarde um minuto e retome.'});}
  const [oab]=await db('oabs_monitoradas?id=eq.'+job.oab_id);
  if(!oab?.ativa)throw new Error('OAB não acessível ou inativa.');
  const page=await fetchDJEN(oab,job.checkpoint_data,job.checkpoint_pagina);
  return res.status(200).json(await db('rpc/aplicar_lote_sync',{p_job:id,p_dia:job.checkpoint_data,p_pagina:job.checkpoint_pagina,p_items:page.items,p_tem_mais:page.more}));
 }catch(e){if(db&&job){try{await db('rpc/registrar_falha_sync',{p_job:job.id,p_erro:e.message});}catch{}}return fail(res,e);}
}
