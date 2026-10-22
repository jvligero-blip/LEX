# LEX V4.1 — Evolução incremental: colaboração real, assuntos, publicações e rotina diária

**Documento de execução para Codex e posterior revisão/implantação pelo Claude/João.**
**Data de referência:** 21/10/2026. **Base fornecida:** `LEX-main(3).zip`, arquivo GitHub identificado pelo commit `7aa26533dcd101c694da1c452406ea817dfd1709` (LEX V3). Se outra versão mais recente for entregue, compará-la antes de modificar e usá-la como base.

## 0. Missão e entregável

**Implemente as funcionalidades abaixo, não apenas as descreva.** Aproveite o LEX V3, preserve seus dados e seus fluxos. Entregue um **ZIP completo, executável** do repositório atualizado, migrations SQL **somente incrementais**, testes automatizados, relato curto do que foi efetivamente validado e um checklist claro para publicação pelo João. Não faça deploy nem execute migrações no Supabase de produção sem autorização expressa. Se faltar acesso externo, implemente e teste localmente, deixando claro o que exige homologação real.

**Regra de produto:** o LEX registra *uma obrigação*, quem a assumiu, o que foi feito, o que falta fazer e qual publicação/assunto lhe deu origem. O usuário não deve reenviar a mesma obrigação ao colega nem classificar duas vezes o mesmo ato só para descobrir o que já foi feito.

### Regras que não podem ser quebradas

1. Cada advogado preserva o próprio login, suas OABs monitoradas, seus dados privados e suas comunicações originais.
2. Colaboração recíproca **expressamente autorizada uma vez** entre contas, com escopo de correspondência automática por processo; compartilhamento manual também disponível para pastas escolhidas.
3. Pasta compartilhada = compromissos, históricos de atividade e situação operacional visíveis para ambos; **não** significa tornar todo o acervo de ambos público.
4. Cada compromisso compartilhado possui **um responsável principal** (ou aparece em fila *Sem responsável*); ambos podem acompanhar. Criador, responsável e autor da última atualização são conceitos diferentes.
5. **"Nada a fazer" com um clique:** sem compromisso, sem campos obrigatórios extras; grava análise, ator e horário; visível ao colaborador quando for o mesmo ato compartilhado; reversível.
6. **"Já fiz" não é "Nada a fazer":** registrar providência executada e quem a fez. Criar compromisso pendente só quando de fato existir algo por fazer.
7. Publicações antigas já classificadas **não** retornam como pendentes, não perdem classificação e não geram tarefas novamente por mudança de versão, sincronização, associação de OABs ou ativação de colaboração.
8. Não apagar/recriar tabelas, não resetar banco, não executar seeds/dados de exemplo em produção, não modificar UUIDs de Auth.
9. Preservar DJEN por OAB, importação paginada, deduplicação local, fluxos de triagem V3, auditoria, backup, tarefas, audiências, LexBot e integração Vercel/Supabase.
10. Nenhuma funcionalidade compartilhada pode abrir acesso a terceiros ou permitir alterar outro usuário sem vínculo autorizado; RLS/testes devem assegurar isto.

## 1. Inventário real da V3 — trabalhar SOBRE ele

Constatado no ZIP fornecido:

- `src/app.js`: dashboard, pastas, publicações, triagem, compromissos, audiências, sincronização e perfil. `renderProcs`, `renderPubs`, `renderPrazs`, `openDetProc`, `openTriageBase`, `classify`, `savePraz`, `taskState` são pontos de integração. Não reescrever o app inteiro nem migrá-lo para Next/React.
- `src/store.js`: `tables`, `reload/all`, Supabase JS e seleção de dados. Hoje o carregamento reflete principalmente registros pertencentes ao titular.
- `lib/domain.js`, `lib/v3-domain.js`, `src/publication-view.js`: CNJ, estados, datas e texto das publicações.
- `src/lexbot.js`, `assets/lexbot/`: mascote já integrado, preservar.
- `supabase/migrations/001_lex.sql` a `004_v3_fluxos.sql`: **histórico de migrations, nunca reaplicar 001 ou resetar**. V3 mantém `user_id` nas entidades principais, `processos` com `unique(user_id, numero_cnj)`; `compromissos` e `publicacoes` têm FKs compostas com `user_id`; a triagem V3 exige compromisso para publicação com providência; `compromisso_atividades` tem timeline e RLS.
- `README-IMPLANTACAO-V3.md`: abordagem de migração 004, backup, testes e configuração. Manter compatibilidade.
- Scripts existentes: Node 22+, `npm ci`, `npm run build`, `npm test`, `npm run dev`, `npm run test:online` (homologação opt-in).

