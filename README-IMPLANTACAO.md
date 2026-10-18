> Referência histórica da base anterior. Para atualizar, use README-IMPLANTACAO-V3.md e somente a migration 004; não reinicialize o banco.

# LEX — configuração e implantação

O código do MVP está implementado. **A integração com um projeto Supabase real ainda não foi validada**, pois não foram fornecidas URL, chave pública e duas contas de teste. Não use a aprovação dos testes locais como aprovação da produção.

## 1. Preservar o legado antes de trocar o site

1. No domínio e navegador do LEX antigo, disponibilize `exportar-legado.html` e abra `/exportar-legado.html`. O arquivo é independente e pode ser publicado sozinho antes da atualização. Abrir uma cópia em `file://`, em outro domínio ou em outro perfil **não acessa o mesmo armazenamento**.
2. Clique **Exportar backup legado** e guarde o JSON em local protegido. Repita nos navegadores de cada pessoa. Não limpe o armazenamento antigo.
3. O utilitário não modifica o legado, não exporta senhas, hashes de senha nem sessões. O backup pode conter mais de um titular; a importação exige seleção explícita.

## 2. Preparar o Supabase

1. Crie um projeto Supabase independente da Vercel. Use um projeto separado para homologação.
2. No SQL Editor execute, **uma vez e nesta ordem**, `supabase/migrations/001_lex.sql`, `002_migracao.sql`, `003_vinculos.sql`. Alternativa: execute uma vez o arquivo combinado `LEX-SUPABASE.sql` da entrega. **Não execute as duas alternativas.** Com Supabase CLI, use o histórico de migrations e `supabase db push` em vez de aplicar novamente arquivos já executados.
3. Em **Authentication → Users**, crie as contas reais por e-mail/senha. Não há contas demonstrativas, administração cruzada nem necessidade de `service_role` no aplicativo. Desative inscrições públicas se o projeto for exclusivamente interno. Configure políticas de senha e confirmação de e-mail conforme o uso.
4. Em **Authentication → URL Configuration**, configure Site URL e Redirect URLs com a URL final da Vercel e `http://127.0.0.1:3000` para homologação. O fluxo “Recuperar senha” depende de envio de e-mail/SMTP configurado no Supabase. Após abrir o link recebido, defina a nova senha na tela do LEX.
5. Obtenha a **Project URL** e a chave pública **anon/publishable** em Settings/API. Nunca use chave `service_role` ou `sb_secret_` no lugar da pública.

## 3. Rodar e testar localmente

Requisitos: Node.js 22 ou superior e npm. Descompacte o ZIP e entre na pasta `LEX`.

```sh
npm ci
# Copie .env.example para .env e preencha apenas as duas variáveis obrigatórias.
npm run dev
```

Abra `http://127.0.0.1:3000`. Sem configuração, o login mostra **Configuração do banco pendente** e bloqueia gravações. O localStorage armazena somente a sessão gerenciada pelo SDK de Auth; o acervo jurídico vem do banco. Recarregue o servidor após alterar `.env`; `npm run dev` refaz o build ao iniciar.

```sh
npm run build
npm test
```

`npm test` usa PostgreSQL embarcado PGlite e navegador headless, com Auth/PostgREST simulados nos testes de interface. No Windows usa Edge; em outros sistemas instale o navegador com `npx playwright install chromium`. A porta 3000 deve estar livre. Opcional: `LEX_BROWSER_CHANNEL=chrome` ou `msedge` seleciona outro canal instalado. Não são usados registros reais nesses testes.

**Validação online obrigatória em homologação:** preencha também `LEX_TEST_EMAIL_A`, `LEX_TEST_PASSWORD_A`, `LEX_TEST_EMAIL_B`, `LEX_TEST_PASSWORD_B` com duas contas distintas e `LEX_TEST_CONFIRM=homologacao`. Execute:

```sh
npm run test:online
```

O script testa Auth, CRUD, persistência em nova sessão e negação de acesso cruzado no Supabase real. Grava registros temporários e tenta removê-los ao final; a auditoria permanece. Sem variáveis, informa **NÃO EXECUTADO**, com saída não zero. Faça ainda o roteiro de primeiro uso na interface; esse script não testa o DJEN de sua OAB nem o envio de e-mail.

## 4. GitHub e Vercel, com João

