-- LEX V4.2. Incremental: aplicar depois de 007, sem reset e sem alterar 001-007.
begin;
do $$ begin
 if to_regclass('public.v4_compromisso_acessos') is null then raise exception 'Aplique a migration 007 antes da 008';end if;
end $$;

-- Relatório ANTES da substituição do predicado legado. Não cria membros.
create table if not exists public.v42_acessos_implicitos (
 pasta_id uuid not null references public.v4_pastas(id),user_id uuid not null references auth.users(id),
 membro uuid not null references auth.users(id),registrado_em timestamptz not null default now(),
 motivo text not null default 'Acesso implícito da V4.1 suspenso; exige autorização expressa',primary key(pasta_id,membro)
);
alter table public.v42_acessos_implicitos enable row level security;
revoke all on public.v42_acessos_implicitos from public,anon,authenticated;
grant select on public.v42_acessos_implicitos to authenticated;
drop policy if exists titular on public.v42_acessos_implicitos;
create policy titular on public.v42_acessos_implicitos for select to authenticated using(user_id=auth.uid());
insert into public.v42_acessos_implicitos(pasta_id,user_id,membro)
 select f.id,f.user_id,case when c.user_id=f.user_id then c.convidado else c.user_id end
 from public.v4_pastas f join public.v4_colaboracoes c on f.user_id in(c.user_id,c.convidado) and c.estado='ativa'
 where public.v4_acesso_usuario(f.id,case when c.user_id=f.user_id then c.convidado else c.user_id end)
 and not exists(select 1 from public.v4_membros m where m.pasta_id=f.id and m.ativo and m.membro=case when c.user_id=f.user_id then c.convidado else c.user_id end)
 on conflict do nothing;

create or replace function public.v4_acesso_usuario(p uuid,u uuid) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select u is not null and exists(select 1 from public.v4_pastas f where f.id=p and (f.user_id=u or
 (public.v4_par_ativo(f.user_id,u) and exists(select 1 from public.v4_membros m where m.pasta_id=f.id and m.membro=u and m.ativo))))
$$;
-- Restrita/exclusões continuam no cadastro: nada é compartilhado por correspondência.
-- Uma autorização EXPRESSA do titular pode compartilhar inclusive uma pasta restrita.

-- Um lock transacional comum às RPCs de colaboração evita inversão relação/pasta/tarefa.
-- Escritório pequeno: serialização curta de gravações, sem bloquear consultas.
create or replace function public.v42_travar() returns void language sql volatile security definer set search_path=pg_catalog,public as $$ select pg_advisory_xact_lock(8242001) $$;

alter table public.v4_delegacoes add column if not exists autorizar_acesso boolean not null default false;
alter table public.v4_delegacoes add column if not exists autorizado_por uuid references auth.users(id);
alter table public.v4_compromisso_acessos add column if not exists delegacao_id uuid references public.v4_delegacoes(id);
create table if not exists public.v42_auditoria_acessos (
 acesso_id uuid primary key references public.v4_compromisso_acessos(id),user_id uuid not null references auth.users(id),
 compromisso_id uuid not null,membro uuid not null,antes jsonb not null,resultado text not null,registrado_em timestamptz not null default now()
);
alter table public.v42_auditoria_acessos enable row level security;
revoke all on public.v42_auditoria_acessos from public,anon,authenticated;
grant select on public.v42_auditoria_acessos to authenticated;
drop policy if exists titular on public.v42_auditoria_acessos;
create policy titular on public.v42_auditoria_acessos for select to authenticated using(user_id=auth.uid());
insert into public.v42_auditoria_acessos(acesso_id,user_id,compromisso_id,membro,antes,resultado)
 select a.id,a.user_id,a.compromisso_id,a.membro,to_jsonb(a),case when not a.ativo then 'já inativo'
 when exists(select 1 from public.v4_delegacoes d where d.compromisso_id=a.compromisso_id and d.destinatario=a.membro and d.estado='aceita' and d.user_id=a.user_id and d.updated_at>=greatest(a.created_at,coalesce((select max(h.created_at) from public.historico_alteracoes h where h.entidade='compromissos' and h.registro_id=a.compromisso_id and h.acao='COMPARTILHAR_COMPROMISSO' and h.detalhes->>'membro'=a.membro::text),a.created_at)) and a.autorizado_por=a.user_id) then 'aceite comprovado'
 else 'desativado: sem aceite comprovado' end from public.v4_compromisso_acessos a on conflict do nothing;
-- A autorização prévia do titular é mantida NO PEDIDO; não é grant de leitura.
update public.v4_delegacoes d set autorizar_acesso=true,autorizado_por=c.user_id
 from public.compromissos c where c.id=d.compromisso_id and d.estado='pendente' and d.user_id=c.user_id
 and exists(select 1 from public.v42_auditoria_acessos a where a.compromisso_id=c.id and a.membro=d.destinatario and a.antes->>'autorizado_por'=c.user_id::text);
update public.v4_compromisso_acessos a set ativo=false,revogado_em=now()
 from public.v42_auditoria_acessos x where x.acesso_id=a.id and x.resultado='desativado: sem aceite comprovado' and a.ativo and a.delegacao_id is null;
update public.compromissos c set versao=c.versao+1,atualizado_por=c.user_id,
 responsavel=case when c.responsavel is not null and c.responsavel<>c.user_id and not public.v4_pode_acessar_compromisso(c.id,c.responsavel) and c.status not in ('concluido','cancelado') then null else c.responsavel end,responsabilidade_definida=true
 where exists(select 1 from public.v42_auditoria_acessos a where a.compromisso_id=c.id and a.resultado='desativado: sem aceite comprovado' and a.registrado_em=transaction_timestamp());

-- Invalida formulários de pastas cujo acesso antes era somente implícito.
update public.compromissos c set versao=c.versao+1,atualizado_por=c.user_id,
 responsavel=case when c.responsavel is not null and c.responsavel<>c.user_id and not public.v4_pode_acessar_compromisso(c.id,c.responsavel) and c.status not in ('concluido','cancelado') then null else c.responsavel end,
 responsabilidade_definida=true
 where exists(select 1 from public.v42_acessos_implicitos x where x.pasta_id=coalesce(c.pasta_id,public.v4_pasta_processo(c.processo_id)) and x.registrado_em=transaction_timestamp());

-- Sem recibos individuais de leitura; avisos anteriores permanecem.
drop trigger if exists leitura_v4 on public.v4_notificacoes;