**Atenção técnica crucial:** compartilhar apenas a visibilidade de `processos` não permitirá que Ana crie/atualize corretamente tarefas pertencentes ao Rômulo: as FKs e RPCs atuais validam `user_id = auth.uid()`. É preciso modelo de colaboração seguro para **leitura e escrita autorizadas**, com ator real auditado, sem mudar titulares ou abrir RLS indiscriminadamente. Inspecione funções/triggers V3 antes da migration.

## 2. Cenários obrigatórios de uso (mais importantes que a aparência)

### Cenário A — Tarefa criada por um, visível imediatamente ao outro

A pasta *Maria — Preparar ação* está compartilhada. Rômulo clica em **Novo compromisso**, informa **"Protocolar ação de guarda"**, deixa responsável **Rômulo** ou sem responsável, e salva. **Não clica em "Enviar para Ana"**. No login de Ana, a mesma pasta e o mesmo compromisso já estão visíveis na aba *Compartilhados / Acompanho*, com "Criado por Rômulo" e estado "A fazer". Ana não precisa importar a tarefa ou receber convite individual. Se Rômulo registrar "Petição finalizada" e depois **Concluído**, Ana vê "Concluído por Rômulo" e a timeline. Não criar cópia do compromisso no banco nem item novo na fila da Ana.

### Cenário B — Só uma OAB recebeu publicação

Apenas Rômulo recebe uma publicação; a pasta está compartilhada manualmente. Ana enxerga publicação, decisão de triagem, compromisso e atividades dessa pasta pela permissão de colaboração, mesmo que sua OAB não tenha sido intimada. Identificar a OAB destinatária e a origem da comunicação. Isso não implica que Ana recebeu intimação oficial.

### Cenário C — Duas OABs recebem o mesmo ato

Ambos recebem comunicações via DJEN em **registros de origem próprios**. Colaboração previamente aprovada identifica **mesmo CNJ e, separadamente, provável mesmo ato**. Uma análise de Rômulo, "Nada a fazer", "Já fiz" ou "Vou fazer", aparece na interface de Ana com atribuição de autoria e link de histórico. Se a correspondência do ato for segura e a obrigação for comum, **não exigir segunda classificação operacional nem gerar segunda obrigação**. Preservar cada intimação, identificador, data e vínculo OAB individual; não reescrever silenciosamente o `triagem_status` da comunicação de Ana. A fila pode exibir a comunicação como **"Tratada em colaboração por Rômulo"** (resolução por vínculo), sem reaparecer como pendente operacional. Permitir **Revisar individualmente** quando necessário.

### Cenário D — Publicações diferentes no mesmo processo

Coincidência de CNJ **não** é coincidência de ato. Se o mesmo processo tem duas intimações distintas, nenhuma classificação pode fechar a outra. Indicação de correspondência duvidosa deve pedir vinculação/revisão humana, não deduplicar automaticamente nem ocultar prazo.

### Cenário E — Duplicidade de pastas preexistentes

Se Ana e Rômulo já têm pastas pessoais separadas para o mesmo CNJ, a colaboração autorizada pode apresentar uma visão conjunta sem mesclar/apagar/alterar seus registros. Sem migração destrutiva ou transferência de propriedade. Exibir acervo e origem/autor com clareza. Para possíveis conflitos (clientes diferentes, lados opostos, classificação distinta), **não compartilhar automaticamente conteúdo sensível**; exigir revisão/autorização daquela pasta, com exceção configurável.

### Cenário F — Assunto ainda sem CNJ

