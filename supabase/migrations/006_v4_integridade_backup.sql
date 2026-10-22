-- Complemento V4: backup compatível, autoria e barreiras para clientes antigos/diretos.
begin;
-- Uma cópia privada da rotina V3 permite manter o formato e seu controle de titularidade.
do $$ declare def text; begin
 if to_regprocedure('public.v4_restaurar_base(jsonb)') is null then
 select pg_get_functiondef('public.restaurar_backup(jsonb)'::regprocedure) into def;
 def:=replace(def,'public.restaurar_backup(','public.v4_restaurar_base(');execute def;
 end if;
end $$;
revoke all on function public.v4_restaurar_base(jsonb) from public,anon,authenticated;
create or replace function public.restaurar_backup(p_backup jsonb) returns integer language plpgsql security definer set search_path=pg_catalog,public as $$
declare b jsonb:=p_backup; r jsonb; f public.v4_pastas; n integer; a integer; begin
 if auth.uid() is null or p_backup->>'format' is distinct from 'lex-online' or (p_backup->>'user_id')::uuid is distinct from auth.uid() then raise exception 'Backup deve pertencer à conta autenticada';end if;
 -- Primeiro restaura o formato V3, sem links para pastas ainda ausentes.
 b:=jsonb_set(b,'{data,compromissos}',coalesce((select jsonb_agg(x||jsonb_build_object('pasta_id',null,'responsabilidade_definida',coalesce((x->>'responsabilidade_definida')::boolean,false),'versao',coalesce((x->>'versao')::integer,0))) from jsonb_array_elements(coalesce(b->'data'->'compromissos','[]')) x),'[]'));
 n:=public.v4_restaurar_base(b);
 for r in select value from jsonb_array_elements(coalesce(p_backup->'data'->'v4_pastas','[]')) loop
 if (r->>'user_id')::uuid is distinct from auth.uid() then raise exception 'Pasta de outro titular no backup';end if;
 -- Só remove adaptador vazio gerado durante esta restauração; nunca uma pasta de trabalho usada.
 if not exists(select 1 from public.v4_pastas where id=(r->>'id')::uuid) and nullif(r->>'processo_id','') is not null then
 delete from public.v4_pastas adapt where adapt.processo_id=(r->>'processo_id')::uuid and adapt.user_id=auth.uid()
 and not exists(select 1 from public.compromissos c where c.pasta_id=adapt.id)
 and not exists(select 1 from public.v4_membros m where m.pasta_id=adapt.id)
 and not exists(select 1 from public.v4_decisoes d where d.pasta_id=adapt.id);
 end if;
 insert into public.v4_pastas(id,user_id,processo_id,titulo,restrita,payload,created_at)
 values((r->>'id')::uuid,auth.uid(),nullif(r->>'processo_id','')::uuid,r->>'titulo',coalesce((r->>'restrita')::boolean,false),coalesce(r->'payload','{}'),(r->>'created_at')::timestamptz) on conflict(id) do nothing;
 get diagnostics a=row_count;n:=n+a;
 end loop;
 for r in select value from jsonb_array_elements(coalesce(p_backup->'data'->'compromissos','[]')) loop
 if nullif(r->>'pasta_id','') is not null then
 select * into f from public.v4_pastas where id=(r->>'pasta_id')::uuid and user_id=auth.uid();
 if f.id is null then raise exception 'Pasta ausente ou pertencente a outra conta';end if;
 update public.compromissos set pasta_id=f.id where id=(r->>'id')::uuid and user_id=auth.uid() and pasta_id is null;
 end if;
 end loop;
 -- Decisões próprias só para fontes próprias; não importa permissões nem decisões de terceiros.
 for r in select value from jsonb_array_elements(coalesce(p_backup->'data'->'v4_decisoes','[]')) loop
 if (r->>'user_id')::uuid is distinct from auth.uid() or not exists(select 1 from public.publicacoes where id=(r->>'publicacao_id')::uuid and user_id=auth.uid()) then raise exception 'Decisão de outro acervo no backup';end if;
 insert into public.v4_decisoes select x.* from jsonb_populate_record(null::public.v4_decisoes,r) x on conflict(id) do nothing;get diagnostics a=row_count;n:=n+a;
 end loop;
 for r in select value from jsonb_array_elements(coalesce(p_backup->'data'->'v4_revisoes','[]')) loop
 if (r->>'user_id')::uuid is distinct from auth.uid() or not public.v4_acesso_publicacao((r->>'publicacao_id')::uuid) then raise exception 'Revisão não acessível';end if;
 insert into public.v4_revisoes select x.* from jsonb_populate_record(null::public.v4_revisoes,r) x on conflict do nothing;
 end loop;
 for r in select value from jsonb_array_elements(coalesce(p_backup->'data'->'v4_exclusoes','[]')) loop
 if (r->>'user_id')::uuid is distinct from auth.uid() then raise exception 'Exclusão de outra conta';end if;
 insert into public.v4_exclusoes select x.* from jsonb_populate_record(null::public.v4_exclusoes,r) x on conflict do nothing;end loop;
 return n;