create or replace function public.v4_delegar_com_acesso(p_id uuid,p_compromisso uuid,p_destinatario uuid,p_autorizar_compromisso boolean default false) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare tarefa public.compromissos; envio public.v4_delegacoes; novo_acesso boolean; begin
 perform public.v42_travar();
 if auth.uid() is null or p_destinatario is null or p_destinatario=auth.uid() or not public.v4_par_ativo(auth.uid(),p_destinatario) then raise exception 'Selecione uma colaboração ativa';end if;
 select * into tarefa from public.compromissos where id=p_compromisso for update;
 if tarefa.id is null or not public.v4_acesso_compromisso(tarefa.id) then raise exception 'Compromisso não acessível';end if;
 select * into envio from public.v4_delegacoes where id=p_id;
 if envio.id is not null then
 if (envio.user_id,envio.compromisso_id,envio.destinatario) is distinct from (auth.uid(),p_compromisso,p_destinatario) then raise exception 'Identificador de envio já utilizado';end if;return envio.id;end if;
 if tarefa.status in ('concluido','cancelado') then raise exception 'Compromisso encerrado. Reabra antes de transferir.';end if;
 if coalesce(case when tarefa.responsabilidade_definida then tarefa.responsavel else tarefa.user_id end,auth.uid())<>auth.uid() then raise exception 'Somente o responsável atual pode transferir a execução.';end if;
 select * into envio from public.v4_delegacoes where compromisso_id=p_compromisso and estado='pendente';
 if envio.id is not null then
 if envio.destinatario=p_destinatario and envio.user_id=auth.uid() then return envio.id;end if;
 raise exception 'Já existe uma transferência aguardando aceite para este compromisso.';end if;
 novo_acesso:=not public.v4_pode_acessar_compromisso(tarefa.id,p_destinatario);
 if novo_acesso and tarefa.user_id<>auth.uid() then raise exception 'Somente o titular pode autorizar um novo acesso. O responsável só encaminha para quem já vê a tarefa.';end if;
 if novo_acesso and not p_autorizar_compromisso then raise exception 'Esta tarefa ainda é privada. Autorize o acesso somente após o aceite.';end if;
 insert into public.v4_delegacoes(id,user_id,compromisso_id,destinatario,autorizar_acesso,autorizado_por)
 values(p_id,auth.uid(),tarefa.id,p_destinatario,novo_acesso and p_autorizar_compromisso,case when novo_acesso then auth.uid() end);
 return p_id;
end $$;

create or replace function public.v4_responder_delegacao(p_id uuid,p_aceitar boolean) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare envio public.v4_delegacoes; tarefa public.compromissos; begin
 perform public.v42_travar();
 select * into envio from public.v4_delegacoes where id=p_id;
 if envio.id is null or envio.destinatario is distinct from auth.uid() then raise exception 'Transferência não acessível';end if;
 select * into tarefa from public.compromissos where id=envio.compromisso_id for update;
 select * into envio from public.v4_delegacoes where id=p_id for update;
 if envio.estado=(case when p_aceitar then 'aceita' else 'recusada' end) then return;end if;
 if envio.estado<>'pendente' then raise exception 'Pedido encerrado; não pode ser reativado';end if;
 if not public.v4_par_ativo(envio.user_id,envio.destinatario) then raise exception 'Colaboração não está ativa';end if;
 if p_aceitar then
 if tarefa.status in ('concluido','cancelado') then raise exception 'Compromisso encerrado';end if;
 if coalesce(case when tarefa.responsabilidade_definida then tarefa.responsavel else tarefa.user_id end,envio.user_id)<>envio.user_id or not public.v4_pode_acessar_compromisso(tarefa.id,envio.user_id) then raise exception 'Pedido perdeu validade; responsável ou acesso mudou';end if;
 if not public.v4_pode_acessar_compromisso(tarefa.id,auth.uid()) then
 if not envio.autorizar_acesso or envio.autorizado_por is distinct from tarefa.user_id or envio.user_id<>tarefa.user_id or not public.v4_par_ativo(tarefa.user_id,auth.uid()) then raise exception 'Somente o titular autoriza o acesso individual';end if;
 insert into public.v4_compromisso_acessos(user_id,compromisso_id,membro,autorizado_por,delegacao_id)
 values(tarefa.user_id,tarefa.id,auth.uid(),tarefa.user_id,envio.id)
 on conflict(compromisso_id,membro) do update set ativo=true,revogado_em=null,autorizado_por=excluded.autorizado_por,delegacao_id=excluded.delegacao_id,created_at=now();
 end if;
 update public.compromissos set responsavel=auth.uid(),responsabilidade_definida=true,atualizado_por=auth.uid(),versao=versao+1 where id=tarefa.id;
 end if;
 update public.v4_delegacoes set estado=case when p_aceitar then 'aceita' else 'recusada' end,updated_at=now() where id=envio.id;
 -- Recusa de pedido privado não exige nem cria autorização para escrever na timeline.
 insert into public.compromisso_atividades(user_id,compromisso_id,texto,ator)
 values(tarefa.user_id,tarefa.id,case when p_aceitar then 'Transferência aceita' else 'Transferência recusada' end,auth.uid());
end $$;

create or replace function public.v4_revogar_acesso_compromisso(p_compromisso uuid,p_membro uuid) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare tarefa public.compromissos; mudou boolean; begin
 perform public.v42_travar();select * into tarefa from public.compromissos where id=p_compromisso for update;
 if tarefa.id is null or tarefa.user_id is distinct from auth.uid() then raise exception 'Somente o titular revoga o acesso individual';end if;
 mudou:=exists(select 1 from public.v4_compromisso_acessos where compromisso_id=tarefa.id and membro=p_membro and ativo) or exists(select 1 from public.v4_delegacoes where compromisso_id=tarefa.id and p_membro in(user_id,destinatario) and estado='pendente');
 update public.v4_compromisso_acessos set ativo=false,revogado_em=now() where compromisso_id=tarefa.id and membro=p_membro and ativo;
 update public.v4_delegacoes set estado='revogada',updated_at=now() where compromisso_id=tarefa.id and p_membro in(user_id,destinatario) and estado='pendente';
 if mudou then update public.compromissos set versao=versao+1,atualizado_por=auth.uid(),
 responsavel=case when responsavel=p_membro and status not in ('concluido','cancelado') and not public.v4_pode_acessar_compromisso(id,p_membro) then null else responsavel end,
 responsabilidade_definida=true where id=tarefa.id;end if;
end $$;

