-- V3: aplicar APENAS esta migration sobre a base 001-003 existente, após backup.
begin;
alter table public.publicacoes add column if not exists exige_providencia boolean;
alter table public.compromissos add column if not exists data_revisao date;
alter table public.compromissos add column if not exists prioridade text not null default 'normal';
alter table public.compromissos add column if not exists concluido_em timestamptz;
alter table public.compromissos add column if not exists concluido_por uuid references auth.users(id);
-- Amplia o conjunto aceito sem reescrever os estados existentes.
alter table public.compromissos drop constraint if exists compromissos_status_check;
alter table public.compromissos add constraint compromissos_status_check check(status in ('pendente','em_andamento','aguardando_terceiro','concluido','cancelado'));
create table if not exists public.compromisso_atividades (
 id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id),
 compromisso_id uuid not null, texto text not null check(length(trim(texto))>0),
 estado_anterior text, estado_novo text, proximo_passo text, created_at timestamptz not null default now(),
 foreign key(user_id,compromisso_id) references public.compromissos(user_id,id)
);
create index if not exists compromisso_atividades_timeline on public.compromisso_atividades(user_id,compromisso_id,created_at);
alter table public.compromisso_atividades enable row level security;
revoke all on public.compromisso_atividades from anon,authenticated;
grant select,insert on public.compromisso_atividades to authenticated;
do $$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='compromisso_atividades' and policyname='titular') then
 create policy titular on public.compromisso_atividades for all to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
 end if;
end $$;

