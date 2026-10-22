-- SOMENTE LEITURA, opcional para administrador/João. Não modifica dados ou permissões.
-- Preencher os três UUIDs do caso real. O SQL Editor geralmente não tem auth.uid();
-- por isso o diagnóstico usa parâmetros explícitos e a mesma regra da V4.1.
with parametros as (
 select null::uuid remetente, null::uuid destinatario, null::uuid compromisso
), caso as (
 select p.*,c.user_id titular,c.pasta_id,c.processo_id,c.status,c.responsavel,c.responsabilidade_definida,
 coalesce(c.pasta_id,public.v4_pasta_processo(c.processo_id)) pasta_efetiva
 from parametros p join public.compromissos c on c.id=p.compromisso
)
select compromisso,titular,status,pasta_efetiva,
 public.v4_par_ativo(remetente,destinatario) colaboracao_ativa,
 public.v4_acesso_usuario(pasta_efetiva,destinatario) acesso_pela_pasta,
 case when responsabilidade_definida then responsavel else titular end responsavel_atual,
 case when pasta_efetiva is null then 'Tarefa sem pasta: V4.1 recusava delegação; 007 permite autorização individual.'
 when not public.v4_acesso_usuario(pasta_efetiva,destinatario) then 'Colaboração não concede acesso a esta pasta. Confirmar acesso individual ou compartilhar a pasta.'
 else 'Permissão de pasta existente. Conferir responsável atual, estado da tarefa e destinatário.' end diagnostico
from caso;