-- Somente o titular compartilha cada ID explicitamente escolhido.
create or replace function public.v4_compartilhar(p_pasta uuid,p_membro uuid,p_ativo boolean default true) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare f public.v4_pastas; era boolean; begin
 perform public.v42_travar();select * into f from public.v4_pastas where id=p_pasta for update;
 if f.id is null or f.user_id is distinct from auth.uid() then raise exception 'Somente o titular compartilha a pasta';end if;
 if not public.v4_par_ativo(f.user_id,p_membro) then raise exception 'Colaboração precisa estar aceita';end if;
 select ativo into era from public.v4_membros where pasta_id=f.id and membro=p_membro;
 if coalesce(era,false)=p_ativo then return;end if;
 insert into public.v4_membros(user_id,pasta_id,membro,ativo) values(f.user_id,f.id,p_membro,p_ativo) on conflict(pasta_id,membro) do update set ativo=excluded.ativo;
 if not p_ativo then
 if f.processo_id is not null then insert into public.v4_exclusoes(user_id,processo_id) values(f.user_id,f.processo_id) on conflict do nothing;end if;
 -- Grants individuais aceitos são independentes da pasta. Cancelam-se os pedidos pertinentes.
 update public.v4_delegacoes d set estado='revogada',updated_at=now() where d.estado='pendente' and p_membro in(d.user_id,d.destinatario) and exists(select 1 from public.compromissos c where c.id=d.compromisso_id and coalesce(c.pasta_id,public.v4_pasta_processo(c.processo_id))=f.id);
 update public.compromissos c set versao=c.versao+1,atualizado_por=auth.uid(),responsabilidade_definida=true,
 responsavel=case when c.responsavel=p_membro and c.status not in ('concluido','cancelado') and not public.v4_pode_acessar_compromisso(c.id,p_membro) then null else c.responsavel end
 where coalesce(c.pasta_id,public.v4_pasta_processo(c.processo_id))=f.id;
 end if;
 insert into public.historico_alteracoes(user_id,entidade,registro_id,acao,ator,detalhes) values(f.user_id,'v4_pastas',f.id,case when p_ativo then 'COMPARTILHAR' else 'REVOGAR_PASTA' end,auth.uid(),jsonb_build_object('membro',p_membro,'explicito',true));
end $$;
create or replace function public.v42_compartilhar_selecao(p_pastas uuid[],p_membro uuid) returns integer language plpgsql security definer set search_path=pg_catalog,public as $$
declare f uuid; begin
 perform public.v42_travar();
 if coalesce(cardinality(p_pastas),0) not between 1 and 100 then raise exception 'Selecione de 1 a 100 pastas';end if;
 if exists(select 1 from unnest(p_pastas) x where not exists(select 1 from public.v4_pastas where id=x and user_id=auth.uid())) then raise exception 'Seleção contém pasta não pertencente ao titular';end if;
 for f in select distinct unnest(p_pastas) loop perform public.v4_compartilhar(f,p_membro,true);end loop;
 return cardinality(p_pastas);
end $$;
create or replace function public.v42_sugestoes_cnj() returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
 select coalesce(jsonb_agg(jsonb_build_object('pasta_id',f.id,'cnj',p.numero_cnj,'colega_id',u.id,'colega',coalesce(pr.nome,'Colaborador'),'existe',true,'compartilhada',exists(select 1 from public.v4_membros m where m.pasta_id=f.id and m.membro=u.id and m.ativo)) order by p.numero_cnj,u.id),'[]')
 from public.v4_pastas f join public.processos p on p.id=f.processo_id
 join public.v4_colaboracoes c on f.user_id in(c.user_id,c.convidado) and c.estado='ativa'
 cross join lateral (select case when c.user_id=f.user_id then c.convidado else c.user_id end id) u
 left join public.profiles pr on pr.user_id=u.id
 where f.user_id=auth.uid() and exists(select 1 from public.processos q where q.user_id=u.id and q.numero_cnj=p.numero_cnj)
$$;

-- Vínculos operacionais explícitos. Nunca regravam a publicação, decisão ou compromisso.
create table if not exists public.v42_conferencias (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),
 publicacao_id uuid not null references public.publicacoes(id),origem_id uuid not null references public.publicacoes(id),
 estado text not null check(estado in('confirmado','distinto','revogado')),compromisso_id uuid references public.compromissos(id),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),check(publicacao_id<>origem_id),unique(user_id,publicacao_id,origem_id)
);
create unique index if not exists v42_uma_origem on public.v42_conferencias(publicacao_id) where estado='confirmado';
alter table public.v42_conferencias enable row level security;
revoke all on public.v42_conferencias from public,anon,authenticated;
grant select on public.v42_conferencias to authenticated;
drop policy if exists leitura on public.v42_conferencias;
create policy leitura on public.v42_conferencias for select to authenticated using(public.v4_acesso_publicacao(publicacao_id) and public.v4_acesso_publicacao(origem_id));
create or replace function public.v42_conferir(p_id uuid,p_origem uuid,p_acao text,p_compromisso uuid default null,p_confirmar boolean default false) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare p public.publicacoes; q public.publicacoes; r uuid; begin
 perform public.v42_travar();
 if p_id=p_origem or not public.v4_acesso_publicacao(p_id) or not public.v4_acesso_publicacao(p_origem) then raise exception 'As duas publicações precisam estar acessíveis à sua conta';end if;
 perform 1 from public.publicacoes where id in(p_id,p_origem) order by id for update;
 if not public.v4_acesso_publicacao(p_id) or not public.v4_acesso_publicacao(p_origem) then raise exception 'Acesso revogado';end if;
 if p_acao not in ('confirmado','distinto','revogado') then raise exception 'Ação inválida';end if;
 if p_acao='confirmado' then
 if not p_confirmar then raise exception 'Confirme o mesmo ato e a mesma obrigação';end if;
 select * into q from public.publicacoes where id=p_origem;
 if q.triagem_status<>'classificada' and public.v4_decisao_visivel(q.id) is null then raise exception 'Analise a publicação de origem antes de reutilizar a análise';end if;
 if p_compromisso is not null and not exists(select 1 from public.compromissos where id=p_compromisso and publicacao_id=p_origem and public.v4_acesso_compromisso(id)) then raise exception 'Selecione compromisso legível da análise de origem';end if;
 if (q.exige_providencia is true or exists(select 1 from public.v4_decisoes where id=public.v4_decisao_visivel(q.id) and compromisso_id is not null)) and p_compromisso is null then raise exception 'Selecione a obrigação existente';end if;
 if exists(select 1 from public.v42_conferencias where publicacao_id=p_id and estado='confirmado' and origem_id<>p_origem) then raise exception 'Desfaça o vínculo atual antes de escolher outra origem';end if;
 end if;
 -- Desfazer é compartilhado e auditado; manter distintos é uma preferência de quem conferiu.
 if p_acao='revogado' then
 update public.v42_conferencias set estado='revogado',updated_at=now() where publicacao_id=p_id and origem_id=p_origem and estado='confirmado' returning id into r;
 else
 if p_acao='confirmado' then select id into r from public.v42_conferencias where publicacao_id=p_id and origem_id=p_origem and estado='confirmado';if r is not null then return r;end if;end if;
 insert into public.v42_conferencias(user_id,publicacao_id,origem_id,estado,compromisso_id) values(auth.uid(),p_id,p_origem,p_acao,case when p_acao='confirmado' then p_compromisso end)
 on conflict(user_id,publicacao_id,origem_id) do update set estado=excluded.estado,compromisso_id=excluded.compromisso_id,updated_at=now() returning id into r;
 end if;
 if p_acao='confirmado' then
 -- A confirmação humana passa a orientar a fila desta cópia, inclusive após revisão individual.
 delete from public.v4_revisoes where user_id=auth.uid() and publicacao_id=p_id and modo='individual';
 end if;
 if r is not null then
 select * into p from public.publicacoes where id=p_id;
 insert into public.historico_alteracoes(user_id,entidade,registro_id,acao,ator,detalhes) values(p.user_id,'publicacoes',p.id,'CONFERENCIA_'||upper(p_acao),auth.uid(),jsonb_build_object('origem',p_origem,'vinculo',r,'compromisso',p_compromisso));end if;
 return r;
