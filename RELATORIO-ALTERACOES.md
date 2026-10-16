# LEX — implementação e validação

Entrega de 15/10/2026, baseada no ZIP fornecido e na especificação obrigatória. Código efetivamente alterado; nenhum push, deploy, criação de conta externa ou migração de dados reais foi realizado.

**Estado:** MVP implementado e preparado para ativação. **Supabase online NÃO VALIDADO**, por ausência de URL, chave pública e contas reais A/B. A publicação em produção depende da configuração e homologação descritas no guia.

## Implementado

- HTML/CSS, identidade visual, navegação, listas e formulários originais aproveitados. Lógica separada em módulos JavaScript, sem React/Next ou redesign geral.
- Supabase Auth por e-mail/senha, recuperação de senha, sessão pelo SDK, CRUD remoto e descarte da memória de tela ao sair/trocar de conta. Sem fallback de acervo para localStorage, seed, senhas demo ou administração cruzada.
- Schema com RLS, titularidade, FKs compostas, índices e funções transacionais. Negação de leitura/alteração/exclusão e de vínculos de outro usuário testada em PostgreSQL local.
- Pasta automática por CNJ normalizado e dígito verificador, sem cadastro obrigatório de cliente. Publicações, tarefas e audiências relacionadas por UUIDs. Correção do vínculo propaga aos acompanhamentos que seguiam o vínculo anterior.
- DJEN por backend autenticado, nacional por OAB/UF, uma página/dia por chamada, retries para timeout/429/5xx, limitação de consultas, checkpoint persistente e retomada. Carga inicial em 01/10/2026 e janela incremental de sete dias, recuperando lacunas.
- Deduplicação por titular/fonte/ID externo e SHA-256 estável no fallback, com proteção no banco e serialização por titular. OABs adicionais são associações, não cópias. Reconsulta mantém primeira captura, análise e tarefas. Revisões da fonte preservam o original e geram sinalização/histórico.
- Fila permanente e histórico, classificação humana ampla com texto livre, reabertura, vínculo manual, múltiplos acompanhamentos e audiências originados da publicação. Sugestões são visuais; não geram fatal automaticamente.
- Compromissos com datas fatal confirmada, interna e sugerida; tarefas administrativas sem data; conclusão/reabertura independentes. Audiências sem parte obrigatória, com situação, modalidade/local e link. Dashboard mostra pendências e última carga concluída.
- Texto integral escapado, links restritos a HTTP/HTTPS e conteúdo externo sem execução de scripts. Datas civis não passam por conversão de fuso; instantes exibidos em America/Sao_Paulo.
- Exportador legado independente, importação com prévia, seleção de titular e confirmação da conta, chaves idempotentes e revisão de inválidos. Exportação online e restauração para a mesma conta, preservando vínculos e auditoria, sem sobrescrever dados atuais.

## Arquivos principais

| Arquivo | Mudança |
|---|---|
| `index.html` | Layout preservado; triagem, vínculos, sincronização, perfil, backups e formulários adaptados |
| `src/app.js`, `src/store.js` | Fluxos e armazenamento Supabase, CRUD e proteção da sessão |
| `lib/domain.js`, `lib/legacy.js`, `lib/server.js` | CNJ, datas, DJEN, migração, autenticação de backend |
| `api/publicacoes.js`, `api/config.js` | Sincronização paginada e configuração pública sem segredos |
| `api/andamentos.js`, `lex-sync.js` | DataJud protegido; antigo segundo motor de prazos substituído por reexportação do motor único |
| `supabase/migrations/001_lex.sql`–`003_vinculos.sql` | Schema, RLS, integridade, deduplicação, importação/restauração e vínculos |
| `scripts/`, `tests/` | Build, servidor local, teste online e testes reproduzíveis |
| `package.json`, `package-lock.json`, `vercel.json`, `.env.example` | Dependências fixadas, build e implantação |

## Testes efetivamente executados

**38 testes automatizados passaram; zero falhas na execução final.** Log completo: `TESTES-EXECUTADOS.txt`. Foram corrigidas referências de modais/sessão encontradas durante os testes e ajustadas as esperas por gravação assíncrona no roteiro de navegador.

