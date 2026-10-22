-- LEX V4.1: extensão da base V3. Não executar reset, seeds ou 001-004 novamente.
begin;
create table if not exists public.v4_colaboracoes (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
 convidado uuid not null references auth.users(id), estado text not null default 'pendente' check(estado in ('pendente','ativa','recusada','revogada')),
 automatico boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check(user_id<>convidado)
);
create unique index if not exists v4_colaboracao_par on public.v4_colaboracoes(least(user_id,convidado),greatest(user_id,convidado));
create table if not exists public.v4_pastas (
 id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id), processo_id uuid unique,
 titulo text not null check(length(trim(titulo))>0), restrita boolean not null default false, payload jsonb not null default '{}', created_at timestamptz not null default now(),
 unique(user_id,id), foreign key(user_id,processo_id) references public.processos(user_id,id)
);
create table if not exists public.v4_membros (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id), pasta_id uuid not null,
 membro uuid not null references auth.users(id), ativo boolean not null default true, created_at timestamptz not null default now(),
 unique(pasta_id,membro), foreign key(user_id,pasta_id) references public.v4_pastas(user_id,id), check(user_id<>membro)
);
create table if not exists public.v4_exclusoes (
 id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id), processo_id uuid not null,
 unique(user_id,processo_id), foreign key(user_id,processo_id) references public.processos(user_id,id)
);
alter table public.compromissos add column if not exists pasta_id uuid references public.v4_pastas(id);
alter table public.compromissos add column if not exists criado_por uuid references auth.users(id);
alter table public.compromissos add column if not exists responsavel uuid references auth.users(id);
alter table public.compromissos add column if not exists responsabilidade_definida boolean not null default false;
alter table public.compromissos add column if not exists atualizado_por uuid references auth.users(id);
alter table public.compromissos add column if not exists versao integer not null default 0;
alter table public.compromisso_atividades add column if not exists ator uuid references auth.users(id);
alter table public.historico_alteracoes add column if not exists ator uuid references auth.users(id);
create index if not exists v4_compromissos_pasta on public.compromissos(pasta_id);
create table if not exists public.v4_decisoes (
 id uuid primary key, user_id uuid not null references auth.users(id), pasta_id uuid references public.v4_pastas(id),
 publicacao_id uuid not null references public.publicacoes(id), chave_ato text not null,
 decisao text not null check(decisao in ('nada_a_fazer','ja_fiz','vou_fazer','encaminhar','reabrir')),
 descricao text, compromisso_id uuid references public.compromissos(id), individual boolean not null default false,
 ativa boolean not null default true, created_at timestamptz not null default now(), revertida_por uuid references auth.users(id), revertida_em timestamptz
);
create index if not exists v4_decisoes_historico_ato on public.v4_decisoes(chave_ato,created_at);
create index if not exists v4_decisoes_ato on public.v4_decisoes(chave_ato) where ativa;
create table if not exists public.v4_revisoes (
 id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id),
 publicacao_id uuid not null references public.publicacoes(id), modo text not null check(modo in ('individual','nao_me_compete')),
 created_at timestamptz not null default now(), unique(user_id,publicacao_id)
);
create table if not exists public.v4_delegacoes (
 id uuid primary key, user_id uuid not null references auth.users(id), compromisso_id uuid not null references public.compromissos(id),
 destinatario uuid not null references auth.users(id), estado text not null default 'pendente' check(estado in ('pendente','aceita','recusada','revogada')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists v4_transferencia_pendente on public.v4_delegacoes(compromisso_id) where estado='pendente';
-- Adaptadores novos; preserva todos os campos e IDs das entidades V3.
insert into public.v4_pastas(user_id,processo_id,titulo)
 select user_id,id,coalesce(nullif(payload->>'apelido',''),nullif(payload->>'cliente_nome',''),numero_cnj) from public.processos on conflict(processo_id) do nothing;
create or replace function public.v4_adaptar_processo() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 insert into public.v4_pastas(user_id,processo_id,titulo) values(new.user_id,new.id,coalesce(nullif(new.payload->>'apelido',''),nullif(new.payload->>'cliente_nome',''),new.numero_cnj)) on conflict(processo_id) do nothing;
 return new;
end $$;
drop trigger if exists v4_adaptador on public.processos;
create trigger v4_adaptador after insert on public.processos for each row execute function public.v4_adaptar_processo();
-- Helpers privilegiados evitam recursão RLS. Não aceitam usuário arbitrário nas consultas de acesso.
create or replace function public.v4_par_ativo(a uuid,b uuid) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select a is not null and b is not null and exists(select 1 from public.v4_colaboracoes c where c.estado='ativa' and ((c.user_id=a and c.convidado=b) or (c.user_id=b and c.convidado=a)))
$$;
create or replace function public.v4_pasta_processo(p uuid) returns uuid language sql stable security definer set search_path=pg_catalog,public as $$ select id from public.v4_pastas where processo_id=p $$;
create or replace function public.v4_acesso_usuario(p uuid,u uuid) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select u is not null and exists(select 1 from public.v4_pastas f where f.id=p and (f.user_id=u or
 (public.v4_par_ativo(f.user_id,u) and (
 exists(select 1 from public.v4_membros m where m.pasta_id=f.id and m.membro=u and m.ativo) or
 (not f.restrita and exists(
 select 1 from public.v4_colaboracoes c join public.processos alvo on alvo.id=f.processo_id
 join public.processos meu on meu.numero_cnj=alvo.numero_cnj and meu.user_id=u join public.v4_pastas mf on mf.processo_id=meu.id
 where c.estado='ativa' and c.automatico and ((c.user_id=f.user_id and c.convidado=u) or (c.convidado=f.user_id and c.user_id=u))
 and not mf.restrita and not exists(select 1 from public.v4_exclusoes x where x.processo_id in (alvo.id,meu.id))
 and nullif(lower(trim(coalesce(alvo.payload->>'cliente_nome',alvo.payload->>'parte',''))),'') is not null
 and lower(trim(coalesce(alvo.payload->>'cliente_nome',alvo.payload->>'parte','')))=lower(trim(coalesce(meu.payload->>'cliente_nome',meu.payload->>'parte','')))
 and coalesce(alvo.payload->>'lado','')=coalesce(meu.payload->>'lado','')
 and coalesce(alvo.payload->>'restrito','false')<>'true' and coalesce(meu.payload->>'restrito','false')<>'true'
 and not exists(select 1 from public.publicacoes x join public.publicacoes y on x.id_externo=y.id_externo and x.id_externo is not null and x.fonte=y.fonte and x.data_disponibilizacao=y.data_disponibilizacao where x.processo_id=alvo.id and y.processo_id=meu.id and x.triagem_status='classificada' and y.triagem_status='classificada' and (x.classificacao,x.providencia,x.exige_providencia) is distinct from (y.classificacao,y.providencia,y.exige_providencia))
 ))))))
$$;
create or replace function public.v4_acesso_pasta(p uuid) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$ select public.v4_acesso_usuario(p,auth.uid()) $$;
create or replace function public.v4_acesso_processo(p uuid) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$ select public.v4_acesso_pasta(public.v4_pasta_processo(p)) $$;
create or replace function public.v4_acesso_publicacao(p uuid) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select auth.uid() is not null and exists(select 1 from public.publicacoes where id=p and (user_id=auth.uid() or public.v4_acesso_processo(processo_id)))
$$;
create or replace function public.v4_acesso_compromisso(p uuid) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select auth.uid() is not null and exists(select 1 from public.compromissos where id=p and (user_id=auth.uid() or public.v4_acesso_pasta(coalesce(pasta_id,public.v4_pasta_processo(processo_id)))))
$$;
create or replace function public.v4_membro_pasta(p uuid,u uuid) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$ select public.v4_acesso_usuario(p,u) $$;
-- RLS: somente leitura compartilhada. Escritas de terceiros passam pelas RPCs transacionais.
do $$ declare t text; begin
 foreach t in array array['v4_colaboracoes','v4_pastas','v4_membros','v4_exclusoes','v4_decisoes','v4_revisoes','v4_delegacoes'] loop
 execute format('alter table public.%I enable row level security',t); execute format('revoke all on public.%I from anon,authenticated',t); execute format('grant select on public.%I to authenticated',t);
 end loop;
end $$;
drop policy if exists v4_partes on public.v4_colaboracoes;
create policy v4_partes on public.v4_colaboracoes for select to authenticated using(user_id=auth.uid() or convidado=auth.uid());
drop policy if exists v4_acesso on public.v4_pastas;
create policy v4_acesso on public.v4_pastas for select to authenticated using(public.v4_acesso_pasta(id));
drop policy if exists v4_acesso on public.v4_membros;
create policy v4_acesso on public.v4_membros for select to authenticated using(public.v4_acesso_pasta(pasta_id));
drop policy if exists v4_acesso on public.v4_exclusoes;
create policy v4_acesso on public.v4_exclusoes for select to authenticated using(user_id=auth.uid());
drop policy if exists v4_acesso on public.v4_decisoes;
create policy v4_acesso on public.v4_decisoes for select to authenticated using(public.v4_acesso_publicacao(publicacao_id) and (not individual or user_id=auth.uid()));
drop policy if exists v4_acesso on public.v4_revisoes;
create policy v4_acesso on public.v4_revisoes for select to authenticated using(user_id=auth.uid() and public.v4_acesso_publicacao(publicacao_id));
drop policy if exists v4_acesso on public.v4_delegacoes;
create policy v4_acesso on public.v4_delegacoes for select to authenticated using(public.v4_acesso_compromisso(compromisso_id));
drop policy if exists v4_leitura on public.processos;
create policy v4_leitura on public.processos for select to authenticated using(public.v4_acesso_processo(id));
drop policy if exists v4_leitura on public.publicacoes;
create policy v4_leitura on public.publicacoes for select to authenticated using(public.v4_acesso_publicacao(id));
drop policy if exists v4_leitura on public.compromissos;
create policy v4_leitura on public.compromissos for select to authenticated using(public.v4_acesso_compromisso(id));
drop policy if exists v4_leitura on public.compromisso_atividades;
create policy v4_leitura on public.compromisso_atividades for select to authenticated using(public.v4_acesso_compromisso(compromisso_id));
drop policy if exists v4_leitura on public.publicacao_oabs;
create policy v4_leitura on public.publicacao_oabs for select to authenticated using(public.v4_acesso_publicacao(publicacao_id));
drop policy if exists v4_leitura on public.audiencias;
create policy v4_leitura on public.audiencias for select to authenticated using(public.v4_acesso_processo(processo_id));
drop policy if exists v4_leitura on public.historico_alteracoes;
create policy v4_leitura on public.historico_alteracoes for select to authenticated using(
 (entidade='processos' and public.v4_acesso_processo(registro_id)) or (entidade='publicacoes' and public.v4_acesso_publicacao(registro_id)) or
 (entidade='compromissos' and public.v4_acesso_compromisso(registro_id)) or (entidade='v4_pastas' and public.v4_acesso_pasta(registro_id)));

create or replace function public.v4_convidar(p_email text,p_automatico boolean default false) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare alvo uuid; rid uuid; begin
 if auth.uid() is null then raise exception 'Login necessário'; end if;
 -- Falhas retornam NULL (sem exception), para COMMIT da cota e impedir tentativas ilimitadas por rollback.
 if not public.reservar_consulta() then return null;end if;
 if exists(select 1 from public.api_rate_limits where user_id=auth.uid() and chamadas>5) then return null;end if;
 -- Busca exata; não há endpoint de listagem de contas/e-mails.
 select id into alvo from auth.users where lower(email)=lower(trim(p_email));
 if alvo is null or alvo=auth.uid() then return null;end if;
 perform pg_advisory_xact_lock(hashtext(least(auth.uid(),alvo)::text||greatest(auth.uid(),alvo)::text));
 select id into rid from public.v4_colaboracoes where least(user_id,convidado)=least(auth.uid(),alvo) and greatest(user_id,convidado)=greatest(auth.uid(),alvo);
 if rid is not null and exists(select 1 from public.v4_colaboracoes where id=rid and estado in ('pendente','ativa')) then return rid; end if;
 if rid is null then insert into public.v4_colaboracoes(user_id,convidado,automatico) values(auth.uid(),alvo,p_automatico) returning id into rid;
 else update public.v4_colaboracoes set user_id=auth.uid(),convidado=alvo,estado='pendente',automatico=p_automatico,updated_at=now() where id=rid; end if;
 return rid;
end $$;
create or replace function public.v4_responder_convite(p_id uuid,p_acao text) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.v4_colaboracoes; begin
 select * into c from public.v4_colaboracoes where id=p_id for update;
 if auth.uid() is null or (auth.uid()<>c.user_id and auth.uid()<>c.convidado) or c.id is null then raise exception 'Convite não acessível'; end if;
 if p_acao in ('aceitar','recusar') then
 if c.convidado<>auth.uid() or c.estado<>'pendente' then raise exception 'Somente o destinatário responde convite pendente'; end if;
 update public.v4_colaboracoes set estado=case p_acao when 'aceitar' then 'ativa' else 'recusada' end,updated_at=now() where id=p_id;
 elsif p_acao='revogar' then
 update public.v4_colaboracoes set estado='revogada',updated_at=now() where id=p_id;
 -- Novo convite não reativa compartilhamentos manuais antigos.
 update public.v4_membros set ativo=false where (user_id=c.user_id and membro=c.convidado) or (user_id=c.convidado and membro=c.user_id);
 update public.compromissos t set responsavel=null,responsabilidade_definida=true,atualizado_por=auth.uid(),versao=versao+1
 where status not in ('concluido','cancelado') and ((t.user_id=c.user_id and t.responsavel=c.convidado) or (t.user_id=c.convidado and t.responsavel=c.user_id));
 update public.v4_delegacoes d set estado='revogada',updated_at=now() where estado='pendente' and ((d.user_id=c.user_id and d.destinatario=c.convidado) or (d.user_id=c.convidado and d.destinatario=c.user_id));
 else raise exception 'Ação inválida'; end if;
end $$;
create or replace function public.v4_salvar_pasta(p_id uuid,p_titulo text,p_cnj text default null,p_payload jsonb default '{}',p_restrita boolean default false) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare f public.v4_pastas; pid uuid; n text:=public.cnj_normalizado(p_cnj); begin
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
create or replace function public.v4_compartilhar(p_pasta uuid,p_membro uuid,p_ativo boolean default true) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare f public.v4_pastas; begin
 select * into f from public.v4_pastas where id=p_pasta for update;
 if auth.uid() is null or f.user_id<>auth.uid() or f.id is null then raise exception 'Somente o titular compartilha a pasta'; end if;
 if p_membro=f.user_id or not public.v4_par_ativo(f.user_id,p_membro) then raise exception 'Colaboração precisa estar aceita'; end if;
 insert into public.v4_membros(user_id,pasta_id,membro,ativo) values(f.user_id,f.id,p_membro,p_ativo) on conflict(pasta_id,membro) do update set ativo=excluded.ativo;
 if not p_ativo then
 if f.processo_id is not null then insert into public.v4_exclusoes(user_id,processo_id) values(f.user_id,f.processo_id) on conflict do nothing; end if;
 update public.compromissos set responsavel=null,responsabilidade_definida=true,atualizado_por=auth.uid(),versao=versao+1 where coalesce(pasta_id,public.v4_pasta_processo(processo_id))=f.id and responsavel=p_membro and status not in ('concluido','cancelado');
 end if;
 insert into public.historico_alteracoes(user_id,entidade,registro_id,acao,ator,detalhes) values(f.user_id,'v4_pastas',f.id,case when p_ativo then 'COMPARTILHAR' else 'REVOGAR_PASTA' end,auth.uid(),jsonb_build_object('membro',p_membro));
end $$;

create or replace function public.v4_salvar_compromisso(p_id uuid,p_pasta uuid,p_dados jsonb,p_versao integer default null) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare f public.v4_pastas; c public.compromissos; titular uuid; resp uuid; pid uuid; pubid uuid; begin
 if auth.uid() is null then raise exception 'Login necessário'; end if;
 select * into c from public.compromissos where id=p_id for update;
 if c.id is not null and not public.v4_acesso_compromisso(c.id) then raise exception 'Compromisso não acessível'; end if;
 if c.id is not null and p_versao is distinct from c.versao then raise exception 'Compromisso atualizado por outra pessoa. Recarregue antes de editar'; end if;
 if p_pasta is not null then
 select * into f from public.v4_pastas where id=p_pasta;
 if not public.v4_acesso_pasta(p_pasta) then raise exception 'Pasta não acessível'; end if;
 titular:=f.user_id;pid:=f.processo_id;
 else titular:=auth.uid(); end if;
 if c.id is not null and (titular<>c.user_id or coalesce(c.pasta_id,public.v4_pasta_processo(c.processo_id)) is distinct from p_pasta) then raise exception 'Não transfira o titular ou pasta de compromisso existente'; end if;
 resp:=nullif(p_dados->>'responsavel','')::uuid;
 if resp is not null and resp<>auth.uid() and (c.id is null or resp is distinct from c.responsavel) then raise exception 'Use Encaminhar e aguarde aceite para atribuir a outra pessoa'; end if;
 if resp is not null and not ((p_pasta is null and resp=auth.uid()) or public.v4_membro_pasta(p_pasta,resp)) then raise exception 'Responsável sem acesso à pasta'; end if;
 if nullif(trim(p_dados->>'descricao'),'') is null then raise exception 'Descreva o compromisso'; end if;
 pubid:=nullif(p_dados->>'publicacao_id','')::uuid;
 if pubid is not null and not exists(select 1 from public.publicacoes p where p.id=pubid and p.user_id=titular and p.processo_id=pid and public.v4_acesso_publicacao(p.id)) then raise exception 'Publicação e pasta incompatíveis'; end if;
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
 if not public.v4_acesso_compromisso(p_id) then raise exception 'Compromisso não acessível'; end if;
 select * into c from public.compromissos where id=p_id for update;
 if coalesce(case when c.responsabilidade_definida then c.responsavel else c.user_id end,auth.uid())<>auth.uid() then raise exception 'Já existe responsável. Use transferência com aceite'; end if;
 if c.status in ('concluido','cancelado') then raise exception 'Compromisso encerrado'; end if;
 update public.compromissos set responsavel=auth.uid(),responsabilidade_definida=true,atualizado_por=auth.uid(),versao=versao+1 where id=p_id;
 perform public.v4_atividade(gen_random_uuid(),p_id,'Responsabilidade assumida',null,null,null);
end $$;
create or replace function public.v4_delegar(p_id uuid,p_compromisso uuid,p_destinatario uuid) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.compromissos; pasta uuid; begin
 if not public.v4_acesso_compromisso(p_compromisso) then raise exception 'Compromisso não acessível'; end if;
 select * into c from public.compromissos where id=p_compromisso for update;
 pasta:=coalesce(c.pasta_id,public.v4_pasta_processo(c.processo_id));
 if p_destinatario=auth.uid() or not public.v4_membro_pasta(pasta,p_destinatario) or not public.v4_par_ativo(auth.uid(),p_destinatario) then raise exception 'Destinatário não autorizado'; end if;
 if coalesce(case when c.responsabilidade_definida then c.responsavel else c.user_id end,auth.uid())<>auth.uid() then raise exception 'Somente o responsável transfere a execução'; end if;
 insert into public.v4_delegacoes(id,user_id,compromisso_id,destinatario) values(p_id,auth.uid(),p_compromisso,p_destinatario) on conflict(id) do nothing;
 return p_id;
end $$;
create or replace function public.v4_responder_delegacao(p_id uuid,p_aceitar boolean) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare d public.v4_delegacoes; begin
 select * into d from public.v4_delegacoes where id=p_id for update;
 if d.id is null or d.destinatario<>auth.uid() or not public.v4_acesso_compromisso(d.compromisso_id) then raise exception 'Transferência não acessível'; end if;
 if d.estado<>'pendente' then return; end if;
 update public.v4_delegacoes set estado=case when p_aceitar then 'aceita' else 'recusada' end,updated_at=now() where id=p_id;
 if p_aceitar then update public.compromissos set responsavel=auth.uid(),responsabilidade_definida=true,atualizado_por=auth.uid(),versao=versao+1 where id=d.compromisso_id; end if;
 perform public.v4_atividade(gen_random_uuid(),d.compromisso_id,case when p_aceitar then 'Transferência aceita' else 'Transferência recusada' end,null,null,null);
end $$;

create index if not exists v4_publicacoes_candidatas on public.publicacoes(fonte,id_externo,data_disponibilizacao);
-- CNJ sozinho nunca representa um ato. Identificadores diferentes não são unidos por semelhança.
create or replace function public.v4_chave_ato(p_id uuid) returns text language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare p public.publicacoes; n text; begin
 if not public.v4_acesso_publicacao(p_id) then raise exception 'Publicação não acessível'; end if;
 select * into p from public.publicacoes where id=p_id;select numero_cnj into n from public.processos where id=p.processo_id;
 if p.fonte<>'DJEN' or p.id_externo is null or p.data_disponibilizacao is null or nullif(p.orgao,'') is null or n is null or length(trim(p.texto_integral))<30 then return 'local:'||p.id; end if;
 return 'oficial:'||encode(sha256(convert_to(jsonb_build_array(p.fonte,n,p.id_externo,p.tribunal,p.orgao,p.tipo,p.data_disponibilizacao,p.data_publicacao,regexp_replace(trim(p.texto_integral),'\s+',' ','g'))::text,'UTF8')),'hex');
end $$;
create or replace function public.v4_decisao_visivel(p_id uuid) returns uuid language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare k text; r uuid; begin
 if not public.v4_acesso_publicacao(p_id) then return null; end if;k:=public.v4_chave_ato(p_id);
 if exists(select 1 from public.v4_decisoes x join public.v4_decisoes y on x.chave_ato=y.chave_ato and x.id<>y.id where x.chave_ato=k and x.ativa and y.ativa and not x.individual and not y.individual and public.v4_acesso_publicacao(x.publicacao_id) and public.v4_acesso_publicacao(y.publicacao_id) and (x.decisao,x.compromisso_id) is distinct from (y.decisao,y.compromisso_id)) then return null;end if;
 select d.id into r from public.v4_decisoes d where d.ativa and d.decisao<>'reabrir' and d.chave_ato=k and public.v4_acesso_publicacao(d.publicacao_id)
 and (not d.individual or (d.user_id=auth.uid() and d.publicacao_id=p_id))
 and (not exists(select 1 from public.v4_revisoes where user_id=auth.uid() and publicacao_id=p_id and modo='individual') or (d.individual and d.user_id=auth.uid() and d.publicacao_id=p_id))
 order by d.created_at desc limit 1;return r;
end $$;
create or replace function public.v4_analisar(p_id uuid,p_decisao text,p_request uuid,p_descricao text default null,p_tarefa jsonb default null,p_individual boolean default false,p_categoria text default null,p_observacoes text default null) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare p public.publicacoes; k text; existente uuid; taskid uuid; pasta uuid; cdata jsonb; d public.v4_decisoes; begin
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
 if (p.triagem_status='classificada' or exists(select 1 from public.publicacoes outro where outro.id<>p.id and outro.fonte=p.fonte and outro.id_externo=p.id_externo and outro.data_disponibilizacao=p.data_disponibilizacao and outro.triagem_status='classificada' and public.v4_acesso_publicacao(outro.id) and public.v4_chave_ato(outro.id)=k)) and not exists(select 1 from public.v4_decisoes reab where reab.decisao='reabrir' and not reab.individual and reab.chave_ato=k and public.v4_acesso_publicacao(reab.publicacao_id) and reab.created_at>coalesce(p.analisado_em,'epoch'::timestamptz)) then
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
 if not public.v4_acesso_publicacao(p_id) then raise exception 'Publicação não acessível'; end if;
 k:=public.v4_chave_ato(p_id);perform pg_advisory_xact_lock(hashtext(k));
 if not p_individual then d:=public.v4_decisao_visivel(p_id);update public.v4_decisoes set ativa=false,revertida_por=auth.uid(),revertida_em=now() where id=d;end if;
 if p_individual then insert into public.v4_revisoes(user_id,publicacao_id,modo) values(auth.uid(),p_id,'individual') on conflict(user_id,publicacao_id) do update set modo='individual',created_at=now();else delete from public.v4_revisoes where user_id=auth.uid() and publicacao_id=p_id;end if;
 if not p_individual then update public.publicacoes set triagem_status='pendente_de_analise',analisado_por=auth.uid(),analisado_em=now() where id=p_id and user_id=auth.uid();end if;
 insert into public.v4_decisoes(id,user_id,pasta_id,publicacao_id,chave_ato,decisao,ativa,individual) select gen_random_uuid(),auth.uid(),public.v4_pasta_processo(processo_id),id,k,'reabrir',false,p_individual from public.publicacoes where id=p_id;
end $$;
-- Não abre profiles, Auth ou as configurações de OAB de colegas.
create or replace function public.v4_contexto() returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare nomes jsonb; pubs jsonb; destinos jsonb; begin
 if auth.uid() is null then raise exception 'Login necessário'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'nome',coalesce(p.nome,'Colaborador'))),'[]') into nomes from auth.users u left join public.profiles p on p.user_id=u.id
 where u.id=auth.uid() or exists(select 1 from public.v4_colaboracoes c where (c.user_id=auth.uid() and c.convidado=u.id) or (c.convidado=auth.uid() and c.user_id=u.id))
 or exists(select 1 from public.compromissos t where public.v4_acesso_compromisso(t.id) and u.id in (t.user_id,t.criado_por,t.responsavel,t.atualizado_por,t.concluido_por));
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'chave',public.v4_chave_ato(p.id),'decisao_id',public.v4_decisao_visivel(p.id),
 'legado_id',(select q.id from public.publicacoes q where q.id<>p.id and q.fonte=p.fonte and q.id_externo=p.id_externo and q.data_disponibilizacao=p.data_disponibilizacao and public.v4_acesso_publicacao(q.id) and public.v4_chave_ato(q.id)=public.v4_chave_ato(p.id) and q.triagem_status='classificada' order by q.analisado_em limit 1),
 'reaberto',exists(select 1 from public.v4_decisoes d where d.decisao='reabrir' and not d.individual and d.chave_ato=public.v4_chave_ato(p.id) and public.v4_acesso_publicacao(d.publicacao_id) and d.created_at>coalesce(p.analisado_em,'epoch'::timestamptz)),
 'individual',exists(select 1 from public.v4_revisoes r where r.user_id=auth.uid() and r.publicacao_id=p.id and r.modo='individual'),
 'nao_me_compete',exists(select 1 from public.v4_revisoes r where r.user_id=auth.uid() and r.publicacao_id=p.id and r.modo='nao_me_compete'),
 'conflito',exists(select 1 from public.publicacoes q where q.id<>p.id and q.fonte=p.fonte and q.id_externo=p.id_externo and q.data_disponibilizacao=p.data_disponibilizacao and public.v4_acesso_publicacao(q.id) and public.v4_chave_ato(q.id)=public.v4_chave_ato(p.id) and q.triagem_status='classificada' and p.triagem_status='classificada' and (q.classificacao,q.providencia,q.exige_providencia) is distinct from (p.classificacao,p.providencia,p.exige_providencia))
 )),'[]') into pubs from public.publicacoes p where public.v4_acesso_publicacao(p.id);
 select coalesce(jsonb_agg(jsonb_build_object('publicacao_id',po.publicacao_id,'numero',o.numero_oab,'uf',o.uf,'titular',po.user_id)),'[]') into destinos from public.publicacao_oabs po join public.oabs_monitoradas o on o.id=po.oab_id where public.v4_acesso_publicacao(po.publicacao_id);
 return jsonb_build_object('nomes',nomes,'publicacoes',pubs,'destinatarios',destinos);
