-- Correção incremental sobre a V4.1 (001-006). Não reaplicar migrations anteriores.
begin;
do $$ begin
 if to_regprocedure('public.v4_acesso_usuario(uuid,uuid)') is null or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='compromissos' and column_name='versao') then raise exception 'Base V4.1 (005/006) necessária';end if;
end $$;
create table if not exists public.v4_compromisso_acessos (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id), compromisso_id uuid not null,
 membro uuid not null references auth.users(id), ativo boolean not null default true, autorizado_por uuid not null references auth.users(id),
 created_at timestamptz not null default now(), revogado_em timestamptz,
 unique(compromisso_id,membro), foreign key(user_id,compromisso_id) references public.compromissos(user_id,id),check(user_id<>membro)
);
alter table public.v4_compromisso_acessos enable row level security;
revoke all on public.v4_compromisso_acessos from public,anon,authenticated;
grant select on public.v4_compromisso_acessos to authenticated;
create or replace function public.v4_pode_acessar_compromisso(p_id uuid,p_usuario uuid) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select p_usuario is not null and exists(select 1 from public.compromissos c where c.id=p_id and (
 c.user_id=p_usuario or public.v4_acesso_usuario(coalesce(c.pasta_id,public.v4_pasta_processo(c.processo_id)),p_usuario) or
 (public.v4_par_ativo(c.user_id,p_usuario) and exists(select 1 from public.v4_compromisso_acessos a where a.compromisso_id=c.id and a.membro=p_usuario and a.ativo))))
$$;
create or replace function public.v4_acesso_compromisso(p uuid) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$ select public.v4_pode_acessar_compromisso(p,auth.uid()) $$;
drop policy if exists acesso on public.v4_compromisso_acessos;
create policy acesso on public.v4_compromisso_acessos for select to authenticated using(user_id=auth.uid() or (membro=auth.uid() and ativo and public.v4_acesso_compromisso(compromisso_id)));

create or replace function public.v4_destinatarios_delegacao(p_compromisso uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare tarefa public.compromissos; candidatos jsonb; permitido boolean; begin
 if not public.v4_acesso_compromisso(p_compromisso) then raise exception 'Compromisso não acessível';end if;
 select * into tarefa from public.compromissos where id=p_compromisso;
 permitido:=tarefa.status not in ('concluido','cancelado') and coalesce(case when tarefa.responsabilidade_definida then tarefa.responsavel else tarefa.user_id end,auth.uid())=auth.uid();
 select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'nome',coalesce(p.nome,'Colaborador'),
 'tem_acesso',public.v4_pode_acessar_compromisso(tarefa.id,u.id),'pode_autorizar',tarefa.user_id=auth.uid(),
 'acesso_individual',exists(select 1 from public.v4_compromisso_acessos a where a.compromisso_id=tarefa.id and a.membro=u.id and a.ativo)) order by p.nome,u.id),'[]') into candidatos
 from (select case when c.user_id=auth.uid() then c.convidado else c.user_id end id from public.v4_colaboracoes c where c.estado='ativa' and auth.uid() in (c.user_id,c.convidado)) u
 left join public.profiles p on p.user_id=u.id;
 return jsonb_build_object('pode_delegar',permitido,'motivo',case when tarefa.status in ('concluido','cancelado') then 'Compromisso encerrado. Reabra antes de transferir.' when not permitido then 'Somente o responsável atual pode transferir a execução.' else null end,
 'titular',tarefa.user_id,'titulo',tarefa.descricao,'candidatos',candidatos,
 'pendente',(select jsonb_build_object('id',d.id,'destinatario',d.destinatario) from public.v4_delegacoes d where d.compromisso_id=tarefa.id and d.estado='pendente'));