end $$;
revoke all on function public.restaurar_backup(jsonb) from public,anon;
grant execute on function public.restaurar_backup(jsonb) to authenticated;

create or replace function public.v4_proteger_tarefa() returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
 if new.pasta_id is not null and not exists(select 1 from public.v4_pastas f where f.id=new.pasta_id and f.user_id=new.user_id and (f.processo_id is not distinct from new.processo_id or (tg_op='UPDATE' and old.processo_id is null and new.processo_id is null))) then raise exception 'Pasta e titular incompatíveis'; end if;
 if tg_op='UPDATE' and new.criado_por is distinct from old.criado_por then raise exception 'Criador imutável';end if;
 if tg_op='UPDATE' then new.versao:=old.versao+1;end if;
 -- RPC SECURITY DEFINER já validou membros/aceite; cliente direto não pode inventar autoria ou responsável.
 if current_user in ('authenticated','anon') then
 if tg_op='INSERT' then new.criado_por:=auth.uid();
 if new.responsavel is not null and new.responsavel<>auth.uid() then raise exception 'Atribuição exige aceite';end if;
 elsif new.responsavel is distinct from old.responsavel and new.responsavel is not null and (new.responsavel<>auth.uid() or coalesce(old.responsavel,old.user_id)<>auth.uid()) then raise exception 'Use a transferência com aceite';end if;
 new.atualizado_por:=auth.uid();
 else
 if tg_op='INSERT' then new.criado_por:=coalesce(new.criado_por,auth.uid(),new.user_id);end if;
 end if;
 return new;
end $$;
-- Clientes V3 continuam podendo registrar atividades próprias, agora com ator confiável.
create or replace function public.v4_autor_atividade() returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
 if current_user in ('authenticated','anon') then new.ator:=auth.uid();else new.ator:=coalesce(new.ator,auth.uid(),new.user_id);end if;return new;
end $$;
drop trigger if exists v4_ator on public.compromisso_atividades;
create trigger v4_ator before insert on public.compromisso_atividades for each row execute function public.v4_autor_atividade();
revoke all on function public.v4_autor_atividade(),public.v4_proteger_tarefa() from public,anon,authenticated;
create or replace function public.v4_salvar_audiencia(p_id uuid,p_pasta uuid,p_dados jsonb) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare f public.v4_pastas; a public.audiencias; pid uuid; begin
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
revoke all on function public.v4_salvar_audiencia(uuid,uuid,jsonb) from public,anon;
grant execute on function public.v4_salvar_audiencia(uuid,uuid,jsonb) to authenticated;
create or replace function public.v4_pausar_sync(p_id uuid) returns void language sql security invoker set search_path=pg_catalog,public as $$
 update public.sincronizacoes set estado='parcial',erro='Pausada pelo usuário após lote confirmado',finished_at=now() where id=p_id and user_id=auth.uid() and estado='em_andamento'
