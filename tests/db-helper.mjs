import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
export const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
export function cnj(seq=1){const base=String(seq).padStart(7,'0'),rest='20268260562';return base+String(98-Number(BigInt(base+rest+'00')%97n)).padStart(2,'0')+rest;}
export async function database(){
 const db=new PGlite();
 await db.exec(`create role anon nologin;create role authenticated nologin;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth,public to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;`);
 await db.exec(`insert into auth.users values ('${A}'),('${B}');`);
 for(const name of ['001_lex.sql','002_migracao.sql','003_vinculos.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
 await db.exec(`set role authenticated;set request.jwt.claim.sub='${A}';`);
 return db;
}
export async function as(db,id){await db.exec(`reset role;set role authenticated;set request.jwt.claim.sub='${id}';`);}
export async function rpc(db,fn,args=[]){const result=await db.query(`select public.${fn}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as value`,args);return result.rows[0].value;}
export const pub=(id,seq=1,extra={})=>({fonte:'DJEN',id_externo:id,numero:cnj(seq),texto_integral:'Intimação '+id,data_disponibilizacao:'2026-10-15',tribunal:'TJSP',...extra});
export async function count(db,table){return Number((await db.query('select count(*) n from public.'+table)).rows[0].n);}
