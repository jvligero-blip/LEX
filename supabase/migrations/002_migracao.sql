begin;
create or replace function public.importar_legado(p_entidade text,p_chave text,p_dados jsonb,p_original jsonb) returns jsonb language plpgsql security invoker set search_path=public as $$
declare r uuid; p uuid; pub uuid; ins jsonb; n text; d jsonb:=p_dados; titular text:=split_part(p_chave,':',1); begin
 if auth.uid() is null then raise exception 'Login necessário'; end if;
 -- Chaves legadas sem ID podem conter o JSON completo; indexar só seu hash estável.
 p_chave:=encode(sha256(convert_to(p_chave,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtext(auth.uid()::text));
 select registro_id into r from migracao_refs where user_id=auth.uid() and entidade=p_entidade and chave=p_chave;
 if r is not null then return jsonb_build_object('estado','existente','id',r); end if;
 if p_entidade='fila' then
   select id into r from publicacoes where user_id=auth.uid() and
     (id_externo=nullif(d->>'idCNJ','') or id_externo=nullif(d->>'pubId','') or raw->>'id'=d->>'pubId') limit 1;
   if r is null then raise exception 'Sugestão sem publicação identificável; revisão manual, sem gerar tarefa automática'; end if;
   -- A fila antiga é somente uma sugestão, não uma classificação ou prazo confirmado.
 elsif p_entidade='publicacoes' then
   ins:=ingest_publicacao(d);r:=(ins->>'id')::uuid;
   if (ins->>'inserida')::boolean and d->>'triagem_status'='classificada' then
    perform classificar_publicacao(r,coalesce(nullif(d->>'classificacao',''),'Classificação legada'),d->>'providencia',d->>'observacoes');
   end if;
 elsif p_entidade='processos' then
   n:=coalesce(d->>'num',d->>'numero_cnj');r:=ensure_processo(n,d);
   -- Só completa campos ausentes na pasta automática. Dados atuais prevalecem.
   update processos set payload=d||payload,updated_at=now() where id=r and user_id=auth.uid();
 elsif p_entidade in ('compromissos','audiencias') then
   n:=coalesce(d->>'proc',d->>'numero_cnj','');
   if n<>'' then p:=ensure_processo(n); end if;
   if d->>'publicacao_id' is not null or d->>'pubId' is not null then
     select registro_id into pub from migracao_refs where user_id=auth.uid() and entidade='publicacoes'
       and chave=encode(sha256(convert_to(titular||':'||coalesce(d->>'publicacao_id',d->>'pubId'),'UTF8')),'hex');
   end if;
   if p_entidade='compromissos' then
     insert into compromissos(processo_id,publicacao_id,descricao,tipo,status,data_fatal_confirmada,data_interna,data_sugerida,payload)
     values(p,pub,coalesce(d->>'desc',d->>'descricao'),coalesce(d->>'tipo','Outro'),case when d->>'status'='concluido' then 'concluido' else 'pendente' end,
       nullif(coalesce(d->>'data_fatal_confirmada',d->>'data'),'')::date,nullif(d->>'data_interna','')::date,nullif(d->>'data_sugerida','')::date,d) returning id into r;
   else
     insert into audiencias(processo_id,publicacao_id,data,hora,status,payload) values(p,pub,(d->>'data')::date,(d->>'hora')::time,coalesce(d->>'status','agendada'),d) returning id into r;
   end if;
 else raise exception 'Entidade não reconhecida'; end if;
 insert into migracao_refs(entidade,chave,registro_id) values(p_entidade,p_chave,r);
 return jsonb_build_object('estado',case when p_entidade='publicacoes' and not (ins->>'inserida')::boolean then 'existente' else 'importado' end,'id',r);
exception when others then
 insert into migracao_revisao(chave,motivo,dados) values(p_entidade||':'||p_chave,sqlerrm,p_original)
 on conflict(user_id,chave) do update set motivo=excluded.motivo;
 return jsonb_build_object('estado','revisao','erro',sqlerrm);
end $$;
revoke all on function public.importar_legado(text,text,jsonb,jsonb) from public,anon;
grant execute on function public.importar_legado(text,text,jsonb,jsonb) to authenticated;
-- Restauração do backup JSON para a MESMA conta. Sem sobrescrever registros atuais.
create or replace function public.restaurar_backup(p_backup jsonb) returns integer language plpgsql security definer set search_path=public as $$
declare t text; row jsonb; campos text; vals text; n integer:=0; changed integer; begin
 if auth.uid() is null or p_backup->>'format' is distinct from 'lex-online' or (p_backup->>'user_id')::uuid is distinct from auth.uid() then raise exception 'Backup deve pertencer à conta autenticada'; end if;
 foreach t in array array['profiles','processos','oabs_monitoradas','publicacoes','publicacao_oabs','compromissos','audiencias','sincronizacoes','migracao_refs','migracao_revisao','historico_alteracoes'] loop
   for row in select value from jsonb_array_elements(coalesce(p_backup->'data'->t,'[]')) loop
     if (row->>'user_id')::uuid is distinct from auth.uid() then raise exception 'Titular inconsistente no backup'; end if;
     select string_agg(quote_ident(column_name),','),string_agg('r.'||quote_ident(column_name),',') into campos,vals from information_schema.columns where table_schema='public' and table_name=t;
     execute format('insert into public.%I(%s) select %s from jsonb_populate_record(null::public.%I,$1) r on conflict do nothing',t,campos,vals,t) using row;
     get diagnostics changed=row_count; n:=n+changed;
   end loop;
 end loop;
 return n;
end $$;
revoke all on function public.restaurar_backup(jsonb) from public,anon;
grant execute on function public.restaurar_backup(jsonb) to authenticated;
commit;
