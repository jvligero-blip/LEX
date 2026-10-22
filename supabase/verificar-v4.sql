-- SOMENTE LEITURA. Comparar inventário antes/depois, em cópia/homologação.
select current_database(),version();
select table_name,column_name,data_type,is_nullable from information_schema.columns where table_schema='public' and table_name in ('processos','publicacoes','compromissos','compromisso_atividades') order by table_name,ordinal_position;
select tablename,policyname,cmd,roles,qual,with_check from pg_policies where schemaname='public' order by tablename,policyname;
select p.oid::regprocedure as funcao,p.prosecdef as security_definer,p.proconfig as configuracao from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'v4_%' or p.proname in ('classificar_publicacao_v3','restaurar_backup','ingest_publicacao')) order by 1;
select 'processos' entidade,count(*) quantidade from public.processos union all select 'publicacoes',count(*) from public.publicacoes union all select 'compromissos',count(*) from public.compromissos union all select 'audiencias',count(*) from public.audiencias union all select 'atividades',count(*) from public.compromisso_atividades;
select triagem_status,exige_providencia,count(*) from public.publicacoes group by 1,2 order by 1,2;
select status,count(*) from public.compromissos group by 1 order by 1;
select conrelid::regclass as tabela,conname,pg_get_constraintdef(oid) as definicao from pg_constraint where connamespace='public'::regnamespace and conrelid in ('public.processos'::regclass,'public.publicacoes'::regclass,'public.compromissos'::regclass) order by 1,2;
-- Resultados abaixo contêm dados privados. Conservar por canal seguro, não publicar.
select id,user_id,triagem_status,classificacao,analisado_por,analisado_em from public.publicacoes order by id;
select id,user_id,status,descricao,data_fatal_confirmada,concluido_por from public.compromissos order by id;
