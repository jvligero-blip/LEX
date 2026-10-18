# LEX V3 — publicação incremental

Base oficial: **LEX-main.zip fornecido em 16/10/2026**, extraído do GitHub e indicado pelo usuário como a versão publicada. Supabase, autenticação, rotas DJEN e estrutura HTML/JavaScript foram mantidos. **Não crie outro projeto/banco nem reaplique o SQL inicial.**

## Para o João

1. **Backup primeiro:** exportar os dados online de cada conta e obter backup completo do PostgreSQL/Auth conforme o plano atual. Verificar a restauração em homologação com os mesmos IDs de usuários. O teste local de restauração passou; o backup real de produção não foi acessado nem verificado nesta entrega.
2. Conferir o inventário do esquema com `supabase/verificar-v3.sql` (somente leitura). A base esperada corresponde às migrations `001`–`003` presentes no ZIP. Se o banco tiver divergências não refletidas no GitHub, revisar antes de aplicar.
3. Em homologação, aplicar **somente** `supabase/migrations/004_v3_fluxos.sql`; conferir registros existentes e políticas. A migration é transacional e não reescreve IDs, estados antigos, classificações nem textos de publicações. Não altera usuários/senhas do Auth. Amplia os estados aceitos, adiciona campos e a tabela de atividades com RLS.
4. Instalar e validar:

```sh
npm ci
npm run build
npm test
npm run dev
```

Node 22 ou superior. No Windows os testes usam Edge headless; em outros sistemas, `npx playwright install chromium`. Porta 3000 livre. O teste usa banco local PGlite e transporte Auth/PostgREST simulado, sem dados de produção.

5. Reusar as variáveis já existentes, **com os mesmos valores do mesmo Supabase**: `SUPABASE_URL`, `SUPABASE_ANON_KEY`; `DATAJUD_API_KEY` continua opcional. Nenhuma variável nova ou chave de serviço é necessária. Não colocar credenciais em arquivos versionados.
6. Com autorização para produção, obter/verificar o backup real, aplicar apenas a `004`, subir o conteúdo de `LEX/` para a raiz do repositório e publicar na Vercel: Framework **Other**, Install `npm ci`, Build `npm run build`, Output `dist`, Node 22+. O `vercel.json` foi preservado. Não publicar a pasta `node_modules`.
7. Conferir em duas contas reais: login, HTML antigo, original intacto, triagem com/sem providência, dois andamentos, conclusão/reabertura, vínculos da pasta, sincronização DJEN repetida e isolamento entre contas. Em homologação, `npm run test:online` continua disponível; exige as variáveis `LEX_TEST_EMAIL_A`, `LEX_TEST_PASSWORD_A`, `LEX_TEST_EMAIL_B`, `LEX_TEST_PASSWORD_B` e `LEX_TEST_CONFIRM=homologacao`, além das duas variáveis Supabase. Ele valida o fluxo online básico; conferir também os novos fluxos V3 na interface.

## Uso e compatibilidade

- **Publicação antiga em HTML:** é convertida na leitura para texto estruturado, preservando parágrafos, listas, numeração e linhas/colunas de tabelas. “Ver original” mostra o conteúdo literal escapado. Nenhum texto antigo precisa ser excluído/reimportado.
- **Classificação:** escolher expressamente se exige providência. Com providência, criar o compromisso no próprio painel ou usar um já persistido, com pasta e vínculo. Gravação e baixa da análise são uma transação; falha mantém a pendência. É possível manter pendente, reabrir e avançar para a próxima depois de salvar.
- **Compromissos:** “+ Andamento” registra etapas sem trocar o título. A fazer, em andamento, aguardando terceiro, concluído e cancelado têm significado próprio. Aguardar terceiro não altera o fatal. Cancelar preserva histórico. Registros antigos concluídos sem data de conclusão conhecida continuam assim; a migration não inventa datas.
- **Pastas:** apenas CNJ continua obrigatório. Cliente, documento, telefone, e-mail, descrição amigável e documentos HTTPS são opcionais. WhatsApp abre somente o link, sem enviar mensagens. O indicador de cadastro completo pode exigir nome + contato ou apenas nome, nas preferências.
- **Datas:** atalhos 5/10/15/30 e customizado exigem data-base; dias úteis excluem somente fins de semana. O resultado é sugestão/data interna. Fatal a partir da sugestão exige confirmação humana; feriados/suspensões/termo inicial precisam ser conferidos.
- **LexBot:** usa o atlas RGBA original anexado, com adaptador JavaScript leve; não há migração para Next.js. Pode minimizar, arrastar, desligar, silenciar mensagens e reduzir animações em **Advogado**. Sem áudio automático. Preferências são locais por usuário/navegador; os dados jurídicos continuam no Supabase. Se o atlas falhar, usa o ícone estático e o núcleo continua funcionando.
- Backups online da V3 incluem a timeline. A restauração mantém a mesma conta/UUID e não sobrescreve registros atuais. Arquivos antigos continuam aceitos. Os documentos de implantação anteriores e `LEX-SUPABASE.sql` são referências históricas, **não instruções de atualização para esta versão**.

## Recuperação

Se houver problema no frontend, reverter o deploy na Vercel mantendo o esquema ampliado e os registros. Clientes anteriores continuam usando o RPC compatível, agora com proteção de providência; podem exigir criar o compromisso antes de classificar. Não remover a tabela de atividades, colunas ou estados novos para “voltar”. Recuperação integral deve partir de backup verificado em ambiente controlado, preservando Auth/UUIDs e conciliando gravações posteriores ao backup. Nenhum rollback destrutivo foi executado ou preparado como rotina automática.

**Não executado:** deploy, aplicação/validação no Supabase hospedado, conferência do conteúdo real do processo citado e restauração do backup real de produção. As capturas usam dados fictícios. Nenhuma integração jurídica externa nova foi adicionada.
