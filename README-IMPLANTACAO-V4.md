# LEX V4.1 — João / revisão pelo Claude

Base: ZIP GitHub cujo comentário identifica `7aa26533dcd101c694da1c452406ea817dfd1709`. Atualização incremental HTML/JS. Migrations 001–004, endpoints DJEN, Vercel e LexBot preservados. **Nenhum deploy ou acesso ao Supabase de produção foi executado.**

## Ordem de implantação

1. Fazer backup completo PostgreSQL/Auth e exportação pessoal de cada conta na V3. Verificar restauração em cópia representativa, com os mesmos UUIDs do Auth. Guardar contagens, IDs e estados anteriores.
2. Executar `supabase/verificar-v4.sql` (somente leitura). Confirmar que o esquema real contém a 004 e não possui alterações incompatíveis fora do GitHub. Os resultados contêm dados privados: não publicar.
3. **Em homologação**, aplicar nesta ordem **somente** `005_v4_colaboracao.sql` e `006_v4_integridade_backup.sql`. Não reaplicar 001–004 nem `LEX-SUPABASE.sql`. As duas migrations são transacionais e devem ser revisadas juntas.
4. Com Node 22+, executar `npm ci`, `npm run build`, `npm test`. Windows: Edge headless; em Linux, instalar Chromium com `npx playwright install chromium`. Porta 3000 livre. `npm run dev` abre o servidor local.
5. Testar três contas A/B/C em homologação: convite pendente sem acesso; aceite sem revelar pastas privadas; compartilhamento de assunto; tarefa manual vista por B com mesmo ID; andamento/conclusão com ator real; C bloqueada por PostgREST/RPC; revogação; duas origens DJEN; publicações V3 intactas; backup/restauração.
6. Após revisão e **autorização expressa para produção**, João aplica 005 e 006 na base existente e publica o conteúdo da pasta `LEX-V4.1/` na raiz do repositório. Vercel: Framework Other, Install `npm ci`, Build `npm run build`, Output `dist`, Node 22+. Reusar o mesmo Supabase/Auth e as variáveis atuais `SUPABASE_URL` e `SUPABASE_ANON_KEY`; sem service role no navegador. `DATAJUD_API_KEY` permanece opcional. Não criar outro banco.
7. Conferir as contagens/IDs/status anteriores, login, tarefas antigas, publicações antigas, audiências, HTML original, LexBot, sincronização repetida/retomada e permissões das contas reais autorizadas.

## Operação e configuração

- Perfil → Colaboração: convidar o e-mail exato de uma conta existente; o destinatário aceita no próprio perfil. O escopo automático por CNJ faz parte do convite aceito. Para mudar o escopo, revogar e convidar novamente.
- Pasta → Compartilhar / revogar: autorizar somente aquela pasta. Todas as tarefas passam a ser visíveis, sem encaminhamento individual. Criador começa como responsável; pode escolher Sem responsável. Delegação exige aceite no perfil do destinatário.
- Nova pasta → Assunto sem processo: só título obrigatório. Para vincular CNJ depois, editar a mesma pasta e escolher Processo judicial. O ID da pasta, as tarefas e a timeline permanecem.
- Correspondência automática exige CNJ e cliente compatíveis; identificação ausente, conflito ou restrição exige compartilhamento manual. Para excluir uma pasta da correspondência automática, marcar a opção na edição. Revogar compartilhamento manual também bloqueia a correspondência automática daquela pasta.
- Mesmo ato: resolução operacional aparece ao colega sem reescrever sua comunicação original. Datas individuais permanecem. Conflitos históricos permitem escolher acompanhamento comum, com confirmação humana; tarefas antigas exigem conferência individual, sem exclusão automática.
- Atualização automática a cada 5 segundos na aba ativa e ao retornar à aba. Não exige configurar Supabase Realtime.
- Backup exporta linhas do próprio titular, pastas, decisões e atividades. Relações/membros/delegações são referência histórica; restauração não reativa permissões. Cada titular conserva o próprio backup; para recuperação integral da colaboração usar backup completo PostgreSQL/Auth, validado em homologação.

## Homologação online ainda necessária

Não foram fornecidas credenciais de homologação. `npm run test:online` está preparado para três contas novas de teste. Exige `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `LEX_TEST_EMAIL_A/B/C`, `LEX_TEST_PASSWORD_A/B/C`, `LEX_TEST_PROJECT_HOST` (hostname exato do projeto de teste) e `LEX_TEST_CONFIRM=homologacao`. Usa somente chave pública e sessões individuais; grava fixtures e conserva auditoria no projeto descartável. Não executa migrations/deploy. Não apontar esse teste à produção. O script V3 anterior é referência histórica; o comando atual usa `scripts/test-online-v4.mjs`.

Ainda validar Supabase/PostgREST/Auth hospedados, backup real representativo, DJEN real e concorrência em conexões PostgreSQL independentes. PGlite local possui executor serializado. IDs oficiais diferentes/conteúdo divergente mantêm análises independentes: não foi implementada vinculação forçada de correspondências incertas.

## Reversão

Reverter o frontend na Vercel se necessário, conservando as migrations, assuntos e dados novos. A V3 não exibe todos os assuntos/recursos V4; não usar retorno de frontend como recuperação de dados. Não apagar colunas/tabelas, não transferir titulares e não resetar Auth. Recuperação integral requer backup verificado e conciliação das gravações posteriores.

## Handoff para Claude

Revisar RLS/RPC/FKs, permissões de funções SECURITY DEFINER, concorrência, fonte original e classificações antigas, backup e tarefas manuais compartilhadas. Executar build/testes e homologação A/B/C; corrigir problemas incrementalmente. Comparar com o commit acima e com o Markdown V4.1 fornecido. **Não aplicar migrations nem deploy em produção sem autorização.** Registrar qualquer risco impeditivo/teste externo pendente e gerar o pacote final para João.
