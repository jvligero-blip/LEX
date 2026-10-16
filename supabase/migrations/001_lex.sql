-- LEX v1. Aplicar uma vez pelo SQL Editor / supabase db push. Não contém reset nem seed.
begin;
create or replace function public.cnj_normalizado(n text) returns text language sql immutable as $$
  select regexp_replace(coalesce(n,''),'[^0-9]','','g')
$$;
create or replace function public.cnj_valido(n text) returns boolean language plpgsql immutable as $$
declare d text := public.cnj_normalizado(n); base text;
begin
  if length(d)<>20 or d ~ '^0+$' then return false; end if;
  base := substring(d,1,7)||substring(d,10,11)||'00';
  return substring(d,8,2)::integer = 98 - mod(base::numeric,97)::integer;
end $$;

create table public.profiles (
 user_id uuid primary key references auth.users(id), nome text not null default '',
 payload jsonb not null default '{}', updated_at timestamptz not null default now()
);
create table public.processos (
 id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id),
 numero_cnj text not null check(public.cnj_valido(numero_cnj) and numero_cnj=public.cnj_normalizado(numero_cnj)),
 payload jsonb not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(user_id,numero_cnj), unique(user_id,id)
);
create table public.oabs_monitoradas (
 id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id),
 numero_oab text not null check(numero_oab ~ '^[0-9]{1,12}$' and numero_oab !~ '^0+$'),
 uf text not null check(uf in ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO')),
 ativa boolean not null default true, created_at timestamptz not null default now(),
 unique(user_id,numero_oab,uf), unique(user_id,id)
);
create table public.publicacoes (
 id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id),
 processo_id uuid, fonte text not null default 'DJEN', id_externo text, fingerprint text not null,
 numero_recebido text, data_disponibilizacao date, data_publicacao date, tribunal text, orgao text,
 tipo text, texto_integral text not null, link_origem text, raw jsonb not null default '{}',
 triagem_status text not null default 'pendente_de_analise' check(triagem_status in ('pendente_de_analise','classificada')),
 classificacao text, providencia text, observacoes text, analisado_por uuid references auth.users(id), analisado_em timestamptz,
 first_seen_at timestamptz not null default now(), last_seen_at timestamptz not null default now(),
 revisao_detectada boolean not null default false, unique(user_id,id),
 foreign key(user_id,processo_id) references public.processos(user_id,id)
);
create unique index publicacao_external_unica on public.publicacoes(user_id,fonte,id_externo) where id_externo is not null;
-- IDs distintos da fonte podem ter o mesmo texto. Sem ID, a identidade é o conteúdo estável completo.
create unique index publicacao_fallback_unica on public.publicacoes(user_id,fonte,fingerprint) where id_externo is null;
create index publicacoes_fila on public.publicacoes(user_id,triagem_status,first_seen_at);
create index publicacoes_pasta on public.publicacoes(user_id,processo_id);
create table public.publicacao_oabs (
 user_id uuid not null default auth.uid(), publicacao_id uuid not null, oab_id uuid not null,
 primary key(user_id,publicacao_id,oab_id),
 foreign key(user_id,publicacao_id) references public.publicacoes(user_id,id),
 foreign key(user_id,oab_id) references public.oabs_monitoradas(user_id,id)
);
create table public.compromissos (
 id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id),
 processo_id uuid, publicacao_id uuid, descricao text not null check(length(trim(descricao))>0),
 tipo text not null default 'Administrativo', status text not null default 'pendente' check(status in ('pendente','concluido')),
 data_fatal_confirmada date, data_interna date, data_sugerida date, confirmado_em timestamptz,
 payload jsonb not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(user_id,id), foreign key(user_id,processo_id) references public.processos(user_id,id),
 foreign key(user_id,publicacao_id) references public.publicacoes(user_id,id)
);
create index compromissos_agenda on public.compromissos(user_id,status,data_fatal_confirmada);
create table public.audiencias (
 id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id),
 processo_id uuid not null, publicacao_id uuid, data date not null, hora time not null,
 status text not null default 'agendada' check(status in ('agendada','realizada','cancelada')),
 payload jsonb not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(user_id,id), foreign key(user_id,processo_id) references public.processos(user_id,id),
 foreign key(user_id,publicacao_id) references public.publicacoes(user_id,id)
);
create index audiencias_agenda on public.audiencias(user_id,data);
create table public.sincronizacoes (
 id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id),
 oab_id uuid not null, inicio date not null, fim date not null check(fim>=inicio),
 checkpoint_data date not null, checkpoint_pagina integer not null default 1 check(checkpoint_pagina between 1 and 10000),
 estado text not null default 'em_andamento' check(estado in ('em_andamento','concluida','parcial','falha')),
 paginas integer not null default 0, itens integer not null default 0, inseridos integer not null default 0,
 duplicados integer not null default 0, falhas integer not null default 0, erro text,
 started_at timestamptz not null default now(), finished_at timestamptz, unique(user_id,id),
 foreign key(user_id,oab_id) references public.oabs_monitoradas(user_id,id)
);
create index sincronizacoes_usuario on public.sincronizacoes(user_id,started_at desc);
create table public.historico_alteracoes (
 id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id),
 entidade text not null, registro_id uuid not null, acao text not null, detalhes jsonb not null default '{}',
 created_at timestamptz not null default now()
);
create index historico_registro on public.historico_alteracoes(user_id,registro_id,created_at);
create table public.migracao_refs (
 user_id uuid not null default auth.uid(), entidade text not null, chave text not null, registro_id uuid not null,
 primary key(user_id,entidade,chave)
);
create table public.migracao_revisao (
 id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id),
 chave text not null, motivo text not null, dados jsonb not null, resolvido boolean not null default false,
 created_at timestamptz not null default now(), unique(user_id,chave)
);
create table public.api_rate_limits (
 user_id uuid primary key references auth.users(id), janela timestamptz not null default now(), chamadas integer not null default 0
);