create or replace function public.classificar_publicacao_v3(
 p_id uuid,p_categoria text,p_exige boolean,p_providencia text,p_obs text,
 p_compromissos jsonb default '[]',p_reabrir boolean default false,p_motivo text default null
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare p publicacoes; c jsonb; cid uuid; resultado uuid; pasta uuid; begin
 select * into p from publicacoes where id=p_id and user_id=auth.uid() for update;
 if p.id is null then raise exception 'Publicação não acessível'; end if;
 if p_reabrir then
   update publicacoes set triagem_status='pendente_de_analise',analisado_por=auth.uid(),analisado_em=now(),
    observacoes=case when nullif(trim(p_motivo),'') is null then observacoes else concat_ws(E'\n',observacoes,'Reabertura: '||p_motivo) end
    where id=p_id and user_id=auth.uid();
   return jsonb_build_object('id',p_id,'reaberta',true);
 end if;
 if nullif(trim(p_categoria),'') is null or p_exige is null then raise exception 'Informe categoria e decisão explícita sobre providência'; end if;
 if p_categoria='Outro' and nullif(trim(p_providencia),'') is null then raise exception 'Descreva a classificação Outro'; end if;
 if jsonb_typeof(p_compromissos)<>'array' or jsonb_array_length(p_compromissos)>20 then raise exception 'Lista de compromissos inválida'; end if;
 for c in select value from jsonb_array_elements(p_compromissos) loop
   if not p_exige then raise exception 'Somente ciência não cria compromisso'; end if;
   cid:=(c->>'id')::uuid;
   if cid is null or nullif(trim(c->>'descricao'),'') is null or nullif(c->>'processo_id','') is null then raise exception 'Compromisso exige ID, descrição e pasta'; end if;
   if not exists(select 1 from processos where id=(c->>'processo_id')::uuid and user_id=auth.uid()) then raise exception 'Pasta não acessível'; end if;
   insert into compromissos(id,processo_id,publicacao_id,descricao,tipo,data_fatal_confirmada,data_interna,data_sugerida,data_revisao,payload,confirmado_em)
   values(cid,(c->>'processo_id')::uuid,p_id,c->>'descricao',coalesce(c->>'tipo','Administrativo'),nullif(c->>'data_fatal_confirmada','')::date,
    nullif(c->>'data_interna','')::date,nullif(c->>'data_sugerida','')::date,nullif(c->>'data_revisao','')::date,coalesce(c->'payload','{}'),
    case when nullif(c->>'data_fatal_confirmada','') is not null then now() end)
   on conflict(id) do nothing;
   -- Retry nunca pode reaproveitar o ID de outra publicação/conta.
   if not exists(select 1 from compromissos where id=cid and user_id=auth.uid() and publicacao_id=p_id and processo_id=(c->>'processo_id')::uuid and descricao=c->>'descricao') then raise exception 'ID de compromisso já utilizado em outro registro'; end if;
 end loop;
 if p_exige then
   select id,processo_id into resultado,pasta from compromissos where user_id=auth.uid() and publicacao_id=p_id and processo_id is not null and status<>'cancelado' and length(trim(descricao))>0 order by created_at limit 1;
   if resultado is null then raise exception 'Salve pelo menos um compromisso válido com pasta antes de encerrar a análise'; end if;
 end if;
 update publicacoes set triagem_status='classificada',exige_providencia=p_exige,classificacao=p_categoria,processo_id=coalesce(processo_id,pasta),
  providencia=p_providencia,observacoes=p_obs,analisado_por=auth.uid(),analisado_em=now() where id=p_id and user_id=auth.uid();
 return jsonb_build_object('id',p_id,'compromisso_id',resultado,'processo_id',coalesce(p.processo_id,pasta));
end $$;

-- Compatibilidade com clientes anteriores: a chamada antiga passa pela mesma proteção.
create or replace function public.classificar_publicacao(p_id uuid,p_categoria text,p_providencia text,p_obs text,p_reabrir boolean default false) returns void language plpgsql security invoker set search_path=public as $$
begin
 perform classificar_publicacao_v3(p_id,p_categoria,p_categoria not in ('Ciência, sem providência','Ciência sem providência'),p_providencia,p_obs,'[]',p_reabrir,null);
end $$;

-- Defesa também para UPDATE direto: dados legados (flag nula) não são reclassificados.
create or replace function public.validar_triagem_v3() returns trigger language plpgsql security invoker set search_path=public as $$
begin
 if tg_op='UPDATE' and new.triagem_status is not distinct from old.triagem_status and new.exige_providencia is not distinct from old.exige_providencia then return new; end if;
 if new.triagem_status='classificada' and new.exige_providencia is true and not exists(
  select 1 from compromissos where user_id=new.user_id and publicacao_id=new.id and processo_id is not null and length(trim(descricao))>0
 ) then raise exception 'Providência exige compromisso persistido'; end if;
 return new;
end $$;
do $$ begin
 if not exists(select 1 from pg_trigger where tgname='triagem_v3' and tgrelid='public.publicacoes'::regclass) then
 create trigger triagem_v3 before insert or update on public.publicacoes for each row execute function public.validar_triagem_v3();
 end if;
end $$;

create or replace function public.registrar_atividade_v3(p_id uuid,p_compromisso uuid,p_texto text,p_estado text default null,p_proximo text default null,p_revisao date default null)
returns uuid language plpgsql security invoker set search_path=public as $$
declare c compromissos; a compromisso_atividades; novo text; begin
 select * into c from compromissos where id=p_compromisso and user_id=auth.uid() for update;
 if c.id is null then raise exception 'Compromisso não acessível'; end if;
 select * into a from compromisso_atividades where id=p_id and user_id=auth.uid();
 if a.id is not null then
  if a.compromisso_id<>p_compromisso or a.texto<>p_texto then raise exception 'ID de atividade já utilizado'; end if;
  return a.id;
 end if;
 if nullif(trim(p_texto),'') is null then raise exception 'Informe o andamento'; end if;
 novo:=coalesce(nullif(p_estado,''),c.status);
 if novo not in ('pendente','em_andamento','aguardando_terceiro','concluido','cancelado') then raise exception 'Estado inválido'; end if;
 insert into compromisso_atividades(id,compromisso_id,texto,estado_anterior,estado_novo,proximo_passo)
 values(p_id,p_compromisso,p_texto,c.status,novo,p_proximo);
 update compromissos set status=novo,data_revisao=coalesce(p_revisao,data_revisao),updated_at=now(),
  payload=case when p_proximo is null then payload else payload||jsonb_build_object('proximo_passo',p_proximo) end,
  concluido_em=case when novo='concluido' then coalesce(concluido_em,now()) else null end,
  concluido_por=case when novo='concluido' then auth.uid() else null end
 where id=p_compromisso and user_id=auth.uid();
 return p_id;
end $$;

-- Fonte original protegida: sincronizações já preservam; UPDATE direto também deve preservar.
create or replace function public.proteger_original_v3() returns trigger language plpgsql as $$
begin
 if new.texto_integral is distinct from old.texto_integral then raise exception 'Conteúdo original é imutável; mantenha revisões no histórico'; end if;
 return new;
end $$;
do $$ begin
 if not exists(select 1 from pg_trigger where tgname='original_v3' and tgrelid='public.publicacoes'::regclass) then
 create trigger original_v3 before update on public.publicacoes for each row execute function public.proteger_original_v3();
 end if;
end $$;
revoke all on function public.classificar_publicacao_v3(uuid,text,boolean,text,text,jsonb,boolean,text) from public,anon;
revoke all on function public.registrar_atividade_v3(uuid,uuid,text,text,text,date) from public,anon;
revoke all on function public.validar_triagem_v3(),public.proteger_original_v3() from public,anon;
grant execute on function public.classificar_publicacao_v3(uuid,text,boolean,text,text,jsonb,boolean,text),public.registrar_atividade_v3(uuid,uuid,text,text,text,date),public.validar_triagem_v3(),public.proteger_original_v3() to authenticated;
create or replace function public.auditar_lex() returns trigger language plpgsql security definer set search_path=public as $$
declare antigo jsonb; novo jsonb; campos text[] := array['triagem_status','classificacao','providencia','observacoes','processo_id','publicacao_id','status','data_fatal_confirmada','data_interna','data_sugerida','descricao','data','hora','payload','exige_providencia','data_revisao','prioridade','concluido_em','concluido_por'];
begin
 if tg_op='DELETE' then
   select coalesce(jsonb_object_agg(key,value),'{}') into antigo from jsonb_each(to_jsonb(old)) where key=any(campos);
 end if;
 if tg_op='INSERT' then
   select coalesce(jsonb_object_agg(key,value),'{}') into novo from jsonb_each(to_jsonb(new)) where key=any(campos);
 end if;
 if tg_op='UPDATE' then
   if new.user_id<>old.user_id then raise exception 'Titular imutável'; end if;
   select coalesce(jsonb_object_agg(key,value),'{}') into antigo from jsonb_each(to_jsonb(old)) where key=any(campos);
   select coalesce(jsonb_object_agg(key,value),'{}') into novo from jsonb_each(to_jsonb(new)) where key=any(campos);
   if antigo=novo then return new; end if;
 end if;
 insert into public.historico_alteracoes(user_id,entidade,registro_id,acao,detalhes)
 values(coalesce(new.user_id,old.user_id),tg_table_name,coalesce(new.id,old.id),tg_op,
 jsonb_build_object('antes',antigo,'depois',novo));
 return coalesce(new,old);
end $$;

create or replace function public.restaurar_backup(p_backup jsonb) returns integer language plpgsql security definer set search_path=public as $$
declare t text; row jsonb; campos text; vals text; n integer:=0; changed integer; novas uuid[]:=array[]::uuid[]; begin
 if auth.uid() is null or p_backup->>'format' is distinct from 'lex-online' or (p_backup->>'user_id')::uuid is distinct from auth.uid() then raise exception 'Backup deve pertencer à conta autenticada'; end if;
 foreach t in array array['profiles','processos','oabs_monitoradas','publicacoes','publicacao_oabs','compromissos','audiencias','sincronizacoes','compromisso_atividades','migracao_refs','migracao_revisao','historico_alteracoes'] loop
   for row in select value from jsonb_array_elements(coalesce(p_backup->'data'->t,'[]')) loop
     if (row->>'user_id')::uuid is distinct from auth.uid() then raise exception 'Titular inconsistente no backup'; end if;
     if t='publicacoes' then row:=row||jsonb_build_object('exige_providencia',null); end if;
     if t='compromissos' and row->>'prioridade' is null then row:=row||jsonb_build_object('prioridade','normal'); end if;
     select string_agg(quote_ident(column_name),','),string_agg('r.'||quote_ident(column_name),',') into campos,vals from information_schema.columns where table_schema='public' and table_name=t;
     execute format('insert into public.%I(%s) select %s from jsonb_populate_record(null::public.%I,$1) r on conflict do nothing',t,campos,vals,t) using row;
     get diagnostics changed=row_count; n:=n+changed; if t='publicacoes' and changed>0 then novas:=array_append(novas,(row->>'id')::uuid); end if;
   end loop;
 end loop;
 for row in select value from jsonb_array_elements(coalesce(p_backup->'data'->'publicacoes','[]')) loop
  if (row->>'id')::uuid=any(novas) then
   update publicacoes set exige_providencia=(row->>'exige_providencia')::boolean where id=(row->>'id')::uuid and user_id=auth.uid();
  end if;
 end loop;
 return n;
end $$;
commit;