Criar pasta *Carlos — Analisar contrato* com título, sem número judicial e sem cliente completo. Criar tarefas, atribuir responsável, compartilhar com Ana e registrar atividades. Se ação for ajuizada, **vincular CNJ à pasta que já existe**, preservando os mesmos compromissos e histórico. Assuntos extrajudiciais podem ser finalizados sem nunca receber CNJ. Nada de inventar número de processo fictício.

### Cenário G — Classificação já concluída antes da V4

Existem comunicações antigas classificadas de maneira diferente em contas diferentes. A migration **não altera nenhuma delas**. Mostrar autoria e eventuais conflitos, oferecer decisão humana de unificar *o acompanhamento operacional* quando pertinente; não unir automaticamente dois prazos ou sobrescrever observações.

## 3. Modelo de domínio e persistência — arquitetura incremental

Projetar a menor extensão estável do banco para os seguintes conceitos (nomes internos a critério do implementador, documentar mapeamento):

1. **Relação de colaboração entre usuários:** convite, aceitação recíproca, estado ativo/revogado, regras de correspondência por CNJ e exclusões por processo. Nunca confiar só na UI para autorização.
2. **Pasta/assunto de trabalho:** identificador estável independente de CNJ, título, proprietário e membros. Para pastas processuais preexistentes, criar vínculo/adaptador sem duplicar registros. Um assunto pode não ter CNJ ou ter processos vinculados. Não substituir `processos` em massa. O cadastro automático por CNJ deve continuar idempotente.
3. **Permissão por pasta e por vínculo automático autorizado:** proprietário e colaborador; compartilhamento manual e revogação. Considerar duas contas com pastas pessoais para mesmo CNJ, sem merger silencioso.
4. **Trabalho operacional compartilhável:** compromisso, responsável principal, criador, próximo passo, datas e status. Pode ser derivado de publicação OU criado manualmente, inclusive sem CNJ. Uma única obrigação lógica para ambos, sem cópia por usuário.
5. **Atividades:** ator autenticado, data/hora, texto e eventual alteração de status/responsável. Preservar título da tarefa ao registrar passos intermediários. A autoria não deve ser assumida do proprietário do registro.
6. **Correspondência entre comunicações e ato:** vínculo de alta confiança entre registros pessoais, preservando sua identidade original. Classificação individual preexistente continua intacta; resultado do trabalho comum pode ser visto pelas duas contas. Uma possível correspondência não deve ter efeitos processuais automáticos.
7. **Decisões rápidas de triagem:** `nada_a_fazer`, `ja_fiz`, `vou_fazer`, `encaminhar`, `revisar_depois` / equivalentes; registrar *decisão*, autor, data e reversão. "Nada a fazer" sem compromisso; "Já fiz" registra execução sem gerar pendência; "Vou fazer" vincula compromisso persistente.

**Migração:** fornecer `supabase/migrations/005_v4_colaboracao.sql` e, somente se necessário, migrations 006+ ordenadas. Preferir criação de tabelas, índices, colunas opcionais, policies e RPCs a alteração destrutiva. `BEGIN/COMMIT` quando compatível; `IF EXISTS / IF NOT EXISTS` com cautela, jamais esconder incompatibilidades de esquema. Preservar `user_id`, UUIDs, triggers e auditoria V3.

**Implementação de escrita compartilhada:** como as constraints `user_id` dos filhos exigem o mesmo titular do processo/publicação, usar RPCs transacionais e/ou novo vínculo compartilhado consistente com tais constraints. RPC `SECURITY DEFINER` somente se necessário, sempre com `auth.uid()` validado, `search_path` fixo, privilégio mínimo, checagem de membro e registro do ator. Não permitir que cliente escolha arbitrariamente `user_id` de terceiros, não usar `service_role` no navegador nem criar `USING(true)` em RLS.

**Idempotência e concorrência:** aceite/revogação, importação DJEN, matching de atos, criação/conclusão compartilhada e sincronizações simultâneas precisam de constraints/UPSERT/locking adequados para impedir tarefas duplicadas e perda de atualização. Não resolver duplicidade apenas por filtro no JavaScript.

