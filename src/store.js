import {createClient} from '@supabase/supabase-js';
export const tables=['profiles','processos','publicacoes','compromissos','audiencias','oabs_monitoradas','publicacao_oabs','sincronizacoes','historico_alteracoes','migracao_revisao','migracao_refs','compromisso_atividades','v4_colaboracoes','v4_pastas','v4_membros','v4_exclusoes','v4_decisoes','v4_revisoes','v4_delegacoes'];
export function connect(config){return createClient(config.supabaseUrl,config.supabaseKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});}
export function checked(result){if(result.error)throw result.error;return result.data;}
export async function all(db,table){
 let rows=[],from=0;
 for(;;){const key=['profiles'].includes(table)?'user_id':['publicacao_oabs'].includes(table)?'publicacao_id':['migracao_refs'].includes(table)?'chave':'id';
  let query=db.from(table).select('*').order(key);if(table==='publicacao_oabs')query=query.order('oab_id');if(table==='migracao_refs')query=query.order('entidade');
  const part=checked(await query.range(from,from+499));rows.push(...part);if(part.length<500)return rows;from+=500;
 }
}
export async function rpc(db,name,args){return checked(await db.rpc(name,args));}
export async function save(db,table,data){return checked(await db.from(table).upsert(data).select().single());}