end $$;
create or replace function public.v4_delegar_com_acesso(p_id uuid,p_compromisso uuid,p_destinatario uuid,p_autorizar_compromisso boolean default false) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare tarefa public.compromissos; envio public.v4_delegacoes; begin
 -- Relação -> tarefa -> envio: mesma ordem da revogação, sem ciclo de locks.
 if auth.uid() is null or p_destinatario is null or p_destinatario=auth.uid() then raise exception 'Selecione uma colaboração ativa';end if;
 perform 1 from public.v4_colaboracoes where estado='ativa' and auth.uid() in (user_id,convidado) and p_destinatario in (user_id,convidado) for share;
 if not found then raise exception 'Selecione uma colaboração ativa. Convites pendentes não autorizam transferências.';end if;
 select * into tarefa from public.compromissos where id=p_compromisso for update;
 if not public.v4_acesso_compromisso(p_compromisso) or tarefa.id is null then raise exception 'Compromisso não acessível';end if;
 select * into envio from public.v4_delegacoes where id=p_id;
 if envio.id is not null then
 if envio.user_id<>auth.uid() or envio.compromisso_id<>p_compromisso or envio.destinatario<>p_destinatario then raise exception 'Identificador de envio já utilizado';end if;return envio.id;end if;
 if tarefa.status in ('concluido','cancelado') then raise exception 'Compromisso encerrado. Reabra antes de transferir.';end if;
 if coalesce(case when tarefa.responsabilidade_definida then tarefa.responsavel else tarefa.user_id end,auth.uid())<>auth.uid() then raise exception 'Somente o responsável atual pode transferir a execução.';end if;
 select * into envio from public.v4_delegacoes where compromisso_id=p_compromisso and estado='pendente';
 if envio.id is not null then
 if envio.destinatario=p_destinatario and envio.user_id=auth.uid() then return envio.id;end if;
 raise exception 'Já existe uma transferência aguardando aceite para este compromisso.';end if;
 if not public.v4_pode_acessar_compromisso(tarefa.id,p_destinatario) then
 if not p_autorizar_compromisso then raise exception 'A colaboração está ativa, mas esta tarefa ainda é privada. Confirme o compartilhamento somente deste compromisso.';end if;
 if tarefa.user_id<>auth.uid() then raise exception 'Somente o titular pode autorizar um novo acesso. Peça ao titular para compartilhar este compromisso.';end if;
 insert into public.v4_compromisso_acessos(user_id,compromisso_id,membro,autorizado_por) values(tarefa.user_id,tarefa.id,p_destinatario,auth.uid())
 on conflict(compromisso_id,membro) do update set ativo=true,revogado_em=null,autorizado_por=auth.uid();
 end if;
 insert into public.v4_delegacoes(id,user_id,compromisso_id,destinatario) values(p_id,auth.uid(),tarefa.id,p_destinatario);
 return p_id;
end $$;
-- A assinatura antiga permanece segura; clientes novos podem autorizar o acesso individual explicitamente.
create or replace function public.v4_delegar(p_id uuid,p_compromisso uuid,p_destinatario uuid) returns uuid language sql security invoker set search_path=pg_catalog,public as $$ select public.v4_delegar_com_acesso(p_id,p_compromisso,p_destinatario,false) $$;
create or replace function public.v4_revogar_acesso_compromisso(p_compromisso uuid,p_membro uuid) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare tarefa public.compromissos; begin
 select * into tarefa from public.compromissos where id=p_compromisso for update;
 if auth.uid() is null or tarefa.user_id<>auth.uid() or tarefa.id is null then raise exception 'Somente o titular revoga o acesso individual';end if;
 update public.v4_compromisso_acessos set ativo=false,revogado_em=now() where compromisso_id=tarefa.id and membro=p_membro;
 if not public.v4_pode_acessar_compromisso(tarefa.id,p_membro) then
 update public.v4_delegacoes set estado='revogada',updated_at=now() where compromisso_id=tarefa.id and destinatario=p_membro and estado='pendente';
 if tarefa.responsavel=p_membro and tarefa.status not in ('concluido','cancelado') then update public.compromissos set responsavel=null,responsabilidade_definida=true,atualizado_por=auth.uid() where id=tarefa.id;end if;end if;
