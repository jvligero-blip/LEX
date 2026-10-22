import assert from 'node:assert/strict';
import {database,as,A,B} from './db-helper.mjs';
import {readFile} from 'node:fs/promises';
export const C='33333333-3333-4333-8333-333333333333';
export const sqlV4=()=>readFile(new URL('../supabase/migrations/005_v4_colaboracao.sql',import.meta.url),'utf8');
export const sqlV4Extra=()=>readFile(new URL('../supabase/migrations/006_v4_integridade_backup.sql',import.meta.url),'utf8');
export async function upgrade(db){
 await db.exec('reset role;alter table auth.users add column if not exists email text;');
 await db.query('update auth.users set email=case id when $1 then $2 else $3 end',[A,'a@lex.test','b@lex.test']);
 await db.query('insert into auth.users(id,email) values($1,$2) on conflict do nothing',[C,'c@lex.test']);
 const authBefore=(await db.query('select * from auth.users order by id')).rows;
 await db.exec(await sqlV4());await db.exec(await sqlV4Extra());
 assert.deepEqual((await db.query('select * from auth.users order by id')).rows,authBefore,'As migrations V4 não alteram Auth');await as(db,A);return db;
}
export async function databaseV4(){return upgrade(await database());}
