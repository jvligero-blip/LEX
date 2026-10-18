-- Inventário SOMENTE LEITURA para conferir o banco antes/depois da atualização.
select tablename,rowsecurity from pg_tables where schemaname='public' and tablename in
 ('profiles','processos','publicacoes','compromissos','audiencias','compromisso_atividades') order by tablename;
select table_name,column_name,data_type from information_schema.columns where table_schema='public' and
 ((table_name='publicacoes' and column_name in ('id','user_id','texto_integral','exige_providencia')) or
 (table_name='compromissos' and column_name in ('id','user_id','status','data_revisao','prioridade','concluido_em','concluido_por')) or table_name='compromisso_atividades') order by table_name,ordinal_position;
select tablename,policyname,roles,cmd,qual,with_check from pg_policies where schemaname='public' and tablename in
 ('profiles','processos','publicacoes','compromissos','audiencias','compromisso_atividades') order by tablename,policyname;
select conrelid::regclass as tabela,conname,pg_get_constraintdef(oid) definicao from pg_constraint where connamespace='public'::regnamespace and conrelid in
 ('public.publicacoes'::regclass,'public.compromissos'::regclass) order by tabela,conname;
select p.proname,pg_get_function_identity_arguments(p.oid) as argumentos from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('classificar_publicacao','classificar_publicacao_v3','registrar_atividade_v3','restaurar_backup') order by p.proname;
