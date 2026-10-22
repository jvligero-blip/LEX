# LEX V4.1.1 — correção de delegação e notificações

Base preservada: GitHub `jvligero-blip/LEX`, commit `5043473b5f730afc1d7eeaf959a53f92be81351f`, publicado pelo Claude. Nenhum deploy, push ou SQL de produção foi executado nesta entrega.

## O que causava “Destinatário não autorizado”

O seletor mostrava todos os colaboradores ativos, mas a função `v4_delegar` exigia que o destinatário também tivesse acesso à pasta da tarefa. Isso recusava tarefas sem pasta, pastas privadas e casos sem correspondência automática segura de CNJ/cliente. A frase “a tarefa já é visível” era exibida mesmo quando essa condição não existia. O erro ainda aparecia com check verde.

O problema foi reproduzido em banco local com duas contas ativas antes da correção. Sem acesso à base hospedada, o estado específico do registro da captura não foi consultado.

## Comportamento corrigido

- Ao delegar, o LEX consulta a permissão real antes de enviar. Se o colega já vê a tarefa pela pasta, basta solicitar o aceite.
- Se a tarefa ainda é privada, o titular confirma **compartilhar somente aquele compromisso e seu histórico**. Funciona sem CNJ ou pasta. Isso não revela a pasta, outras tarefas, publicações ou audiências.
- O responsável anterior permanece até o aceite. Colaborador não pode tomar a responsabilidade pelo formulário de edição. A tarefa mantém o mesmo ID, título, datas, titular e histórico.
- O titular pode revogar o acesso individual no painel de transferência. A revogação da colaboração ou da pasta também encerra os acessos individuais relacionados. Nova colaboração não reativa autorizações antigas automaticamente.
- “Encaminhar” na publicação grava análise, tarefa, permissão e pedido na mesma transação. Falha mantém a análise pendente; retry não duplica tarefa/envio.
- Erros agora têm ícone de alerta e cor apropriada.

## Sininho

Notificações persistentes por conta: convites; aceite/recusa; pedido de compromisso; marcação de pedido como lido; andamento/conclusão; análise/reabertura de publicações; compartilhamento/revogação. Aceitar/recusar pode ser feito no próprio aviso. Há contador, filtro de não lidas, leitura individual/em lote e paginação.

**Lida não significa aceita, concluída ou classificada.** O e-mail apenas identifica a conta existente. Convites e avisos de colaboração chegam dentro do LEX; não foi criada integração de e-mail, SMTP ou push do navegador. As atualizações aparecem em até cinco segundos na aba ativa ou ao voltar para ela.

Avisos de análise/andamento são enviados apenas a quem já tem permissão sobre aquele registro. Avisos antigos deixam de mostrar título/detalhes privados depois de revogada a permissão. A migração recupera solicitações pendentes, sem renotificar todo o histórico ou reabrir publicações antigas.

## Para o João / Claude

1. Fazer backup verificável PostgreSQL/Auth e conferir a cópia de homologação. Confirmar que a base atual já possui 005 e 006.
2. Em homologação, aplicar **somente** `supabase/migrations/007_delegacao_notificacoes.sql`. Não reaplicar 001–006, não recriar banco, usuários ou convites. Não há nova variável de ambiente, chave de serviço ou configuração de Realtime.
3. Executar `npm ci`, `npm run build`, `npm test` com Node 22+. Windows usa Edge; em Linux instalar Chromium para o Playwright. Porta 3000 livre.
4. Conferir A/B/C: tarefa privada recusada sem consentimento; autorização somente da tarefa; aceite pelo sininho; andamento/conclusão; terceiro sem acesso mesmo com colaboração ativa; revogação; análise de publicação compartilhada; tarefas e classificações antigas.
5. Somente após revisão, backup e autorização para produção, João aplica a 007 na base existente e publica o conteúdo do ZIP na raiz do repositório/Vercel. Mesmos valores Supabase. Instalar `npm ci`, Build `npm run build`, Output `dist`, Node 22+. Nenhuma dessas ações remotas foi feita pelo Codex.

O frontend continua abrindo se a 007 estiver ausente, mas o sininho informa a pendência e as operações novas exigem a migration. Atualizar apenas o JavaScript não conclui a correção.

Backups pessoais mantêm os dados anteriores e acrescentam avisos/acessos como referência histórica. Restaurar backup pessoal não reativa permissões nem recria notificações antigas. Recuperação integral da caixa/autorizações depende do backup PostgreSQL/Auth; um novo acesso exige autorização atual. Nenhum histórico do banco é excluído nesta atualização.

Reversão do frontend pode usar a versão anterior, preservando a 007 e todos os dados. A interface anterior não gerencia os novos acessos individuais. Não remover tabelas/colunas para reverter; conferir permissões com cuidado em homologação.

## Validação e limites

Consulte `TESTES-NOTIFICACOES.txt`. SQL real local via PGlite, sessões A/B/C e navegador real com transporte Auth/PostgREST simulado. Supabase hospedado, backup real, volume real e concorrência entre conexões PostgreSQL independentes continuam pendentes de homologação. Não foram fornecidas credenciais externas de teste. A correção não foi aplicada à produção.
