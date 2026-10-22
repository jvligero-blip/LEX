import {readFile} from 'node:fs/promises';
import {as,A} from './db-helper.mjs';
import {databaseNotifications} from './notifications-helper.mjs';
export const migration008=()=>readFile(new URL('../supabase/migrations/008_v42_permissoes_conferencia.sql',import.meta.url),'utf8');
export async function upgradeV42(db){await db.exec('reset role');await db.exec(await migration008());await as(db,A);return db;}
export async function databaseV42(){return upgradeV42(await databaseNotifications());}