end $$;
create or replace function public.v4_responder_delegacao(p_id uuid,p_aceitar boolean) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare envio public.v4_delegacoes; tarefa public.compromissos; begin
 -- Mesma ordem de locks da criação (tarefa -> envio).
 select * into envio from public.v4_delegacoes where id=p_id;
 if envio.id is null or envio.destinatario<>auth.uid() or not public.v4_acesso_compromisso(envio.compromisso_id) then raise exception 'Transferência não acessível. Confira a permissão do compromisso.';end if;
 perform 1 from public.v4_colaboracoes where estado='ativa' and envio.user_id in (user_id,convidado) and envio.destinatario in (user_id,convidado) for share;
 if not found then raise exception 'Colaboração não está ativa';end if;
 select * into tarefa from public.compromissos where id=envio.compromisso_id for update;
 select * into envio from public.v4_delegacoes where id=p_id for update;
 if not public.v4_acesso_compromisso(tarefa.id) then raise exception 'Acesso ao compromisso revogado';end if;
 if envio.estado<>'pendente' then return;end if;
 if p_aceitar and tarefa.status in ('concluido','cancelado') then raise exception 'Compromisso encerrado; não é possível aceitar a execução';end if;
 if not public.v4_par_ativo(envio.user_id,envio.destinatario) then raise exception 'Colaboração não está ativa';end if;
 update public.v4_delegacoes set estado=case when p_aceitar then 'aceita' else 'recusada' end,updated_at=now() where id=p_id;
 if p_aceitar then update public.compromissos set responsavel=auth.uid(),responsabilidade_definida=true,atualizado_por=auth.uid() where id=tarefa.id;end if;
 perform public.v4_atividade(gen_random_uuid(),tarefa.id,case when p_aceitar then 'Transferência aceita' else 'Transferência recusada' end,null,null,null);
end $$;

-- Editar um compromisso autorizado não dá acesso à pasta/publicação privada de origem.
create or replace function public.v4_salvar_compromisso(p_id uuid,p_pasta uuid,p_dados jsonb,p_versao integer default null) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare f public.v4_pastas; c public.compromissos; titular uuid; resp uuid; pid uuid; pubid uuid; begin
 if auth.uid() is null then raise exception 'Login necessário'; end if;
 select * into c from public.compromissos where id=p_id for update;
 if c.id is not null and not public.v4_acesso_compromisso(c.id) then raise exception 'Compromisso não acessível'; end if;
 if c.id is not null and p_versao is distinct from c.versao then raise exception 'Compromisso atualizado por outra pessoa. Recarregue antes de editar'; end if;
 if c.id is not null then p_pasta:=coalesce(p_pasta,c.pasta_id,public.v4_pasta_processo(c.processo_id));end if;
 if p_pasta is not null then
 select * into f from public.v4_pastas where id=p_pasta;
 if not public.v4_acesso_pasta(p_pasta) and c.id is null then raise exception 'Pasta não acessível'; end if;
 titular:=f.user_id;pid:=f.processo_id;
 else titular:=auth.uid(); end if;
 if c.id is not null and (titular<>c.user_id or coalesce(c.pasta_id,public.v4_pasta_processo(c.processo_id)) is distinct from p_pasta) then raise exception 'Não transfira o titular ou pasta de compromisso existente'; end if;
 resp:=nullif(p_dados->>'responsavel','')::uuid;
 if c.id is null then
 if resp is not null and resp<>auth.uid() then raise exception 'Use Encaminhar e aguarde aceite para atribuir a outra pessoa';end if;
 elsif resp is distinct from (case when c.responsabilidade_definida then c.responsavel else c.user_id end) then
 if resp is not null and (resp<>auth.uid() or (case when c.responsabilidade_definida then c.responsavel else c.user_id end) is not null) then raise exception 'Use transferência com aceite; o responsável atual foi preservado';end if;
 if resp is null and auth.uid()<>c.user_id and auth.uid() is distinct from (case when c.responsabilidade_definida then c.responsavel else c.user_id end) then raise exception 'Somente o responsável ou titular pode deixar sem responsável';end if;
 end if;
 if resp is not null and not ((p_pasta is null and resp=auth.uid()) or public.v4_membro_pasta(p_pasta,resp) or (c.id is not null and public.v4_pode_acessar_compromisso(c.id,resp))) then raise exception 'Responsável sem acesso à pasta'; end if;
 if nullif(trim(p_dados->>'descricao'),'') is null then raise exception 'Descreva o compromisso'; end if;
 pubid:=nullif(p_dados->>'publicacao_id','')::uuid;
 if pubid is not null and not exists(select 1 from public.publicacoes p where p.id=pubid and p.user_id=titular and p.processo_id=pid and (public.v4_acesso_publicacao(p.id) or (c.id is not null and c.publicacao_id=p.id))) then raise exception 'Publicação e pasta incompatíveis'; end if;
 if c.id is null then insert into public.compromissos(id,user_id,pasta_id,processo_id,publicacao_id,descricao,tipo,criado_por,responsavel,responsabilidade_definida,atualizado_por)
 values(p_id,titular,p_pasta,pid,pubid,p_dados->>'descricao',coalesce(nullif(p_dados->>'tipo',''),'Administrativo'),auth.uid(),resp,true,auth.uid()); end if;
 update public.compromissos set descricao=p_dados->>'descricao',tipo=coalesce(nullif(p_dados->>'tipo',''),'Administrativo'),responsavel=resp,responsabilidade_definida=true,
 data_fatal_confirmada=nullif(p_dados->>'data_fatal_confirmada','')::date,data_interna=nullif(p_dados->>'data_interna','')::date,data_sugerida=nullif(p_dados->>'data_sugerida','')::date,
 data_revisao=nullif(p_dados->>'data_revisao','')::date,prioridade=coalesce(p_dados->>'prioridade','normal'),
 confirmado_em=case when nullif(p_dados->>'data_fatal_confirmada','') is not null then coalesce(confirmado_em,now()) end,
 payload=coalesce(p_dados->'payload','{}'),atualizado_por=auth.uid(),versao=versao+1,updated_at=now() where id=p_id;
 return p_id;
