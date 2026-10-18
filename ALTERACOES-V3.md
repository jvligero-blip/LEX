# LEX V3 — alterações e testes

**Base:** novo `LEX-main.zip` recebido em 16/10/2026. A versão anterior entregue nesta conversa não foi usada como base oficial. Evolução sobre HTML/JS e Supabase existentes, sem novo framework, sem novo banco, sem deploy ou gravação em produção.

## Inventário técnico e implementação

| Área / arquivos | Alteração incremental |
|---|---|
| `src/publication-view.js`, `src/app.js` | Conversor central de HTML/entidades/HTML escapado para texto estruturado seguro. Leitura integral, original literal, cards com trecho e links. Serve para publicações antigas sem alterar `texto_integral`. |
| `publicacoes`, `compromissos` / `004_v3_fluxos.sql` | Decisão explícita de providência, RPC transacional, proteção contra baixa sem compromisso válido, retry por UUID, reabertura sem duplicação e feedback com atalhos. Classificações anteriores permanecem intactas, sem inferir sua decisão de providência. |
| `compromisso_atividades` / mesma migration | Timeline com usuário, horário, texto, estados e próximo passo; registros adicionados sem sobrescrever atividades anteriores. RLS/FK por titular. Datas fatal, interna e revisão independentes. Conclusão registra usuário/instante; reabertura conserva a timeline. |
| `src/app.js`, `lib/v3-domain.js` | Cliente e contatos opcionais em `processos.payload`, CPF/CNPJ e telefone validados, documentos HTTPS, link WhatsApp; atalhos de data apenas sugeridos. Preservação dos demais campos do payload em edições. |
| `index.html`, `v3.css` | Abas A analisar/Histórico, filtros de período/categoria, leitura em duas colunas no desktop, painel com oito contagens navegáveis, resumo diário único e preferência de exibição. Mantidas cores, tipografia e navegação. |
| `src/lexbot.js`, `assets/lexbot/` | Arte original LexBot v2, atlas e 24 animações fornecidos, adaptador cliente sem bibliotecas novas. Instância única, alertas reais, cooldown, minimizar/reposicionar/desativar, mensagens opcionais e movimento reduzido. Escondido durante modais e destruído no logout. |
| `src/store.js`, restauração na `004` | Nova tabela incluída nas cargas/backups. Restauração de V3 e compatibilidade com backup antigo, sem sobrescrever dados presentes. |
| `scripts/build.mjs`, `scripts/dev.mjs` | Copiar CSS/assets no build e servi-los corretamente no ambiente local. Mesma arquitetura de deploy. |
| `api/*`, `lib/domain.js`, migrations `001`–`003`, `vercel.json` | Preservados byte a byte em relação ao ZIP oficial. Nenhuma alteração do motor DJEN, unicidade CNJ, autenticação do backend ou infraestrutura de publicação. |

**Banco:** apenas a migration `004_v3_fluxos.sql` é nova. As políticas existentes continuam; a tabela nova tem RLS e FK composta. O enum por CHECK dos compromissos foi ampliado sem remapear valores antigos. A função de auditoria inclui os novos campos. `auth.users` não é alterada. Aplicação em produção exige backup verificado e autorização fora desta entrega.

## Resultado dos testes executados

**53 testes passaram; zero falhas na suíte final**, além do build e checagem de sintaxe. Log: `TESTES-V3.txt`.

- PostgreSQL local real (PGlite): atualização de uma base `001`–`003` previamente preenchida preservou campos/IDs/contagens/Auth, incluindo classificações, processos, tarefas e audiências. Reexecução da migration nova também passou.
- RLS negativa A/B, UUIDs e referências cruzadas; proteção do original, baixa sem tarefa recusada, falha no segundo compromisso revertendo a transação, retries concorrentes sem duplicação.
- Duas atividades conservaram o título, o vínculo e o fatal; aguardando terceiro/em andamento, conclusão com autor/data e reabertura; backup V3 com providência e timeline restaurado de forma idempotente.
- Regressões DJEN: 205 itens, páginas, falha HTTP intermediária, retomada, deduplicação, duas OABs e manutenção de classificações.
- Edge headless + SQL local, Auth/PostgREST simulados: HTML com entidades em camadas, parágrafos/listas/tabela, texto simples, original preservado e XSS bloqueado; falha simulada manteve a análise aberta, duplo clique não duplicou tarefa.
- Navegador: dados opcionais, links seguros, atalhos sem fatal automático, andamentos, rebuild/reload, outra sessão, logout A/login B, largura móvel, resumo uma vez ao dia e filtro de vencimentos confirmados.
- LexBot: transparência via canal alfa no navegador, atlas 1120×1056, instância única, minimização, ativação persistente e falha do sprite sem impedir login/navegação. Metadados: 24 animações e coordenadas de quadros dentro dos limites. Assets copiados sem regeneração; apenas a arte original é distribuída, sem GIFs de preview ou personagens Microsoft.

As falhas iniciais do teste de interface decorreram do adaptador local que recusava dígitos nos nomes dos novos RPCs; ele foi corrigido. Os resultados acima são da execução final aprovada.

## Limitações e conferência externa

- **Não testado no Supabase hospedado nem na produção/Vercel.** Não havia credenciais de homologação e nenhuma base de produção foi acessada. O comando de teste online informou explicitamente as variáveis ausentes.
- A reprodução HTML usa fixture fictícia baseada na descrição do processo **4000415-42.2026.8.26.0538**. O conteúdo real desse registro não foi consultado. A representação usa texto estruturado, não reproduz o CSS/diagramação do tribunal; conserva o original para conferência.
- Atalhos de dias úteis não conhecem feriados/suspensões. Não são cálculo de fatal jurídico. Integrações externas existentes permanecem; cron não foi acrescentado.
- Preferências do LexBot e resumo diário são por conta/navegador. Não há áudio automático, chatbot ou IA. Falha do mascote não bloqueia o trabalho jurídico.
- João deve verificar backup real, aplicar apenas `004` em homologação, testar duas contas e os fluxos novos; somente depois, com autorização, aplicar em produção/publicar. Procedimento e recuperação estão no guia curto.