-- RLS real, inclusive nas tabelas auxiliares; nunca confiar no filtro do cliente.
do $$ declare t text; begin
 foreach t in array array['profiles','processos','oabs_monitoradas','publicacoes','publicacao_oabs','compromissos','audiencias','sincronizacoes','historico_alteracoes','migracao_refs','migracao_revisao','api_rate_limits'] loop
   execute format('alter table public.%I enable row level security',t);
   execute format('revoke all on public.%I from anon',t);
   execute format('grant select,insert,update,delete on public.%I to authenticated',t);
   execute format('create policy titular on public.%I for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id)',t);
 end loop;
end $$;
-- Histórico e cotas só podem ser escritos pelas funções internas abaixo.
revoke insert,update,delete on public.historico_alteracoes from authenticated;
revoke all on public.api_rate_limits from authenticated;

create or replace function public.auditar_lex() returns trigger language plpgsql security definer set search_path=public as $$
declare antigo jsonb; novo jsonb; campos text[] := array['triagem_status','classificacao','providencia','observacoes','processo_id','publicacao_id','status','data_fatal_confirmada','data_interna','data_sugerida','descricao','data','hora','payload'];
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
do $$ declare t text; begin
 foreach t in array array['processos','publicacoes','compromissos','audiencias'] loop
 execute format('create trigger auditoria after insert or update or delete on public.%I for each row execute function public.auditar_lex()',t);
 end loop;
end $$;

create or replace function public.ensure_processo(p_numero text, p_payload jsonb default '{}') returns uuid language plpgsql security invoker set search_path=public as $$
declare p uuid; n text := cnj_normalizado(p_numero); begin
 if auth.uid() is null then raise exception 'Login necessário'; end if;
 if not cnj_valido(n) then raise exception 'CNJ inválido (20 dígitos e verificador)'; end if;
 insert into processos(numero_cnj,payload) values(n,p_payload) on conflict(user_id,numero_cnj) do nothing;
 select id into p from processos where user_id=auth.uid() and numero_cnj=n;
 return p;
end $$;