end $$;

create table if not exists public.v4_notificacoes (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),ator uuid not null references auth.users(id),
 tipo text not null check(tipo in ('convite','convite_aceito','convite_recusado','colaboracao_revogada','delegacao','delegacao_aceita','delegacao_recusada','delegacao_revogada','compromisso_criado','atividade','compromisso_concluido','publicacao_analisada','publicacao_reaberta','pasta_compartilhada','acesso_revogado','leitura')),
 entidade text not null check(entidade in ('v4_colaboracoes','v4_delegacoes','compromissos','publicacoes','v4_pastas')),registro_id uuid not null,
 evento_key text not null,evento_id uuid,created_at timestamptz not null default now(),lida_em timestamptz,
 unique(user_id,evento_key)
);
create index if not exists v4_notificacoes_caixa on public.v4_notificacoes(user_id,created_at desc,id desc);
create index if not exists v4_notificacoes_naolidas on public.v4_notificacoes(user_id) where lida_em is null;
alter table public.v4_notificacoes enable row level security;
revoke all on public.v4_notificacoes from public,anon,authenticated;
grant select on public.v4_notificacoes to authenticated;
drop policy if exists titular on public.v4_notificacoes;
create policy titular on public.v4_notificacoes for select to authenticated using(user_id=auth.uid());
create or replace function public.v4_n_criar(p_usuario uuid,p_tipo text,p_ator uuid,p_entidade text,p_registro uuid,p_key text,p_evento uuid default null) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if p_usuario is null or p_ator is null or p_usuario=p_ator then return;end if;
 insert into public.v4_notificacoes(user_id,tipo,ator,entidade,registro_id,evento_key,evento_id) values(p_usuario,p_tipo,p_ator,p_entidade,p_registro,p_key,p_evento) on conflict(user_id,evento_key) do nothing;
end $$;
create or replace function public.v4_n_destinos_pasta(p_pasta uuid) returns setof uuid language sql stable security definer set search_path=pg_catalog,public as $$
 with f as (select * from public.v4_pastas where id=p_pasta),u as (
 select user_id id from f union select m.membro from public.v4_membros m where m.pasta_id=p_pasta and m.ativo union
 select case when c.user_id=f.user_id then c.convidado else c.user_id end from f join public.v4_colaboracoes c on f.user_id in (c.user_id,c.convidado) and c.estado='ativa')
 select id from u where public.v4_acesso_usuario(p_pasta,id)
$$;
create or replace function public.v4_n_destinos_tarefa(p_id uuid) returns setof uuid language sql stable security definer set search_path=pg_catalog,public as $$
 with t as (select * from public.compromissos where id=p_id),u as (
 select user_id id from t union select criado_por from t union select responsavel from t union
 select public.v4_n_destinos_pasta(coalesce(pasta_id,public.v4_pasta_processo(processo_id))) from t union
 select a.membro from public.v4_compromisso_acessos a where a.compromisso_id=p_id and a.ativo)
 select id from u where id is not null and public.v4_pode_acessar_compromisso(p_id,id)