end $$;
create or replace function public.v4_unificar_ato(p_id uuid,p_origem uuid,p_compromisso uuid default null,p_confirmar boolean default false) returns uuid language sql security invoker set search_path=pg_catalog,public as $$ select public.v42_conferir(p_id,p_origem,'confirmado',p_compromisso,p_confirmar) $$;

-- Hash/ID oficial não propagam decisões entre cópias. Revisão individual tem precedência.
create or replace function public.v4_decisao_visivel(p_id uuid) returns uuid language sql stable security definer set search_path=pg_catalog,public as $$
 select d.id from public.v4_decisoes d where public.v4_acesso_publicacao(p_id) and d.publicacao_id=p_id and d.ativa and d.decisao<>'reabrir'
 and (not d.individual or d.user_id=auth.uid())
 and (not exists(select 1 from public.v4_revisoes r where r.user_id=auth.uid() and r.publicacao_id=p_id and r.modo='individual') or (d.individual and d.user_id=auth.uid())) order by d.created_at desc,d.id limit 1
$$;
create or replace function public.v4_salvar_compromisso(p_id uuid,p_pasta uuid,p_dados jsonb,p_versao integer default null) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare f public.v4_pastas; c public.compromissos; titular uuid; resp uuid; pid uuid; pubid uuid; begin
 perform public.v42_travar();
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

create or replace function public.v4_atividade(p_id uuid,p_compromisso uuid,p_texto text,p_estado text default null,p_proximo text default null,p_revisao date default null) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.compromissos; a public.compromisso_atividades; novo text; begin
 perform public.v42_travar();
 if not public.v4_acesso_compromisso(p_compromisso) then raise exception 'Compromisso não acessível'; end if;
 select * into c from public.compromissos where id=p_compromisso for update;
 if not public.v4_acesso_compromisso(p_compromisso) then raise exception 'Compromisso não acessível';end if;
 select * into a from public.compromisso_atividades where id=p_id;
 if a.id is not null then
 if a.compromisso_id<>p_compromisso or a.texto<>p_texto or coalesce(a.ator,a.user_id)<>auth.uid() then raise exception 'ID de atividade já utilizado'; end if;return a.id; end if;
 if nullif(trim(p_texto),'') is null then raise exception 'Informe o andamento'; end if;
 novo:=coalesce(nullif(p_estado,''),c.status);
 if novo not in ('pendente','em_andamento','aguardando_terceiro','concluido','cancelado') then raise exception 'Estado inválido'; end if;
 insert into public.compromisso_atividades(id,user_id,compromisso_id,texto,estado_anterior,estado_novo,proximo_passo,ator) values(p_id,c.user_id,c.id,p_texto,c.status,novo,p_proximo,auth.uid());
 update public.compromissos set status=novo,data_revisao=coalesce(p_revisao,data_revisao),payload=case when p_proximo is null then payload else payload||jsonb_build_object('proximo_passo',p_proximo) end,
 concluido_em=case when novo='concluido' then coalesce(concluido_em,now()) end,concluido_por=case when novo='concluido' then coalesce(concluido_por,auth.uid()) end,
 atualizado_por=auth.uid(),updated_at=now(),versao=versao+1 where id=c.id;
 return p_id;
end $$;

create or replace function public.v4_assumir(p_id uuid) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.compromissos; begin
 perform public.v42_travar();
 if not public.v4_acesso_compromisso(p_id) then raise exception 'Compromisso não acessível'; end if;
 select * into c from public.compromissos where id=p_id for update;
 if not public.v4_acesso_compromisso(p_id) then raise exception 'Compromisso não acessível';end if;
 if coalesce(case when c.responsabilidade_definida then c.responsavel else c.user_id end,auth.uid())<>auth.uid() then raise exception 'Já existe responsável. Use transferência com aceite'; end if;
 if c.status in ('concluido','cancelado') then raise exception 'Compromisso encerrado'; end if;
 update public.compromissos set responsavel=auth.uid(),responsabilidade_definida=true,atualizado_por=auth.uid(),versao=versao+1 where id=p_id;
 perform public.v4_atividade(gen_random_uuid(),p_id,'Responsabilidade assumida',null,null,null);
end $$;

create or replace function public.v4_salvar_pasta(p_id uuid,p_titulo text,p_cnj text default null,p_payload jsonb default '{}',p_restrita boolean default false) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare f public.v4_pastas; pid uuid; n text:=public.cnj_normalizado(p_cnj); begin
 perform public.v42_travar();
 if auth.uid() is null then raise exception 'Login necessário'; end if;
 select * into f from public.v4_pastas where id=p_id for update;
 if f.id is not null and f.user_id<>auth.uid() then raise exception 'Somente o titular edita o cadastro da pasta'; end if;
 if nullif(trim(p_titulo),'') is null and coalesce(n,'')='' then raise exception 'Informe o título do assunto'; end if;
 if coalesce(n,'')<>'' then
 if not public.cnj_valido(n) then raise exception 'CNJ inválido'; end if;
 if f.processo_id is not null then update public.processos set numero_cnj=n,payload=p_payload where id=f.processo_id and user_id=auth.uid();pid:=f.processo_id;
 else
 select id into pid from public.processos where user_id=auth.uid() and numero_cnj=n;
 if pid is not null and exists(select 1 from public.v4_pastas where processo_id=pid and id<>p_id) then
 if f.id is not null then raise exception 'CNJ já possui outra pasta; não mesclar assuntos automaticamente'; end if;
 return public.v4_pasta_processo(pid);
 end if;
 end if;
 elsif f.processo_id is not null then raise exception 'Não remova o CNJ de pasta judicial existente'; end if;
 if f.id is null then insert into public.v4_pastas(id,user_id,titulo,payload,restrita) values(p_id,auth.uid(),coalesce(nullif(trim(p_titulo),''),n),p_payload,p_restrita); end if;
 if coalesce(n,'')<>'' and pid is null then
 insert into public.processos(numero_cnj,payload) values(n,p_payload) returning id into pid;
 -- Remove apenas o adaptador recém-criado pelo trigger, vazio e ainda não referenciado.
 delete from public.v4_pastas where processo_id=pid and id<>p_id;
 end if;
 update public.v4_pastas set titulo=coalesce(nullif(trim(p_titulo),''),n),processo_id=pid,payload=p_payload,restrita=p_restrita where id=p_id;
 insert into public.historico_alteracoes(user_id,entidade,registro_id,acao,ator,detalhes) values(auth.uid(),'v4_pastas',p_id,'SALVAR_PASTA',auth.uid(),jsonb_build_object('cnj',n,'restrita',p_restrita));
 return p_id;