**Backups:** atualizar exportação/restauração e guias para incluir os novos dados e relações sem fazer uma conta restaurar dados privados de outra. Revogação não apaga histórico; deletar convite não deve apagar compromissos.

## 4. Fluxo visual simples de triagem

Nas publicações, sem abrir um formulário para decisões triviais, mostrar ações claramente diferenciadas:

- **Nada a fazer** — ação rápida de um clique; registra ciência/dispensa e exibe feedback com **Desfazer/Reabrir**. Sem pedir tipo ou data e **sem criar compromisso**. O compartilhamento exibe quem dispensou, mas não encerra ato diferente.
- **Já fiz** — registrar ato executado, com descrição opcional quando a ação for evidente, e nome de quem executou; resultado aparece ao colega, sem criar tarefa pendente artificial.
- **Vou fazer** — registrar/assumir compromisso com descrição, responsável e data facultativa; compromisso passa a agenda compartilhada se pasta compartilhada.
- **Encaminhar** — dirigir a um colaborador com aceite quando houver transferência expressa. Não usar isso para simples visibilidade de tarefa: tarefa da pasta compartilhada já é visível.
- **Analisar depois** — conservar pendência.

**Casos individuais e compartilhados:** "Nada a fazer nesta publicação" refere-se ao ato, não ao processo inteiro; "Não é minha responsabilidade" deve ser outro comando, que retira da fila individual sem afirmar dispensa para o colega. Não criar regra global para banco, tribunal ou advogado. Registrar a origem e o alcance de cada decisão.

**Comportamento existente V3:** `classificar_publicacao_v3` e trigger `validar_triagem_v3` só devem exigir compromisso quando a decisão exige **providência pendente**. Adapte o fluxo sem afrouxar esta proteção e sem reclassificar os registros antigos. Se um ato estiver executado, registrar conclusão ou decisão própria em vez de compromissos em aberto. Erro de gravação = decisão não confirmada, fila permanece corretamente.

**Histórico:** indicar claramente "Analisada por Ana", "Nada a fazer", "Já feito por Rômulo", "Responsável: Ana", "Última atividade ...", com horários corretos. Reabrir não apaga o que ocorreu antes; exibir conflito como conflito, nunca escolher uma classificação silenciosamente.

## 5. Criação manual de tarefas e rotina compartilhada — REQUISITO CENTRAL

A experiência ideal exige **zero passos extras para compartilhar uma tarefa dentro de uma pasta já compartilhada**.

- No cadastro "Novo compromisso", permitir escolher pasta processual existente ou assunto sem CNJ; salvar e fazer aparecer imediatamente para ambos os colaboradores da pasta.
- Não exigir que o criador atribua a tarefa ao outro para dar visibilidade. "Quem vê" é definido pelo compartilhamento da pasta; "quem executa" é definido pelo campo responsável.
- Padrão ao criar: criador como responsável (ou escolha explícita "Sem responsável"); não atribuir implicitamente à outra pessoa por ser membro da pasta.
- Mostrar **Criado por**, **Responsável**, **Última atividade por**, **Concluído por**. A ação **Assumir** muda somente o responsável e registra autoria; **Delegar** pede aceite quando for exigida transferência; **Concluir** encerra sem apagar histórico.
- Não trocar automaticamente o título "Protocolar ação" por "Pedir guia" ou "Preparar minuta". Isso são atividades ou próximo passo do compromisso original.
- Datas: fatal confirmada, data interna e data de revisão são independentes. Compartilhamento/conclusão/aguardando terceiro não altera vencimento fatal.
- Compromissos sem data ficam em "Sem data / Programar"; não usar datas fictícias; permitir assunto extrajudicial sem CNJ.
- Uma tarefa privada continua privada quando estiver em pasta privada, mesmo que o outro usuário possua o mesmo CNJ fora de colaboração autorizada.

## 6. Pastas sem CNJ e cadastro mínimo