$$;
create or replace function public.v4_n_eventos() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare destinatario uuid; agente uuid; pasta uuid; classe text; chave text; begin
 if tg_table_name='v4_colaboracoes' then
 if new.estado='pendente' and (tg_op='INSERT' or old.estado is distinct from new.estado) then perform public.v4_n_criar(new.convidado,'convite',new.user_id,'v4_colaboracoes',new.id,'convite:'||new.id||':'||extract(epoch from new.updated_at));
 elsif tg_op='UPDATE' and old.estado is distinct from new.estado then
 if new.estado in ('ativa','recusada') then perform public.v4_n_criar(new.user_id,case when new.estado='ativa' then 'convite_aceito' else 'convite_recusado' end,new.convidado,'v4_colaboracoes',new.id,'convite-resposta:'||new.id||':'||new.updated_at);
 elsif new.estado='revogada' then
 update public.v4_compromisso_acessos set ativo=false,revogado_em=now() where (user_id=old.user_id and membro=old.convidado) or (user_id=old.convidado and membro=old.user_id);
 agente:=coalesce(auth.uid(),new.user_id);destinatario:=case when agente=new.user_id then new.convidado else new.user_id end;
 perform public.v4_n_criar(destinatario,'colaboracao_revogada',agente,'v4_colaboracoes',new.id,'revogacao:'||new.id||':'||new.updated_at);
 end if;end if;
 elsif tg_table_name='v4_delegacoes' then
 if tg_op='INSERT' then perform public.v4_n_criar(new.destinatario,'delegacao',new.user_id,'v4_delegacoes',new.id,'delegacao:'||new.id);
 elsif old.estado is distinct from new.estado then
 if new.estado in ('aceita','recusada') then perform public.v4_n_criar(new.user_id,case when new.estado='aceita' then 'delegacao_aceita' else 'delegacao_recusada' end,new.destinatario,'v4_delegacoes',new.id,'delegacao-resposta:'||new.id||':'||new.estado);
 elsif new.estado='revogada' then perform public.v4_n_criar(new.destinatario,'delegacao_revogada',coalesce(auth.uid(),new.user_id),'v4_delegacoes',new.id,'delegacao-revogada:'||new.id);end if;end if;
 elsif tg_table_name='compromissos' then
 agente:=coalesce(new.criado_por,auth.uid(),new.user_id);
 for destinatario in select public.v4_n_destinos_tarefa(new.id) loop perform public.v4_n_criar(destinatario,'compromisso_criado',agente,'compromissos',new.id,'compromisso:'||new.id);end loop;
 elsif tg_table_name='compromisso_atividades' then
 agente:=coalesce(new.ator,auth.uid(),new.user_id);
 -- Aceites já têm notificação própria; o andamento continua integral na timeline.
 if new.texto in ('Transferência aceita','Transferência recusada') then return new;end if;
 classe:=case when new.estado_novo='concluido' and new.estado_anterior is distinct from new.estado_novo then 'compromisso_concluido' else 'atividade' end;
 for destinatario in select public.v4_n_destinos_tarefa(new.compromisso_id) loop perform public.v4_n_criar(destinatario,classe,agente,'compromissos',new.compromisso_id,'atividade:'||new.id,new.id);end loop;
 elsif tg_table_name='v4_decisoes' then
 if new.individual then return new;end if;
 if new.decisao='reabrir' then classe:='publicacao_reaberta';elsif new.ativa then classe:='publicacao_analisada';else return new;end if;
 for destinatario in select public.v4_n_destinos_pasta(new.pasta_id) loop perform public.v4_n_criar(destinatario,classe,new.user_id,'publicacoes',new.publicacao_id,'analise:'||new.id,new.id);end loop;
 elsif tg_table_name='v4_membros' then
 if new.ativo and (tg_op='INSERT' or not old.ativo) then perform public.v4_n_criar(new.membro,'pasta_compartilhada',coalesce(auth.uid(),new.user_id),'v4_pastas',new.pasta_id,'pasta:'||new.id||':'||transaction_timestamp());
 elsif not new.ativo then
 update public.v4_compromisso_acessos a set ativo=false,revogado_em=now() where a.membro=new.membro and exists(select 1 from public.compromissos c where c.id=a.compromisso_id and coalesce(c.pasta_id,public.v4_pasta_processo(c.processo_id))=new.pasta_id);
 update public.v4_delegacoes d set estado='revogada',updated_at=now() where d.estado='pendente' and d.destinatario=new.membro and exists(select 1 from public.compromissos c where c.id=d.compromisso_id and coalesce(c.pasta_id,public.v4_pasta_processo(c.processo_id))=new.pasta_id);
 if tg_op='UPDATE' and old.ativo then perform public.v4_n_criar(new.membro,'acesso_revogado',coalesce(auth.uid(),new.user_id),'v4_pastas',new.pasta_id,'pasta-revogada:'||new.id||':'||transaction_timestamp());end if;
 end if;
 elsif tg_table_name='v4_compromisso_acessos' then
 insert into public.historico_alteracoes(user_id,entidade,registro_id,acao,ator,detalhes) values(new.user_id,'compromissos',new.compromisso_id,case when new.ativo then 'COMPARTILHAR_COMPROMISSO' else 'REVOGAR_COMPROMISSO' end,coalesce(auth.uid(),new.autorizado_por),jsonb_build_object('membro',new.membro,'alcance','somente_compromisso'));
 if tg_op='UPDATE' and old.ativo and not new.ativo then perform public.v4_n_criar(new.membro,'acesso_revogado',coalesce(auth.uid(),new.autorizado_por),'compromissos',new.compromisso_id,'tarefa-revogada:'||new.id||':'||new.revogado_em);end if;
 end if;return new;