create or replace function public.ingest_publicacao(p_item jsonb, p_oab uuid default null) returns jsonb language plpgsql security invoker set search_path=public as $$
declare
 ext text:=nullif(p_item->>'id_externo',''); f text:=coalesce(nullif(p_item->>'fonte',''),'DJEN');
 n text:=cnj_normalizado(p_item->>'numero'); fp text; r publicacoes; pid uuid; fresh boolean:=false;
 txt text:=coalesce(p_item->>'texto_integral','');
begin
 if auth.uid() is null then raise exception 'Login necessário'; end if;
 if length(txt)>2000000 then raise exception 'Publicação excede 2 MB; revisar fonte'; end if;
 fp:=encode(sha256(convert_to(jsonb_build_array(f,n,coalesce(p_item->>'tribunal',''),coalesce(p_item->>'orgao',''),coalesce(p_item->>'data_disponibilizacao',''),coalesce(p_item->>'data_publicacao',''),coalesce(p_item->>'tipo',''),coalesce(p_item->>'link_origem',''),p_item->'raw'->>'hash',p_item->'raw'->>'numeroComunicacao',regexp_replace(trim(txt),'\s+',' ','g'))::text,'UTF8')),'hex');
 -- Serialização por titular evita corrida entre IDs ausentes/presentes, OABs e retries.
 perform pg_advisory_xact_lock(hashtext(auth.uid()::text));
 select * into r from publicacoes where user_id=auth.uid() and fonte=f and
   ((ext is not null and id_externo=ext) or (fingerprint=fp and (id_externo is null or ext is null)))
 order by (id_externo is not null) desc limit 1;
 if r.id is null then
   if cnj_valido(n) then pid:=ensure_processo(n,jsonb_build_object('juizo',p_item->>'orgao','tribunal',p_item->>'tribunal')); end if;
   insert into publicacoes(processo_id,fonte,id_externo,fingerprint,numero_recebido,data_disponibilizacao,data_publicacao,tribunal,orgao,tipo,texto_integral,link_origem,raw)
   values(pid,f,ext,fp,p_item->>'numero',nullif(p_item->>'data_disponibilizacao','')::date,nullif(p_item->>'data_publicacao','')::date,p_item->>'tribunal',p_item->>'orgao',p_item->>'tipo',txt,p_item->>'link_origem',coalesce(p_item->'raw','{}')) returning * into r;
   fresh:=true;
 else
   if r.fingerprint<>fp and not exists(select 1 from historico_alteracoes where user_id=auth.uid() and registro_id=r.id and acao='REVISAO_FONTE' and detalhes->>'fingerprint'=fp) then
     insert into historico_alteracoes(user_id,entidade,registro_id,acao,detalhes) values(auth.uid(),'publicacoes',r.id,'REVISAO_FONTE',jsonb_build_object('fingerprint',fp,'fonte',p_item));
   end if;
   update publicacoes set last_seen_at=now(), revisao_detectada=revisao_detectada or fingerprint<>fp,
     id_externo=coalesce(id_externo,ext) where id=r.id;
 end if;
 if p_oab is not null then insert into publicacao_oabs(publicacao_id,oab_id) values(r.id,p_oab) on conflict do nothing; end if;
 return jsonb_build_object('id',r.id,'inserida',fresh,'processo_id',r.processo_id);
end $$;
-- Esta função precisa inserir revisão em histórico, sem abrir escrita arbitrária ao cliente.
-- Trigger dedicado registra revisões; a versão privilegiada mantém sempre auth.uid() no filtro.
alter function public.ingest_publicacao(jsonb,uuid) security definer;

create or replace function public.classificar_publicacao(p_id uuid,p_categoria text,p_providencia text,p_obs text,p_reabrir boolean default false) returns void language plpgsql security invoker set search_path=public as $$
begin
 if not p_reabrir and nullif(trim(p_categoria),'') is null then raise exception 'Informe a classificação'; end if;
 if not p_reabrir and p_categoria='Outro' and nullif(trim(p_providencia),'') is null then raise exception 'Descreva a classificação Outro'; end if;
 update publicacoes set triagem_status=case when p_reabrir then 'pendente_de_analise' else 'classificada' end,
 classificacao=case when p_reabrir then classificacao else p_categoria end,
 providencia=case when p_reabrir then providencia else p_providencia end,
 observacoes=case when p_reabrir then observacoes else p_obs end,
 analisado_por=auth.uid(),analisado_em=now() where id=p_id and user_id=auth.uid();
 if not found then raise exception 'Publicação não acessível'; end if;