- Interface: "Nova pasta" com opção **Assunto sem processo** (somente título obrigatório) ou **Processo judicial** (CNJ válido como identificador obrigatório). Nome, CPF/CNPJ, telefone, email, Drive e outras informações opcionais.
- Se posteriormente surgir CNJ, anexar à pasta existente; preservar todos os IDs de tarefas, histórico, anexos/referências e membro colaborador.
- Pastas criadas via DJEN continuam automáticas; não exigir preenchimento de cliente. Indicação suave de cadastro incompleto, sem contaminar painel de urgências.
- WhatsApp e link Drive já existem na V3; preservá-los e não desenvolver novo GED nem integração Drive completa nesta etapa.

## 7. Colaboração autorizada e compartilhamento manual

- Perfil/Colaboração: procurar convite por conta existente e confirmar destinatário, sem descoberta de e-mails privados em massa. Convite, aceitar, recusar/revogar. Para duas OABs, autorizar opção **"Compartilhar trabalho de processos coincidentes"** recíproca.
- Quando ambas tiverem o mesmo CNJ, habilitar visão compartilhada da pasta e de trabalho associado, respeitando exceções, sem duplicar acervos; fatos potencialmente conflitantes (clientes/lados diferentes, flags de restrição ou dúvida) exigem confirmação por pasta antes de revelar conteúdo.
- Pasta com apenas uma OAB: botão **Compartilhar com...**, independente de a outra conta ter recebido intimação.
- Visão no painel/agenda: **Meus (sou responsável)**, **Acompanho (compartilhados, mas não sou responsável)**, **Sem responsável**, **Aguardando terceiro**, **Sem data**. Mostrar eventos/compromissos com origem e responsável claros. Filtros não duplicam linhas.
- Revogação: impedir novo acesso do usuário revogado, manter registros e auditoria; reatribuir responsabilidades abertas quando necessário, sem excluir atividade do passado.
- Isolamento: terceiro usuário que não faz parte da relação não pode nem listar IDs, contar registros privados, baixar backups ou chamar RPC para leitura/escrita no acervo.

## 8. DJEN e correspondência de atos

- Preservar cada registro recebido por OAB e `last_seen_at`/fingerprint do usuário. Não deduplicar diferentes atos por CNJ ou por semelhança vaga de texto.
- Correspondência forte: usar identificadores oficiais do ato/documento e/ou conjunto determinístico validado (órgão, CNJ, tipo, datas, origem e conteúdo normalizado). Sem confiança suficiente, marcar **"Possível correspondência — revisar"**.
- Quando comprovado mesmo ato e trabalho comum, mostrar estado colaborativo em ambos os painéis sem sobrescrever classificação antiga nem criar segunda obrigação; permitir "Analisar individualmente" quando necessário.
- Publicação antiga já classificada nunca reaparece apenas porque Ana/Rômulo passou a colaborar, porque o DJEN foi sincronizado de novo ou porque novo relacionamento foi criado.
- A comunicação individual deve manter destinatário, OAB, termos iniciais e datas. **Nunca presumir prazo legal único para intimados distintos**; sugerir datas, confirmação do advogado.

## 9. Melhorias de sincronização DJEN (visual e funcional)

Tela com intervalo claro **De... Até...**, opção "Desde a última sincronização bem-sucedida" e início manual; etapas **Consultando → Processando/gravando → Concluído**, com estado evidente (executando/concluído/parcial/falha).

- Mostrar OAB, intervalo, dia/página atual, páginas já concluídas, publicações encontradas, novas, conhecidas e falhas, duração/início/fim e checkpoint.
- Barra percentual **apenas quando total mensurável**; senão progresso indeterminado com indicadores reais por página/lote, sem 100% falso.
- Conclusão muito clara: "Sincronização concluída: X novas, Y conhecidas, Z falhas"; em falha, "Carga parcial — retomar" e mensagem do erro.
- Histórico das últimas execuções persistido; jamais marcar carga parcial como integral. Não importar em dobro após retomar ou atualizar tela.
- Não substituir ou comprometer API DJEN existente por refatoração estética.

## 10. Preservar a identidade da V3 e melhorar somente o necessário