end $$;
do $$ declare tabela text; begin
 foreach tabela in array array['v4_colaboracoes','v4_delegacoes','compromissos','compromisso_atividades','v4_decisoes','v4_membros','v4_compromisso_acessos'] loop
 execute format('drop trigger if exists notificacoes_v4 on public.%I',tabela);
 execute format('create trigger notificacoes_v4 after insert %s on public.%I for each row execute function public.v4_n_eventos()',case when tabela in ('v4_colaboracoes','v4_delegacoes','v4_membros','v4_compromisso_acessos') then 'or update' else '' end,tabela);
 end loop;
end $$;

-- Conteúdo da notificação é resolvido na leitura, segundo a permissão ATUAL. Sem cópia privada no inbox.
create or replace function public.v4_n_item(p public.v4_notificacoes) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare titulo text; detalhe text; nome text; estado text; destino text; registro uuid; acessivel boolean:=false; responder boolean:=false;
 convite public.v4_colaboracoes; envio public.v4_delegacoes; tarefa public.compromissos; publicacao public.publicacoes; pasta public.v4_pastas; decisao public.v4_decisoes;
begin
 if auth.uid() is null or p.user_id<>auth.uid() then return null;end if;
 select coalesce(pr.nome,'Colaborador') into nome from public.profiles pr where pr.user_id=p.ator;
 if p.entidade='v4_colaboracoes' then
 select * into convite from public.v4_colaboracoes c where c.id=p.registro_id and auth.uid() in (c.user_id,c.convidado);
 acessivel:=convite.id is not null;estado:=convite.estado;destino:='advogado';registro:=convite.id;
 responder:=p.tipo='convite' and convite.estado='pendente' and convite.convidado=auth.uid();
 titulo:='Colaboração entre contas';
 elsif p.entidade='v4_delegacoes' then
 select * into envio from public.v4_delegacoes d where d.id=p.registro_id and auth.uid() in (d.user_id,d.destinatario);
 acessivel:=envio.id is not null and public.v4_acesso_compromisso(envio.compromisso_id);
 if acessivel then select * into tarefa from public.compromissos where id=envio.compromisso_id;titulo:=tarefa.descricao;estado:=case when envio.estado='pendente' and tarefa.status in ('concluido','cancelado') then 'compromisso_encerrado' else envio.estado end;destino:='compromisso';registro:=tarefa.id;end if;
 responder:=acessivel and p.tipo='delegacao' and envio.destinatario=auth.uid() and envio.estado='pendente' and tarefa.status not in ('concluido','cancelado');
 elsif p.entidade='compromissos' then
 acessivel:=public.v4_acesso_compromisso(p.registro_id);
 if acessivel then select * into tarefa from public.compromissos where id=p.registro_id;titulo:=tarefa.descricao;estado:=tarefa.status;destino:='compromisso';registro:=tarefa.id;end if;
 elsif p.entidade='publicacoes' then
 acessivel:=public.v4_acesso_publicacao(p.registro_id);
 if acessivel then
 select * into publicacao from public.publicacoes where id=p.registro_id;
 select * into decisao from public.v4_decisoes where id=p.evento_id and publicacao_id=publicacao.id;
 titulo:='Publicação · '||coalesce(publicacao.numero_recebido,'sem CNJ');detalhe:=coalesce(decisao.decisao,publicacao.classificacao);destino:='publicacao';registro:=publicacao.id;estado:=publicacao.triagem_status;
 end if;
 elsif p.entidade='v4_pastas' then
 acessivel:=public.v4_acesso_pasta(p.registro_id);
 if acessivel then select * into pasta from public.v4_pastas where id=p.registro_id;titulo:=pasta.titulo;destino:='pasta';registro:=coalesce(pasta.processo_id,pasta.id);end if;
 end if;
 return jsonb_build_object('id',p.id,'tipo',p.tipo,'ator',coalesce(nome,'Colaborador'),'created_at',p.created_at,'lida_em',p.lida_em,
 'titulo',case when acessivel then titulo else 'Acesso indisponível ou revogado' end,'detalhe',case when acessivel then detalhe end,
 'estado',estado,'acessivel',acessivel,'destino',case when acessivel then destino end,'registro_id',case when acessivel then registro end,
 'responder',responder,'solicitacao_id',case when responder then p.registro_id end);
