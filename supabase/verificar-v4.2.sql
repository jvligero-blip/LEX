-- SOMENTE LEITURA. Executar no SQL Editor da homologação após 007 -> 008.
begin transaction read only;
select '008' as versao,to_regprocedure('public.v42_atividade(uuid,uuid,text,integer,text,text,date)') is not null as instalada;
-- Deve retornar zero linhas: acesso integral sem membro explícito.
select f.id pasta_id,f.user_id titular,c.id colaboracao
from public.v4_pastas f join public.v4_colaboracoes c on f.user_id in(c.user_id,c.convidado) and c.estado='ativa'
where public.v4_acesso_usuario(f.id,case when c.user_id=f.user_id then c.convidado else c.user_id end)
and not exists(select 1 from public.v4_membros m where m.pasta_id=f.id and m.ativo and m.membro=case when c.user_id=f.user_id then c.convidado else c.user_id end);
-- Relatórios preservados pela migração, sem concessão automática.
select * from public.v42_acessos_implicitos order by user_id,pasta_id,membro;
select resultado,count(*) quantidade from public.v42_auditoria_acessos group by resultado order by resultado;
select x.acesso_id,x.compromisso_id,x.membro,x.resultado,a.ativo,a.delegacao_id
from public.v42_auditoria_acessos x join public.v4_compromisso_acessos a on a.id=x.acesso_id order by x.resultado,x.acesso_id;
-- Deve retornar zero linhas: grants novos sem aceite correspondente.
select a.id,a.compromisso_id,a.membro from public.v4_compromisso_acessos a
left join public.v4_delegacoes d on d.id=a.delegacao_id
where a.ativo and a.delegacao_id is not null and (d.estado is distinct from 'aceita' or d.destinatario<>a.membro or d.compromisso_id<>a.compromisso_id or a.autorizado_por<>a.user_id);
-- Deve retornar zero linhas: pedidos simultâneos para a mesma tarefa.
select compromisso_id,count(*) from public.v4_delegacoes where estado='pendente' group by compromisso_id having count(*)>1;
-- Deve retornar zero linhas: novo recibo automático de leitura.
select tgname from pg_trigger where tgrelid='public.v4_notificacoes'::regclass and tgname='leitura_v4' and not tgisinternal;
select estado,count(*) from public.v42_conferencias group by estado;
select p.proname,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in('v4_acesso_usuario','v4_responder_delegacao','v4_delegar_com_acesso','v42_atividade','v42_conferir');
select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in('v42_acessos_implicitos','v42_auditoria_acessos','v42_conferencias');
commit;
