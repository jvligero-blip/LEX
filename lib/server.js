export function config(){
 const url=process.env.SUPABASE_URL||'',key=process.env.SUPABASE_ANON_KEY||'';
 if(!/^https:\/\/[^/]+/.test(url)||!key||url.includes('SEU-PROJETO')||key.includes('SUA_CHAVE'))throw Object.assign(new Error('Configuração do banco pendente: SUPABASE_URL e SUPABASE_ANON_KEY.'),{status:503});
 if(key.startsWith('sb_secret_'))throw Object.assign(new Error('Use a chave pública do Supabase.'),{status:503});
 if(key.split('.').length===3){try{if(JSON.parse(Buffer.from(key.split('.')[1],'base64url')).role==='service_role')throw new Error('private');}catch{throw Object.assign(new Error('Chave pública inválida.'),{status:503});}}
 return {url:url.replace(/\/$/,''),key};
}
export async function authenticate(req){
 const {url,key}=config();const token=req.headers.authorization;
 if(!/^Bearer .+/.test(token||''))throw Object.assign(new Error('Login necessário.'),{status:401});
 let r;try{r=await fetch(url+'/auth/v1/user',{headers:{apikey:key,Authorization:token},signal:AbortSignal.timeout(8000)});}catch{throw Object.assign(new Error('Não foi possível validar a sessão.'),{status:503});}
 if(!r.ok)throw Object.assign(new Error('Sessão expirada. Entre novamente.'),{status:401});
 const user=await r.json();if(!user.id)throw Object.assign(new Error('Sessão inválida'),{status:401});
 async function db(path,body){
  const out=await fetch(url+'/rest/v1/'+path,{method:body===undefined?'GET':'POST',headers:{apikey:key,Authorization:token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  if(!out.ok)throw Object.assign(new Error('Falha de banco: confira as migrações e a sessão.'),{status:out.status===401?401:502});
  return out.status===204?null:out.json();
 }
 return {user,db};
}
export const fail=(res,e)=>res.status(e.status||502).json({erro:e.message||'Falha na operação.'});