end $$;
create or replace function public.v4_listar_notificacoes(p_limite integer default 30,p_antes uuid default null,p_nao_lidas boolean default false) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare itens jsonb; ancora public.v4_notificacoes; quantidade integer; limite integer:=greatest(1,least(coalesce(p_limite,30),100)); ultimo uuid; begin
 if auth.uid() is null then raise exception 'Login necessário';end if;
 if p_antes is not null then
 select * into ancora from public.v4_notificacoes where id=p_antes and user_id=auth.uid();if ancora.id is null then raise exception 'Página de notificações não acessível';end if;end if;
 select count(*) into quantidade from public.v4_notificacoes where user_id=auth.uid() and lida_em is null;
 select coalesce(jsonb_agg(public.v4_n_item(n) order by n.created_at desc,n.id desc),'[]') into itens from (
 select * from public.v4_notificacoes n where n.user_id=auth.uid() and (not p_nao_lidas or n.lida_em is null) and (p_antes is null or (n.created_at,n.id)<(ancora.created_at,ancora.id)) order by n.created_at desc,n.id desc limit limite+1) n;
 return jsonb_build_object('itens',case when jsonb_array_length(itens)>limite then itens-limite else itens end,'nao_lidas',quantidade,'tem_mais',jsonb_array_length(itens)>limite);
end $$;
create or replace function public.v4_marcar_notificacoes_lidas(p_ids uuid[] default null) returns integer language plpgsql security definer set search_path=pg_catalog,public as $$
declare quantidade integer; begin
 if auth.uid() is null then raise exception 'Login necessário';end if;
 if cardinality(p_ids)>100 then raise exception 'Marque no máximo 100 itens por vez';end if;
 update public.v4_notificacoes set lida_em=now() where user_id=auth.uid() and lida_em is null and (p_ids is null or id=any(p_ids));get diagnostics quantidade=row_count;return quantidade;
end $$;
create or replace function public.v4_n_leitura() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare autorizado boolean:=false; begin
 if old.lida_em is not null or new.lida_em is null or new.tipo not in ('convite','delegacao') then return new;end if;
 if new.entidade='v4_colaboracoes' then autorizado:=exists(select 1 from public.v4_colaboracoes c where c.id=new.registro_id and c.user_id=new.ator and c.convidado=new.user_id);
 elsif new.entidade='v4_delegacoes' then autorizado:=exists(select 1 from public.v4_delegacoes d where d.id=new.registro_id and d.user_id=new.ator and d.destinatario=new.user_id and public.v4_pode_acessar_compromisso(d.compromisso_id,new.ator));end if;
 if autorizado then perform public.v4_n_criar(new.ator,'leitura',new.user_id,new.entidade,new.registro_id,'leitura:'||new.id,new.id);end if;return new;