$$;
revoke all on function public.v4_pausar_sync(uuid) from public,anon;
grant execute on function public.v4_pausar_sync(uuid) to authenticated;
-- Chamadas V3 passam pela mesma serialização e resolução operacional V4, preservando a assinatura.
create or replace function public.classificar_publicacao_v3(p_id uuid,p_categoria text,p_exige boolean,p_providencia text,p_obs text,p_compromissos jsonb default '[]',p_reabrir boolean default false,p_motivo text default null)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare r jsonb; c jsonb; f uuid; begin
 if not exists(select 1 from public.publicacoes where id=p_id and user_id=auth.uid()) then raise exception 'Publicação não acessível';end if;
 if p_reabrir then perform public.v4_reabrir(p_id,false);return jsonb_build_object('id',p_id,'reaberta',true);end if;
 if nullif(trim(p_categoria),'') is null or p_exige is null then raise exception 'Informe categoria e decisão explícita';end if;
 if p_categoria='Outro' and nullif(trim(p_providencia),'') is null then raise exception 'Descreva a classificação Outro';end if;
 if jsonb_typeof(p_compromissos)<>'array' or jsonb_array_length(p_compromissos)>20 or (not p_exige and jsonb_array_length(p_compromissos)>0) then raise exception 'Lista de compromissos inválida';end if;
 r:=public.v4_analisar(p_id,case when p_exige then 'vou_fazer' else 'nada_a_fazer' end,gen_random_uuid(),p_providencia,p_compromissos->0,false,p_categoria,p_obs);
 -- Cliente legado suporta múltiplas providências explícitas. Nenhuma é recriada no retry.
 if p_exige and not coalesce((r->>'existente')::boolean,false) then
 for c in select value from jsonb_array_elements(p_compromissos) with ordinality x(value,n) where n>1 loop
 select id into f from public.v4_pastas where processo_id=(c->>'processo_id')::uuid;
 if not exists(select 1 from public.compromissos where id=(c->>'id')::uuid and user_id=auth.uid() and publicacao_id=p_id) then perform public.v4_salvar_compromisso((c->>'id')::uuid,f,c||jsonb_build_object('publicacao_id',p_id,'responsavel',auth.uid()),null);end if;
 end loop;end if;
 return r||jsonb_build_object('id',p_id);
end $$;
-- Unificação HUMANA do acompanhamento. Não altera nenhuma classificação nem cancela tarefas antigas.
create or replace function public.v4_unificar_ato(p_id uuid,p_origem uuid,p_compromisso uuid default null,p_confirmar boolean default false)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare p public.publicacoes; k text; rid uuid:=gen_random_uuid(); begin
 if not p_confirmar or not public.v4_acesso_publicacao(p_id) or not public.v4_acesso_publicacao(p_origem) then raise exception 'Confirme o ato comum e a autorização';end if;
 k:=public.v4_chave_ato(p_id);
 if k not like 'oficial:%' or public.v4_chave_ato(p_origem)<>k then raise exception 'Correspondência não confirmada. Mantenha análises independentes';end if;
 perform pg_advisory_xact_lock(hashtext(k));
 select * into p from public.publicacoes where id=p_origem for update;
 if p.triagem_status<>'classificada' then raise exception 'Selecione análise já classificada';end if;
 if p.exige_providencia is true then
 if not exists(select 1 from public.compromissos where id=p_compromisso and publicacao_id=p.id and status<>'cancelado' and public.v4_acesso_compromisso(id)) then raise exception 'Selecione a obrigação já existente na análise de origem';end if;
 elsif p_compromisso is not null then raise exception 'Análise sem providência pendente não seleciona obrigação';end if;
 update public.v4_decisoes set ativa=false,revertida_por=auth.uid(),revertida_em=now() where chave_ato=k and ativa and not individual and public.v4_acesso_publicacao(publicacao_id);
 insert into public.v4_decisoes(id,user_id,pasta_id,publicacao_id,chave_ato,decisao,descricao,compromisso_id)
 values(rid,auth.uid(),public.v4_pasta_processo(p.processo_id),p.id,k,case when p.exige_providencia then 'vou_fazer' when p.classificacao='Já fiz' then 'ja_fiz' else 'nada_a_fazer' end,'Unificação humana do acompanhamento: '||coalesce(p.providencia,p.classificacao),p_compromisso);
 return rid;
end $$;
revoke all on function public.v4_unificar_ato(uuid,uuid,uuid,boolean) from public,anon;
grant execute on function public.v4_unificar_ato(uuid,uuid,uuid,boolean) to authenticated;
create or replace function public.v4_remover_pasta(p_id uuid) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare f public.v4_pastas; begin
 select * into f from public.v4_pastas where id=p_id for update;
 if auth.uid() is null or f.id is null or f.user_id<>auth.uid() then raise exception 'Pasta não acessível';end if;
 if exists(select 1 from public.v4_membros where pasta_id=p_id) or exists(select 1 from public.compromissos where pasta_id=p_id or processo_id=f.processo_id) or exists(select 1 from public.publicacoes where processo_id=f.processo_id) or exists(select 1 from public.audiencias where processo_id=f.processo_id) then raise exception 'Pasta com registros ou compartilhamento. Encerre a pasta para preservar o histórico';end if;
 delete from public.v4_pastas where id=p_id;
 if f.processo_id is not null then delete from public.processos where id=f.processo_id and user_id=auth.uid();end if;
end $$;
revoke all on function public.v4_remover_pasta(uuid) from public,anon;
grant execute on function public.v4_remover_pasta(uuid) to authenticated;
commit;