- Manter HTML/JS modular da V3, `v3.css`, Supabase, LexBot, endpoints `/api`, Node22, Vercel na mesma configuração. Alterar visual moderadamente para cards, indicadores claros e botões rápidos; manter acessibilidade e responsividade.
- Não desenvolver funcionalidades comerciais, pagamentos, assinatura, gestão financeira, ERP, GED complexo, chatbot com IA ou automações externas neste escopo.
- LexBot é opcional: não deve obstruir clique em "Nada a fazer", "Concluir" ou caixa de triagem. Sem efeitos sonoros obrigatórios.

## 11. Testes de aceitação obrigatórios (automatizar onde viável)

### Privacidade e permissões
1. Duas contas sem colaboração: cada uma vê apenas os próprios processos, publicações, tarefas e atividades.
2. Convite pendente não libera acesso; aceite recíproco libera apenas escopo autorizado.
3. Terceira conta sem autorização não lê nem modifica registros por consulta direta/PostgREST/RPC ou ID conhecido.
4. Compartilhar manualmente pasta com só uma OAB funciona; não falsifica destinatário da publicação.
5. Revogar acesso impede leituras/escritas futuras sem apagar registros/histórico.
6. Com mesmo CNJ, mas indício de conflito/partes divergentes, o sistema não expõe conteúdo automaticamente até revisão.

### Tarefas manuais e responsabilidade
7. Rômulo cria "Protocolar ação" em pasta compartilhada sem encaminhar; Ana vê **o mesmo ID de compromisso**.
8. Criador/ator/responsável são identificados corretamente; autoria nunca atribuída automaticamente ao titular da pasta.
9. Ana registra andamento permitido, Rômulo vê na mesma timeline sem tarefa duplicada.
10. Rômulo conclui a tarefa; Ana vê concluída, não pendente em sua agenda.
11. Alterar próximo passo não sobrescreve título original nem muda data fatal.
12. Tarefa de pasta privada do Rômulo não aparece para Ana, ainda que ela tenha CNJ igual em outro acervo não compartilhado.
13. Tarefa sem data aparece em filtro específico, sem prazo fictício.
14. Compromisso sem responsável entra em fila própria; "Assumir" define responsável e audita.

### Publicações e decisões
15. "Nada a fazer" em uma publicação com um clique, sem compromisso, gravando ator/hora; outro colaborador vê a decisão correspondente.
16. "Já fiz" registra o executado sem obrigação pendente artificial e com autoria.
17. "Vou fazer" cria/vincula compromisso atomicamente; falha não baixa publicação.
18. "Não é minha responsabilidade" não equivale a dispensa global da publicação para colega.
19. Mesmo ato nas duas OABs não cria compromisso em dobro, e a análise comum aparece para ambos.
20. Duas publicações distintas do mesmo CNJ permanecem separadas.
21. Match incerto mantém pendência/revisão; sem encerramento automático.
22. Publicação V3 anteriormente classificada continua classificada após migração, sincronização repetida e colaboração ativada.
23. Classificações antigas contraditórias permanecem identificáveis, sem sobrescrita e com indicação de conflito.
24. Reabrir mantém o histórico e não recria comunicação.

### Assuntos, DJEN e regressão
25. Criar assunto sem CNJ, atribuir tarefa, compartilhar e registrar andamento.
26. Vincular CNJ ao assunto depois; tarefas anteriores e IDs permanecem.
27. Criar pasta automaticamente ao importar publicação; idempotência por CNJ do titular preservada.
28. DJEN repetido, duplicidades conhecidas não geram novas publicações/tarefas.
29. Tela mostra transição entre em andamento, parcial, retomada e concluída, sem percentual falso.
30. Falha intermediária e retomada não perde checkpoint nem duplica dados.
31. Login/logout, RLS individual, backup/restauração, LexBot, audiências, HTML da publicação e atividades V3 permanecem operacionais.
32. Editar ou concluir tarefa compartilhada sem autorização falha do lado do servidor, sem alteração parcial.
33. Chamadas simultâneas de dois usuários para analisar o mesmo ato não geram duas obrigações; conflitos exibem resultado previsível.
34. Datas fatais e contagem jurídica não são alteradas automaticamente pelo compartilhamento ou pela situação "Aguardando terceiro".
35. Migrations em base V3 com dados fictícios representativos preservam **mesmo número/ID/status** de registros anteriores, inclusive já classificados, tarefas concluídas e atividades.