end $$;
drop trigger if exists leitura_v4 on public.v4_notificacoes;
create trigger leitura_v4 after update of lida_em on public.v4_notificacoes for each row execute function public.v4_n_leitura();

-- Migração só recupera solicitações PENDENTES. Não renotifica análises antigas nem reabre tarefas.
insert into public.v4_notificacoes(user_id,ator,tipo,entidade,registro_id,evento_key,created_at)
 select c.convidado,c.user_id,'convite','v4_colaboracoes',c.id,'convite:'||c.id||':'||extract(epoch from c.updated_at),c.updated_at from public.v4_colaboracoes c where c.estado='pendente' on conflict(user_id,evento_key) do nothing;
insert into public.v4_notificacoes(user_id,ator,tipo,entidade,registro_id,evento_key,created_at)
 select d.destinatario,d.user_id,'delegacao','v4_delegacoes',d.id,'delegacao:'||d.id,d.created_at from public.v4_delegacoes d where d.estado='pendente' on conflict(user_id,evento_key) do nothing;

-- Funções auxiliares não são endpoints públicos. O cliente não escolhe remetente/destinatário de notificações.
create or replace function public.v4_analisar_com_encaminhamento(p_id uuid,p_request uuid,p_destinatario uuid,p_descricao text default null,p_tarefa jsonb default null,p_individual boolean default false,p_categoria text default null,p_observacoes text default null,p_autorizar_compromisso boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare resultado jsonb; tarefa uuid; decisao public.v4_decisoes; begin
 if not public.v4_acesso_publicacao(p_id) then raise exception 'Publicação não acessível';end if;
 select * into decisao from public.v4_decisoes where id=p_request;
 if decisao.id is not null then
 if decisao.user_id<>auth.uid() or decisao.publicacao_id<>p_id or decisao.decisao<>'encaminhar' or not exists(select 1 from public.v4_delegacoes d where d.id=p_request and d.user_id=auth.uid() and d.destinatario=p_destinatario and d.compromisso_id=decisao.compromisso_id) then raise exception 'Identificador de encaminhamento já utilizado';end if;
 return jsonb_build_object('decisao_id',decisao.id,'compromisso_id',decisao.compromisso_id,'existente',true);
 end if;
 resultado:=public.v4_analisar(p_id,'vou_fazer',p_request,p_descricao,p_tarefa,p_individual,p_categoria,p_observacoes);
 if coalesce((resultado->>'existente')::boolean,false) then return resultado;end if;
 tarefa:=(resultado->>'compromisso_id')::uuid;
 if tarefa is null then raise exception 'Encaminhamento exige compromisso persistido';end if;
 perform public.v4_delegar_com_acesso(p_request,tarefa,p_destinatario,p_autorizar_compromisso);
 update public.v4_decisoes set decisao='encaminhar' where id=p_request and user_id=auth.uid();
 return resultado;
end $$;
do $$ declare f record; begin
 for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and
 (p.proname like 'v4_n_%' or p.proname in ('v4_pode_acessar_compromisso','v4_destinatarios_delegacao','v4_delegar_com_acesso','v4_revogar_acesso_compromisso','v4_listar_notificacoes','v4_marcar_notificacoes_lidas','v4_analisar_com_encaminhamento')) loop execute format('revoke all on function %s from public,anon,authenticated',f.sig);end loop;
end $$;
grant execute on function public.v4_destinatarios_delegacao(uuid),public.v4_delegar_com_acesso(uuid,uuid,uuid,boolean),public.v4_revogar_acesso_compromisso(uuid,uuid),public.v4_listar_notificacoes(integer,uuid,boolean),public.v4_marcar_notificacoes_lidas(uuid[]),public.v4_analisar_com_encaminhamento(uuid,uuid,uuid,text,jsonb,boolean,text,text,boolean) to authenticated;
commit;