end $$;
create or replace function public.auditar_lex() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare antes jsonb; depois jsonb; begin
 if tg_op<>'INSERT' then antes:=to_jsonb(old)-'last_seen_at'-'updated_at';end if;
 if tg_op<>'DELETE' then depois:=to_jsonb(new)-'last_seen_at'-'updated_at';end if;
 if tg_op='UPDATE' then if new.user_id<>old.user_id then raise exception 'Titular imutável';end if;if antes=depois then return new;end if;end if;
 insert into public.historico_alteracoes(user_id,entidade,registro_id,acao,detalhes,ator) values(coalesce(new.user_id,old.user_id),tg_table_name,coalesce(new.id,old.id),tg_op,jsonb_build_object('antes',antes,'depois',depois),auth.uid());
 return coalesce(new,old);
end $$;
create or replace function public.v4_proteger_tarefa() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if new.pasta_id is not null and not exists(select 1 from public.v4_pastas f where f.id=new.pasta_id and f.user_id=new.user_id and (f.processo_id is not distinct from new.processo_id or (tg_op='UPDATE' and old.processo_id is null and new.processo_id is null))) then raise exception 'Pasta e titular incompatíveis'; end if;
 if tg_op='UPDATE' and new.criado_por is distinct from old.criado_por then raise exception 'Criador imutável';end if;
 if tg_op='INSERT' then new.criado_por:=coalesce(auth.uid(),new.user_id);end if;
 new.atualizado_por:=coalesce(auth.uid(),new.user_id);return new;
end $$;
drop trigger if exists v4_integridade on public.compromissos;
create trigger v4_integridade before insert or update on public.compromissos for each row execute function public.v4_proteger_tarefa();
do $$ declare f record; begin
 for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'v4_%' loop execute format('revoke all on function %s from public,anon,authenticated',f.sig);end loop;
end $$;
grant execute on function public.v4_acesso_pasta(uuid),public.v4_acesso_processo(uuid),public.v4_acesso_publicacao(uuid),public.v4_acesso_compromisso(uuid),public.v4_contexto(),public.v4_convidar(text,boolean),public.v4_responder_convite(uuid,text),public.v4_salvar_pasta(uuid,text,text,jsonb,boolean),public.v4_compartilhar(uuid,uuid,boolean),public.v4_salvar_compromisso(uuid,uuid,jsonb,integer),public.v4_atividade(uuid,uuid,text,text,text,date),public.v4_assumir(uuid),public.v4_delegar(uuid,uuid,uuid),public.v4_responder_delegacao(uuid,boolean),public.v4_analisar(uuid,text,uuid,text,jsonb,boolean,text,text),public.v4_reabrir(uuid,boolean) to authenticated;
commit;