end $$;

create or replace function public.v4_salvar_audiencia(p_id uuid,p_pasta uuid,p_dados jsonb) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare f public.v4_pastas; a public.audiencias; pid uuid; begin
 perform public.v42_travar();
 if not public.v4_acesso_pasta(p_pasta) then raise exception 'Pasta não acessível';end if;
 select * into f from public.v4_pastas where id=p_pasta;
 if f.processo_id is null then raise exception 'Audiência judicial exige processo vinculado. Use compromisso para reunião administrativa';end if;
 select * into a from public.audiencias where id=p_id for update;
 if a.id is not null and (a.user_id<>f.user_id or a.processo_id<>f.processo_id) then raise exception 'Audiência de outra pasta';end if;
 pid:=nullif(p_dados->>'publicacao_id','')::uuid;
 if pid is not null and not exists(select 1 from public.publicacoes where id=pid and user_id=f.user_id and processo_id=f.processo_id) then raise exception 'Publicação incompatível';end if;
 insert into public.audiencias(id,user_id,processo_id,publicacao_id,data,hora,status,payload)
 values(p_id,f.user_id,f.processo_id,pid,(p_dados->>'data')::date,(p_dados->>'hora')::time,p_dados->>'status',coalesce(p_dados->'payload','{}'))
 on conflict(id) do update set data=excluded.data,hora=excluded.hora,status=excluded.status,payload=excluded.payload;
 return p_id;
end $$;

create or replace function public.v4_responder_convite(p_id uuid,p_acao text) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.v4_colaboracoes; afetadas uuid[]; begin
 perform public.v42_travar();
 select * into c from public.v4_colaboracoes where id=p_id for update;
 if auth.uid() is null or (auth.uid()<>c.user_id and auth.uid()<>c.convidado) or c.id is null then raise exception 'Convite não acessível'; end if;
 if p_acao in ('aceitar','recusar') then
 if c.convidado=auth.uid() and c.estado=(case when p_acao='aceitar' then 'ativa' else 'recusada' end) then return;end if;
 if c.convidado<>auth.uid() or c.estado<>'pendente' then raise exception 'Somente o destinatário responde convite pendente'; end if;
 update public.v4_colaboracoes set estado=case p_acao when 'aceitar' then 'ativa' else 'recusada' end,updated_at=now() where id=p_id;
 elsif p_acao='revogar' then
 if c.estado='revogada' then return;end if;
 select array_agg(t.id) into afetadas from public.compromissos t where
 (t.user_id=c.user_id and public.v4_pode_acessar_compromisso(t.id,c.convidado)) or
 (t.user_id=c.convidado and public.v4_pode_acessar_compromisso(t.id,c.user_id)) or
 exists(select 1 from public.v4_delegacoes d where d.compromisso_id=t.id and d.estado='pendente' and ((d.user_id=c.user_id and d.destinatario=c.convidado) or (d.user_id=c.convidado and d.destinatario=c.user_id)));
 update public.v4_colaboracoes set estado='revogada',updated_at=now() where id=p_id;
 -- Novo convite não reativa compartilhamentos manuais antigos.
 update public.v4_membros set ativo=false where (user_id=c.user_id and membro=c.convidado) or (user_id=c.convidado and membro=c.user_id);
 update public.compromissos t set responsavel=case when ((t.user_id=c.user_id and t.responsavel=c.convidado) or (t.user_id=c.convidado and t.responsavel=c.user_id)) and status not in ('concluido','cancelado') then null else responsavel end,responsabilidade_definida=true,atualizado_por=auth.uid(),versao=versao+1
 where t.id=any(afetadas);

 update public.v4_delegacoes d set estado='revogada',updated_at=now() where estado='pendente' and (
 ((d.user_id=c.user_id and d.destinatario=c.convidado) or (d.user_id=c.convidado and d.destinatario=c.user_id)) or
 (d.compromisso_id=any(afetadas) and (not public.v4_pode_acessar_compromisso(d.compromisso_id,d.user_id) or
 (not public.v4_pode_acessar_compromisso(d.compromisso_id,d.destinatario) and not (d.autorizar_acesso and d.autorizado_por=(select user_id from public.compromissos where id=d.compromisso_id) and public.v4_par_ativo(d.autorizado_por,d.destinatario))))));
 else raise exception 'Ação inválida'; end if;
end $$;


create or replace function public.v42_atividade(p_id uuid,p_compromisso uuid,p_texto text,p_versao integer,p_estado text default null,p_proximo text default null,p_revisao date default null) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.compromissos; begin
 perform public.v42_travar();select * into c from public.compromissos where id=p_compromisso for update;
 if not public.v4_acesso_compromisso(p_compromisso) then raise exception 'Compromisso não acessível';end if;
 if not exists(select 1 from public.compromisso_atividades where id=p_id and compromisso_id=p_compromisso and coalesce(ator,user_id)=auth.uid() and texto=p_texto) and c.versao is distinct from p_versao then raise exception 'Compromisso atualizado por outra pessoa. Recarregue antes de editar';end if;
 return public.v4_atividade(p_id,p_compromisso,p_texto,p_estado,p_proximo,p_revisao);
end $$;

