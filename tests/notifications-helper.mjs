import {readFile} from 'node:fs/promises';
import {as,A} from './db-helper.mjs';
import {databaseV4} from './v4-helper.mjs';
export const migration007=()=>readFile(new URL('../supabase/migrations/007_delegacao_notificacoes.sql',import.meta.url),'utf8');
export async function upgradeNotifications(db){await db.exec('reset role');await db.exec(await migration007());await as(db,A);return db;}
export async function databaseNotifications(){return upgradeNotifications(await databaseV4());}