end $$;

create or replace function public.iniciar_sync(p_oab uuid,p_inicio date,p_fim date) returns uuid language plpgsql security invoker set search_path=public as $$
declare j uuid; begin
 if p_inicio is null or p_fim is null or p_fim<p_inicio or p_fim-p_inicio>366 then raise exception 'Intervalo inválido; limite de 366 dias por carga'; end if;
 if not exists(select 1 from oabs_monitoradas where id=p_oab and user_id=auth.uid() and ativa) then raise exception 'OAB não acessível ou inativa'; end if;
 insert into sincronizacoes(oab_id,inicio,fim,checkpoint_data) values(p_oab,p_inicio,p_fim,p_inicio) returning id into j; return j;
end $$;
create or replace function public.aplicar_lote_sync(p_job uuid,p_dia date,p_pagina integer,p_items jsonb,p_tem_mais boolean) returns jsonb language plpgsql security invoker set search_path=public as $$
declare j sincronizacoes; item jsonb; r jsonb; novos integer:=0; total integer:=0; begin
 select * into j from sincronizacoes where id=p_job and user_id=auth.uid() for update;
 if j.id is null then raise exception 'Sincronização não acessível'; end if;
 if j.estado='concluida' or j.checkpoint_data<>p_dia or j.checkpoint_pagina<>p_pagina then return to_jsonb(j); end if;
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>100 then raise exception 'Lote inválido'; end if;
 if p_tem_mais and (jsonb_array_length(p_items)=0 or p_pagina>=9999) then raise exception 'Paginação inconsistente'; end if;
 for item in select value from jsonb_array_elements(p_items) loop
   r:=ingest_publicacao(item,j.oab_id); total:=total+1;
   if (r->>'inserida')::boolean then novos:=novos+1; end if;
 end loop;
 update sincronizacoes set paginas=paginas+1,itens=itens+total,inseridos=inseridos+novos,duplicados=duplicados+total-novos,
 checkpoint_data=case when p_tem_mais then p_dia else p_dia+1 end,
 checkpoint_pagina=case when p_tem_mais then p_pagina+1 else 1 end,
 estado=case when not p_tem_mais and p_dia>=fim then 'concluida' else 'em_andamento' end,erro=null,
 finished_at=case when not p_tem_mais and p_dia>=fim then now() else null end
 where id=p_job returning * into j; return to_jsonb(j);
end $$;
create or replace function public.registrar_falha_sync(p_job uuid,p_erro text) returns void language sql security invoker set search_path=public as $$
 update sincronizacoes set estado=case when paginas>0 then 'parcial' else 'falha' end,falhas=falhas+1,erro=left(p_erro,500),finished_at=now()
 where id=p_job and user_id=auth.uid() and estado<>'concluida'
$$;
create or replace function public.reservar_consulta() returns boolean language plpgsql security definer set search_path=public as $$
declare n integer; begin
 if auth.uid() is null then return false; end if;
 insert into api_rate_limits(user_id,chamadas) values(auth.uid(),1)
 on conflict(user_id) do update set chamadas=case when api_rate_limits.janela<now()-interval '1 minute' then 1 else api_rate_limits.chamadas+1 end,
 janela=case when api_rate_limits.janela<now()-interval '1 minute' then now() else api_rate_limits.janela end
 returning chamadas into n; return n<=30;
end $$;

-- Retirar EXECUTE público de todas as funções deste MVP, inclusive security definer.
do $$ declare f record; begin
 for f in select p.oid::regprocedure assinatura from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in
 ('cnj_normalizado','cnj_valido','ensure_processo','auditar_lex','ingest_publicacao','classificar_publicacao','iniciar_sync','aplicar_lote_sync','registrar_falha_sync','reservar_consulta') loop
 execute format('revoke all on function %s from public, anon',f.assinatura);
 execute format('grant execute on function %s to authenticated',f.assinatura);
 end loop;
end $$;
commit;