create or replace function public.v4_analisar(p_id uuid,p_decisao text,p_request uuid,p_descricao text default null,p_tarefa jsonb default null,p_individual boolean default false,p_categoria text default null,p_observacoes text default null) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare p public.publicacoes; k text; existente uuid; taskid uuid; pasta uuid; cdata jsonb; d public.v4_decisoes; begin
 perform public.v42_travar();
 if not public.v4_acesso_publicacao(p_id) then raise exception 'Publicação não acessível'; end if;
 if p_decisao not in ('nada_a_fazer','ja_fiz','vou_fazer','encaminhar','revisar_depois','nao_me_compete') then raise exception 'Decisão inválida'; end if;
 if p_decisao='revisar_depois' then
 insert into public.historico_alteracoes(user_id,entidade,registro_id,acao,ator,detalhes) select user_id,'publicacoes',id,'REVISAR_DEPOIS',auth.uid(),jsonb_build_object('alcance','individual') from public.publicacoes where id=p_id;
 return jsonb_build_object('pendente',true); end if;
 if p_decisao='nao_me_compete' then
 insert into public.historico_alteracoes(user_id,entidade,registro_id,acao,ator,detalhes) select user_id,'publicacoes',id,'NAO_ME_COMPETE',auth.uid(),jsonb_build_object('alcance','individual') from public.publicacoes where id=p_id;
 insert into public.v4_revisoes(user_id,publicacao_id,modo) values(auth.uid(),p_id,'nao_me_compete') on conflict(user_id,publicacao_id) do update set modo=excluded.modo,created_at=now();return jsonb_build_object('individual',true);end if;
 k:=public.v4_chave_ato(p_id);
 perform pg_advisory_xact_lock(hashtext(k||case when p_individual then auth.uid()::text||p_id::text else '' end));
 select * into p from public.publicacoes where id=p_id for update;
 if not public.v4_acesso_publicacao(p_id) then raise exception 'Publicação não acessível';end if;
 select * into d from public.v4_decisoes where id=p_request;
 if d.id is not null then
 if d.user_id<>auth.uid() or d.publicacao_id<>p_id or d.decisao<>p_decisao then raise exception 'ID da decisão já utilizado'; end if;
 return jsonb_build_object('decisao_id',d.id,'compromisso_id',d.compromisso_id,'existente',true); end if;
 if not p_individual then
 existente:=public.v4_decisao_visivel(p_id);
 if existente is not null then select * into d from public.v4_decisoes where id=existente;return jsonb_build_object('decisao_id',d.id,'compromisso_id',d.compromisso_id,'existente',true);end if;
 if p.triagem_status='classificada' and not exists(select 1 from public.v4_decisoes reab where reab.decisao='reabrir' and not reab.individual and reab.publicacao_id=p.id and reab.created_at>coalesce(p.analisado_em,'epoch'::timestamptz)) then
 raise exception 'Ato já analisado na V3. Confira o histórico e reabra ou revise individualmente'; end if;
 end if;
 pasta:=public.v4_pasta_processo(p.processo_id);
 if p_decisao in ('vou_fazer','encaminhar') then
 select id into taskid from public.compromissos where publicacao_id=p.id and user_id=p.user_id and processo_id=p.processo_id and status<>'cancelado' order by created_at limit 1;
 if taskid is null then
 if p_tarefa is null or pasta is null then raise exception 'Providência exige compromisso com pasta'; end if;
 taskid:=(p_tarefa->>'id')::uuid;cdata:=p_tarefa||jsonb_build_object('publicacao_id',p.id,'responsavel',auth.uid());
 perform public.v4_salvar_compromisso(taskid,pasta,cdata,null);end if;
 if p_decisao='encaminhar' then perform public.v4_delegar(gen_random_uuid(),taskid,(p_tarefa->>'destinatario')::uuid); end if;
 end if;
 insert into public.v4_decisoes(id,user_id,pasta_id,publicacao_id,chave_ato,decisao,descricao,compromisso_id,individual)
 values(p_request,auth.uid(),pasta,p_id,k,p_decisao,p_descricao,taskid,p_individual);
 if p_individual then insert into public.v4_revisoes(user_id,publicacao_id,modo) values(auth.uid(),p_id,'individual') on conflict(user_id,publicacao_id) do update set modo=excluded.modo,created_at=now();end if;
 if p.user_id=auth.uid() then
 update public.publicacoes set triagem_status='classificada',exige_providencia=p_decisao in ('vou_fazer','encaminhar'),classificacao=coalesce(p_categoria,case p_decisao when 'nada_a_fazer' then 'Nada a fazer' when 'ja_fiz' then 'Já fiz' else 'Providência administrativa' end),observacoes=coalesce(p_observacoes,observacoes),
 providencia=p_descricao,analisado_por=auth.uid(),analisado_em=now() where id=p.id;end if;
 return jsonb_build_object('decisao_id',p_request,'compromisso_id',taskid,'existente',false);
end $$;

create or replace function public.v4_reabrir(p_id uuid,p_individual boolean default false) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare d uuid; k text; begin
 perform public.v42_travar();
 if not public.v4_acesso_publicacao(p_id) then raise exception 'Publicação não acessível'; end if;
 k:=public.v4_chave_ato(p_id);perform pg_advisory_xact_lock(hashtext(k));
 if not p_individual then d:=public.v4_decisao_visivel(p_id);update public.v4_decisoes set ativa=false,revertida_por=auth.uid(),revertida_em=now() where id=d;end if;
 if p_individual then insert into public.v4_revisoes(user_id,publicacao_id,modo) values(auth.uid(),p_id,'individual') on conflict(user_id,publicacao_id) do update set modo='individual',created_at=now();else delete from public.v4_revisoes where user_id=auth.uid() and publicacao_id=p_id;end if;
 if not p_individual then update public.publicacoes set triagem_status='pendente_de_analise',analisado_por=auth.uid(),analisado_em=now() where id=p_id and user_id=auth.uid();end if;
 insert into public.v4_decisoes(id,user_id,pasta_id,publicacao_id,chave_ato,decisao,ativa,individual) select gen_random_uuid(),auth.uid(),public.v4_pasta_processo(processo_id),id,k,'reabrir',false,p_individual from public.publicacoes where id=p_id;
end $$;


