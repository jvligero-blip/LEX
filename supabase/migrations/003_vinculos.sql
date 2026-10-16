begin;
-- Correção de CNJ preserva acompanhamentos derivados que ainda seguem o vínculo original.
create or replace function public.vincular_publicacao(p_id uuid,p_numero text) returns uuid language plpgsql security invoker set search_path=public as $$
declare anterior uuid; novo uuid; begin
 select processo_id into anterior from publicacoes where id=p_id and user_id=auth.uid() for update;
 if not found then raise exception 'Publicação não acessível'; end if;
 novo:=ensure_processo(p_numero);
 update publicacoes set processo_id=novo where id=p_id and user_id=auth.uid();
 update compromissos set processo_id=novo,updated_at=now() where user_id=auth.uid() and publicacao_id=p_id and (processo_id is null or processo_id is not distinct from anterior);
 update audiencias set processo_id=novo,updated_at=now() where user_id=auth.uid() and publicacao_id=p_id and processo_id is not distinct from anterior;
 return novo;
end $$;
revoke all on function public.vincular_publicacao(uuid,text) from public,anon;
grant execute on function public.vincular_publicacao(uuid,text) to authenticated;
commit;