1. João deve revisar e subir **o conteúdo da pasta LEX** na raiz do repositório. Nada foi enviado ao GitHub ou publicado por esta implementação.
2. Na Vercel importe o repositório. Framework: **Other**; Install: `npm ci`; Build: `npm run build`; Output: `dist`; Node: 22 ou superior. O `vercel.json` também define essas opções e as funções em `/api`.
3. Configure `SUPABASE_URL` e `SUPABASE_ANON_KEY` em Environment Variables, nos ambientes adequados. Não versione `.env` real. A rota `/api/config` expõe somente as duas configurações públicas permitidas.
4. `DATAJUD_API_KEY` é opcional, exclusivamente no servidor. A rota DataJud original foi preservada e protegida por autenticação; não bloqueia o MVP e não foi validada com chave real. Não existe integração de DataJud para definir prazo fatal.
5. Faça o deploy e confirme `/api/config`, login, CRUD e `npm run test:online` no projeto correspondente. Confira os logs sem registrar tokens ou textos jurídicos. Erros DJEN ficam também no histórico de sincronizações.

## 5. Primeiro uso e migração

1. Entre com a conta correta, em **Advogado** informe nome e OAB/UF ou adicione várias OABs monitoradas. Cada conta tem suas próprias configurações. OAB zerada é recusada.
2. Em **Backup e migração**, selecione o JSON, escolha **um titular de origem**, digite o e-mail da conta de destino e confirme a titularidade. Cadastros sem titular são um grupo separado, também sujeito à confirmação. Confira o relatório JSON e as pendências; não atribua registros de outra pessoa à sua conta.
3. Processos são consolidados por CNJ com verificador. Publicações usam ID externo ou fingerprint SHA-256. Tarefas/audiências usam referências legadas estáveis. Sugestões antigas não criam tarefas automaticamente. Registros inválidos ficam em revisão no banco; o arquivo original continua disponível. Sem evidência de classificação humana no legado, a publicação entra para análise.
4. Classificações explícitas e tarefas concluídas são preservadas. Publicações antigas sem CNJ em campo próprio tentam aproveitar o CNJ do título. Conteúdos que já estavam truncados no legado não podem ser reconstruídos pelo backup. Duplicatas antigas com ID aleatório ou sem informação suficiente podem exigir conferência manual.
5. Em **Publicações → Sincronizar DJEN**, escolha OAB, início **01/10/2026**, fim desejado e **Iniciar carga**. Aguarde o estado **concluida**. Erros/parcial não são conclusão. Uma página por dia/lote, checkpoint transacional e botão **Retomar** permitem recuperar interrupções. Repetir a carga não altera a classificação nem recria tarefas.
6. Mantenha a aba aberta durante a carga. O botão **Janela incremental com recuperação** usa a última data concluída para a OAB, com sobreposição de sete dias; na falta dela, inicia em 01/10/2026. Execute diariamente. **Não há cron configurado nesta entrega.**
7. Confira a carga com o DJEN oficial. A consulta é nacional conforme a cobertura da fonte. O sistema não inventa comunicações de órgãos ausentes do DJEN.

## 6. Backup, restauração e atualizações

- Em **Advogado → Exportar backup online**, faça exportações periódicas por conta e armazene-as protegidas. O JSON inclui cadastros, publicações íntegras, tarefas, audiências, sincronizações, auditoria e pendências de migração. Não inclui credenciais.
- O importador restaura esse JSON **na mesma conta/UUID**, sem sobrescrever registros existentes. Vínculos e titularidade são validados; falhas cancelam a transação. Para recuperar em outro projeto com IDs de Auth diferentes, João deve realizar restauração administrativa e mapeamento explícito; não troque IDs de usuários por tentativa. Para restaurar estados de registros já modificados, use backup completo do banco e ambiente de recuperação, pois o importador não sobrescreve o acervo atual.
- Para recuperação completa, inclua a estratégia de Auth e faça backup do PostgreSQL com a ferramenta do Supabase/plano ou `supabase db dump`/`pg_dump` via conexão autorizada. Confira a cobertura do plano, a retenção e **teste a restauração em homologação**. Backups automáticos/PITR não foram ativados nesta entrega. GitHub/Vercel não guardam o acervo jurídico.
- Antes de atualizar: **exportar/backup → aplicar somente novas migrations → publicar código compatível → validar login, dados e isolamento**. Nunca execute reset, DROP, TRUNCATE, seed ou substitua a base para atualizar o layout.
- Futuro compartilhamento: criar workspaces e membros por migration, iniciar com um workspace por titular, preservar `user_id` e revisar RLS/FKs antes de conceder qualquer acesso compartilhado. Esta versão mantém acervos pessoais separados.

Limites operacionais: 366 dias por execução, 100 itens por página, 30 consultas/minuto/conta e 2 MB de texto por publicação. Respostas inconsistentes e falhas são interrompidas sem avançar o checkpoint. Páginas cheias exigem página adicional mesmo quando a fonte limita `count`. Prazos são datas civis; feriados, suspensão e interpretação exigem confirmação humana.

Referências: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Auth por senha](https://supabase.com/docs/reference/javascript/auth-signinwithpassword), [Vercel Environment Variables](https://vercel.com/docs/environment-variables), [DJEN oficial](https://comunica.pje.jus.br/).