create or replace function public.v4_analisar_com_encaminhamento(p_id uuid,p_request uuid,p_destinatario uuid,p_descricao text default null,p_tarefa jsonb default null,p_individual boolean default false,p_categoria text default null,p_observacoes text default null,p_autorizar_compromisso boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare resultado jsonb; tarefa uuid; envio public.v4_delegacoes; begin
 perform public.v42_travar();
 if not public.v4_acesso_publicacao(p_id) then raise exception 'Publicação não acessível';end if;
 select * into envio from public.v4_delegacoes where id=p_request;
 if envio.id is not null then
 if envio.user_id<>auth.uid() or envio.destinatario<>p_destinatario or not exists(select 1 from public.compromissos where id=envio.compromisso_id and publicacao_id=p_id) then raise exception 'Identificador de encaminhamento já utilizado';end if;
 return jsonb_build_object('compromisso_id',envio.compromisso_id,'delegacao_id',envio.id,'existente',true);end if;
 select id into tarefa from public.compromissos where publicacao_id=p_id and status<>'cancelado' and public.v4_acesso_compromisso(id) order by created_at,id limit 1;
 if tarefa is not null and (exists(select 1 from public.publicacoes where id=p_id and triagem_status='classificada') or public.v4_decisao_visivel(p_id) is not null) then
 -- Já analisada: delegar a obrigação existente sem reclassificar nem descartar o destinatário.
 perform public.v4_delegar_com_acesso(p_request,tarefa,p_destinatario,p_autorizar_compromisso);
 return jsonb_build_object('compromisso_id',tarefa,'delegacao_id',p_request,'existente',true);end if;
 resultado:=public.v4_analisar(p_id,'vou_fazer',p_request,p_descricao,p_tarefa,p_individual,p_categoria,p_observacoes);
 tarefa:=(resultado->>'compromisso_id')::uuid;
 if tarefa is null then raise exception 'A análise existente não tem compromisso. Crie uma obrigação antes de encaminhar.';end if;
 perform public.v4_delegar_com_acesso(p_request,tarefa,p_destinatario,p_autorizar_compromisso);
 update public.v4_decisoes set decisao='encaminhar' where id=p_request and user_id=auth.uid();
 return resultado||jsonb_build_object('delegacao_id',p_request);
end $$;

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
 if tg_op='UPDATE' and old.ativo then perform public.v4_n_criar(new.membro,'acesso_revogado',coalesce(auth.uid(),new.user_id),'v4_pastas',new.pasta_id,'pasta-revogada:'||new.id||':'||transaction_timestamp());end if;
 end if;
 elsif tg_table_name='v4_compromisso_acessos' then
 insert into public.historico_alteracoes(user_id,entidade,registro_id,acao,ator,detalhes) values(new.user_id,'compromissos',new.compromisso_id,case when new.ativo then 'COMPARTILHAR_COMPROMISSO' else 'REVOGAR_COMPROMISSO' end,coalesce(auth.uid(),new.autorizado_por),jsonb_build_object('membro',new.membro,'alcance','somente_compromisso'));
 if tg_op='UPDATE' and old.ativo and not new.ativo then perform public.v4_n_criar(new.membro,'acesso_revogado',coalesce(auth.uid(),new.autorizado_por),'compromissos',new.compromisso_id,'tarefa-revogada:'||new.id||':'||new.revogado_em);end if;
 end if;return new;
end $$;

create or replace function public.v4_n_item(p public.v4_notificacoes) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare titulo text; detalhe text; nome text; estado text; destino text; registro uuid; acessivel boolean:=false; responder boolean:=false; minimo boolean:=false; datas jsonb;
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
 if envio.id is not null then
 select * into tarefa from public.compromissos where id=envio.compromisso_id;
 acessivel:=public.v4_acesso_compromisso(tarefa.id);estado:=envio.estado;
 minimo:=envio.estado='pendente' and envio.destinatario=auth.uid() and tarefa.status not in ('concluido','cancelado') and public.v4_par_ativo(envio.user_id,envio.destinatario) and public.v4_pode_acessar_compromisso(tarefa.id,envio.user_id)
 and coalesce(case when tarefa.responsabilidade_definida then tarefa.responsavel else tarefa.user_id end,envio.user_id)=envio.user_id;
 if minimo or acessivel then titulo:=tarefa.descricao;end if;
 if minimo then datas:=jsonb_strip_nulls(jsonb_build_object('fatal',tarefa.data_fatal_confirmada,'interna',tarefa.data_interna,'revisao',tarefa.data_revisao));end if;
 if acessivel then destino:='compromisso';registro:=tarefa.id;end if;
 responder:=minimo and p.tipo='delegacao';
 if envio.estado='pendente' and tarefa.status in ('concluido','cancelado') then estado:='compromisso_encerrado';end if;
 end if;
 elsif p.entidade='compromissos' then
 acessivel:=public.v4_acesso_compromisso(p.registro_id);
 if acessivel then select * into tarefa from public.compromissos where id=p.registro_id;titulo:=tarefa.descricao;estado:=tarefa.status;destino:='compromisso';registro:=tarefa.id;end if;
 elsif p.entidade='publicacoes' then
 acessivel:=public.v4_acesso_publicacao(p.registro_id);
 if acessivel then
 select * into publicacao from public.publicacoes where id=p.registro_id;
 select * into decisao from public.v4_decisoes where id=p.evento_id and publicacao_id=publicacao.id and (not individual or user_id=auth.uid());
 titulo:='Publicação · '||coalesce(publicacao.numero_recebido,'sem CNJ');detalhe:=coalesce(decisao.decisao,publicacao.classificacao);destino:='publicacao';registro:=publicacao.id;estado:=publicacao.triagem_status;
 end if;
 elsif p.entidade='v4_pastas' then
 acessivel:=public.v4_acesso_pasta(p.registro_id);
 if acessivel then select * into pasta from public.v4_pastas where id=p.registro_id;titulo:=pasta.titulo;destino:='pasta';registro:=coalesce(pasta.processo_id,pasta.id);end if;
 end if;
 return jsonb_build_object('id',p.id,'tipo',p.tipo,'ator',coalesce(nome,'Colaborador'),'created_at',p.created_at,'lida_em',p.lida_em,
 'titulo',case when acessivel or minimo then titulo else 'Acesso indisponível ou revogado' end,'detalhe',case when acessivel then detalhe end,
 'datas',datas,'pedido_restrito',minimo and not acessivel,'estado',estado,'acessivel',acessivel,'destino',case when acessivel then destino end,'registro_id',case when acessivel then registro end,
 'responder',responder,'solicitacao_id',case when responder then p.registro_id end);
end $$;

create or replace function public.v4_contexto() returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare nomes jsonb; pubs jsonb; destinos jsonb; begin
 if auth.uid() is null then raise exception 'Login necessário'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'nome',coalesce(p.nome,'Colaborador'))),'[]') into nomes from auth.users u left join public.profiles p on p.user_id=u.id
 where u.id=auth.uid() or exists(select 1 from public.v4_colaboracoes c where (c.user_id=auth.uid() and c.convidado=u.id) or (c.convidado=auth.uid() and c.user_id=u.id))
 or exists(select 1 from public.compromissos t where public.v4_acesso_compromisso(t.id) and u.id in (t.user_id,t.criado_por,t.responsavel,t.atualizado_por,t.concluido_por));
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'chave',public.v4_chave_ato(p.id),'decisao_id',public.v4_decisao_visivel(p.id),
 'legado_id',v.origem_id,'vinculo_id',v.id,'compromisso_vinculado',case when public.v4_acesso_compromisso(v.compromisso_id) then v.compromisso_id end,
 'reaberto',exists(select 1 from public.v4_decisoes d where d.publicacao_id=p.id and d.decisao='reabrir' and not d.individual and d.created_at>coalesce(p.analisado_em,'epoch'::timestamptz)),
 'individual',exists(select 1 from public.v4_revisoes r where r.user_id=auth.uid() and r.publicacao_id=p.id and r.modo='individual'),
 'nao_me_compete',exists(select 1 from public.v4_revisoes r where r.user_id=auth.uid() and r.publicacao_id=p.id and r.modo='nao_me_compete'),
 'candidatos',coalesce((select jsonb_agg(q.id order by q.data_disponibilizacao,q.id) from public.publicacoes q
 join public.processos qp on qp.id=q.processo_id join public.processos pp on pp.id=p.processo_id
 where q.id<>p.id and qp.numero_cnj=pp.numero_cnj and abs(q.data_disponibilizacao-p.data_disponibilizacao)<=3
 and public.v4_acesso_publicacao(q.id) and not exists(select 1 from public.v42_conferencias x where x.user_id=auth.uid() and x.estado='distinto' and ((x.publicacao_id=p.id and x.origem_id=q.id) or (x.publicacao_id=q.id and x.origem_id=p.id)))),'[]'),
 'conflito',exists(select 1 from public.publicacoes q join public.processos qp on qp.id=q.processo_id join public.processos pp on pp.id=p.processo_id where q.id<>p.id and qp.numero_cnj=pp.numero_cnj and abs(q.data_disponibilizacao-p.data_disponibilizacao)<=3 and public.v4_acesso_publicacao(q.id) and p.triagem_status='classificada' and q.triagem_status='classificada' and (p.classificacao,p.providencia,p.exige_providencia) is distinct from (q.classificacao,q.providencia,q.exige_providencia)),
 'duas_tarefas',v.id is not null and exists(select 1 from public.compromissos where publicacao_id=p.id) and exists(select 1 from public.compromissos where publicacao_id=v.origem_id)
 )),'[]') into pubs from public.publicacoes p
 left join lateral(select x.* from public.v42_conferencias x where x.publicacao_id=p.id and x.estado='confirmado' and public.v4_acesso_publicacao(x.origem_id) and (exists(select 1 from public.publicacoes q where q.id=x.origem_id and q.triagem_status='classificada') or public.v4_decisao_visivel(x.origem_id) is not null) and not exists(select 1 from public.v4_revisoes r where r.user_id=auth.uid() and r.publicacao_id=p.id and r.modo='individual') limit 1) v on true
 where public.v4_acesso_publicacao(p.id);
 select coalesce(jsonb_agg(jsonb_build_object('publicacao_id',po.publicacao_id,'numero',o.numero_oab,'uf',o.uf,'titular',po.user_id)),'[]') into destinos from public.publicacao_oabs po join public.oabs_monitoradas o on o.id=po.oab_id where public.v4_acesso_publicacao(po.publicacao_id);
 return jsonb_build_object('nomes',nomes,'publicacoes',pubs,'destinatarios',destinos,'sugestoes_cnj',public.v42_sugestoes_cnj());