| Validação | Resultado real |
|---|---|
| Build com esbuild e checagem de sintaxe | PASSOU |
| 3 publicações/1 pasta, reimportação, captura persistente, análises e tarefas independentes | PASSOU — SQL local real |
| SHA-256 sem ID, retificações distintas, duas OABs, constraints e CNJ com/sem máscara | PASSOU — SQL local real |
| RLS A/B, UUID alheio, inserção com titular adulterado, FKs cruzadas e acesso anônimo | PASSOU — SQL local real |
| 205 itens em 3 páginas, HTTP 500 intermediário, retries, rollback, replay e retomada | PASSOU — handler real + SQL local; DJEN simulado |
| Legado duas vezes, seleção explícita de dono, vínculos/status, inválidos em revisão | PASSOU — domínio e SQL local |
| Backup completo/restauração em outra instância local com mesmos IDs Auth e reimportação | PASSOU — PostgreSQL local |
| Login, triagem, tarefa sem data, publicação manual, audiência sem cliente, prazo confirmado, concluir/reabrir | PASSOU — Edge headless + SQL real, transporte Auth/PostgREST simulado |
| Novo build/reload, sessão independente A, logout A/login B e largura móvel 390 px | PASSOU — navegador local; não foi deploy Vercel nem dispositivo físico |
| XSS, texto >2.000 caracteres, ausência de cálculo automático, configuração ausente sem demo | PASSOU — domínio e navegador |
| Consulta oficial DJEN de conectividade e normalização de amostra de 5 comunicações | PASSOU — HTTP 200, `count/items`, IDs/datas/textos reconhecidos; sem persistir/expor conteúdos |
| OAB fictícia não nula, 100 itens/página | PASSOU — HTTP 200 e zero resultados; OAB `0` recusada no LEX após constatar que a API a ignora |
| `npm audit --omit=dev` | PASSOU — zero vulnerabilidades reportadas para dependências de produção nesta execução |
| Supabase Auth/PostgREST hospedados, RLS no projeto real e sessão entre dispositivos físicos | **NÃO EXECUTADO** — faltam credenciais/projeto |
| Carga histórica da OAB real diretamente para Supabase e confirmação de completude | **NÃO EXECUTADO** — faltam ambiente e OAB configurada |
| E-mail real de recuperação, DataJud com chave, deploy Vercel, backup/restauração de produção | **NÃO EXECUTADO** — configurações externas ausentes |

O PostgreSQL embarcado PGlite executou as migrations e as políticas SQL. Os testes não substituem a execução no Supabase hospedado. `npm run test:online` foi chamado e informou NÃO EXECUTADO, nomeando as seis variáveis ausentes; o script está preparado para João repetir com duas contas de homologação.

## Configurações externas restantes e limites

1. Criar Supabase, aplicar as três migrations e configurar `SUPABASE_URL`/`SUPABASE_ANON_KEY` na Vercel; criar contas individuais A/B, URLs de retorno e e-mail/SMTP de recuperação.
2. Executar a suíte online em homologação, conferir RLS e fluxos em sessões reais; só então migrar o legado de cada titular e conferir a carga DJEN de 01/10/2026 até hoje.
3. João revisar e publicar o código pelo GitHub/Vercel. Definir backups compatíveis com o plano, periodicidade e ensaio de restauração. Não foi prometido backup automático/PITR já ativado.
4. A sincronização manual funciona com aba aberta. Cron diário não foi implementado/ativado (P1); não há segredo de cron a configurar. DataJud é opcional e não integra o fluxo de prazo fatal.
5. Conteúdos truncados anteriormente não são recuperáveis do legado. IDs aleatórios antigos, ausência de titular e vínculos ambíguos exigem revisão humana. Filas antigas não comprovam classificação: o código anterior usava o mesmo sinal para confirmar e descartar sugestões.
6. O importador JSON restaura somente na mesma conta/UUID e não sobrescreve estados atuais. Recuperação integral de outro projeto exige backup do banco/Auth e mapeamento administrativo. Teste isso em homologação.

O LEX continua sendo instrumento auxiliar; datas fatais, feriados, suspensões e interpretação das comunicações devem ser conferidos pelo advogado e com o controle oficial.