**Recomenda-se executar:** `npm ci && npm run build && npm test`; acrescentar testes em `tests/` utilizando a infraestrutura Node/PGlite/Playwright já existente. Para políticas compartilhadas, incluir testes de autorização como usuários distintos; mock frontend isolado não prova RLS de produção. Não declarar testes externos executados se não foram.

## 12. Ordem eficiente de execução para o Codex

**Fase 0 (curta):** identificar o commit/base, alterações recentes, esquema da 004, RPCs/trigger de triagem e testes. Não gastar tempo reescrevendo análise anterior.

**Fase 1 (integridade e modelo):** migration aditiva; permissão/colaboração, assuntos sem CNJ e trabalho compartilhável; segurança e auditoria; testes SQL. Esta fase é pré-requisito para UI colaborativa.

**Fase 2 (valor operacional):** compromissos manuais automaticamente visíveis ao colaborador, responsabilidades, "Assumir", filtros e timeline; **Nada a fazer/Já fiz/Vou fazer** com persistência e reversão.

**Fase 3 (integração DJEN):** matcher conservador de atos, compartilhamento automático autorizado por CNJ, casos de duas OABs, tratamento de conflitos e retrospectivo não destrutivo.

**Fase 4 (polimento):** sincronização DJEN clara, layout responsivo, regressões V3; manter LexBot.

**Não sacrificar as fases 1–2 para concluir detalhes visuais.** Se houver bloqueio, entregar o maior subconjunto funcional testado e documentar exatamente as pendências — não simular funcionalidades.

## 13. Entrega e handoff para Claude/João

Criar ao final:

1. **ZIP completo** do LEX atualizado, sem `.env` com segredos, `node_modules`, caches ou artefatos indevidos.
2. `supabase/migrations/005_v4_colaboracao.sql` (+ incrementais se indispensáveis), e script **somente leitura** de verificação pré-migration. Não fornecer SQL para executar 001–004 novamente.
3. `ALTERACOES-V4.md` curto: arquivos alterados, funcionalidades entregues, riscos e o que ficou pendente.
4. `README-IMPLANTACAO-V4.md` conciso: backup verificável + homologação + ordem de migrations + deploy por João/Claude + teste com duas contas + reversão sem destruição do banco.
5. `TESTES-V4.txt`: comandos, resultados reais, testes de permissões pendentes de ambiente e falhas conhecidas.
6. Opcional: capturas das telas novas e mapa do fluxo de colaboração; não gastar tempo desenhando documentos longos.

### Mensagem para Claude ao receber o ZIP produzido pelo Codex

> Revise o LEX V4 entregue pelo Codex tomando como base o commit V3 e este Markdown. Faça revisão técnica objetiva, especialmente de RLS/RPC/FKs, concorrência, privacidade, publicações antigas, tarefas compartilhadas criadas manualmente e testes de duas contas. Corrija bugs identificados sem reescrever o site, confirme o resultado de build/testes e gere um pacote final para o João. **Não aplique migrations nem deploy no Supabase/Vercel de produção** sem autorização. Liste qualquer risco impeditivo ou teste que não pôde executar. Preserve todos os registros do Supabase existente.

## 14. Critério final de sucesso

**Sucesso significa:** Rômulo e Ana entram com contas próprias; autorizam colaboração; ao puxarem a mesma publicação têm consciência do que o outro já analisou; podem dizer "Nada a fazer" em um clique; uma tarefa manual criada por um na pasta compartilhada aparece imediatamente para o outro sem convite para cada tarefa; há responsável, histórico e estado correto; um assunto sem CNJ pode evoluir para processo; a sincronização comunica claramente seu progresso e conclusão; e todas as publicações, prazos e atividades antigas continuam preservados e privados fora do escopo compartilhado.

**Não declarar o projeto "pronto para uso jurídico em produção" sem testar a integração real, migrações em cópia/restauração representativa da base, regras RLS entre usuários, sincronizações repetidas e situações de falha.**