end $$;


revoke all on function public.v42_travar() from public,anon,authenticated;
revoke all on function public.v42_atividade(uuid,uuid,text,integer,text,text,date),public.v42_compartilhar_selecao(uuid[],uuid),public.v42_sugestoes_cnj(),public.v42_conferir(uuid,uuid,text,uuid,boolean) from public,anon,authenticated;
grant execute on function public.v42_atividade(uuid,uuid,text,integer,text,text,date),public.v42_compartilhar_selecao(uuid[],uuid),public.v42_sugestoes_cnj(),public.v42_conferir(uuid,uuid,text,uuid,boolean) to authenticated;

create or replace function public.v4_listar_notificacoes(p_limite integer default 30,p_antes uuid default null,p_nao_lidas boolean default false) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare itens jsonb; ancora public.v4_notificacoes; quantidade integer; limite integer:=greatest(1,least(coalesce(p_limite,30),100)); ultimo uuid; begin
 if auth.uid() is null then raise exception 'Login necessário';end if;
 if p_antes is not null then
 select * into ancora from public.v4_notificacoes where id=p_antes and user_id=auth.uid();if ancora.id is null then raise exception 'Página de notificações não acessível';end if;end if;
 select count(*) into quantidade from public.v4_notificacoes where user_id=auth.uid() and lida_em is null;
 select coalesce(jsonb_agg(public.v4_n_item(n) order by n.created_at desc,n.id desc),'[]') into itens from (
 select * from public.v4_notificacoes n where n.user_id=auth.uid() and (not p_nao_lidas or n.lida_em is null) and (p_antes is null or (n.created_at,n.id)<(ancora.created_at,ancora.id)) order by n.created_at desc,n.id desc limit limite+1) n;
 return jsonb_build_object('ultimo_evento',(select jsonb_build_object('id',n.id,'tipo',n.tipo) from public.v4_notificacoes n where n.user_id=auth.uid() order by n.created_at desc,n.id desc limit 1),'itens',case when jsonb_array_length(itens)>limite then itens-limite else itens end,'nao_lidas',quantidade,'tem_mais',jsonb_array_length(itens)>limite);
end $$;
-- Leitura atual para abrir a conferência: não reutiliza texto de uma sessão cujo acesso mudou.
create or replace function public.v42_ler_comparacao(p_id uuid,p_origem uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare pubs jsonb; tarefas jsonb; begin
 if p_id=p_origem or not public.v4_acesso_publicacao(p_id) or not public.v4_acesso_publicacao(p_origem) then raise exception 'As duas publicações precisam estar acessíveis à sua conta';end if;
 select jsonb_agg(jsonb_build_object('id',p.id,'user_id',p.user_id,'processo_id',p.processo_id,'data_disponibilizacao',p.data_disponibilizacao,'classificacao',p.classificacao,'providencia',p.providencia,'texto_integral',p.texto_integral)) into pubs from public.publicacoes p where p.id in(p_id,p_origem);
 select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'publicacao_id',t.publicacao_id,'descricao',t.descricao,'status',t.status)),'[]') into tarefas from public.compromissos t where t.publicacao_id in(p_id,p_origem) and public.v4_acesso_compromisso(t.id);
 return jsonb_build_object('publicacoes',pubs,'compromissos',tarefas);
end $$;
revoke all on function public.v42_ler_comparacao(uuid,uuid) from public,anon,authenticated;
grant execute on function public.v42_ler_comparacao(uuid,uuid) to authenticated;
commit;
