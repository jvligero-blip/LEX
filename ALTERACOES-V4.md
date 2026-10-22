# LEX V4.1 — alterações

- `005_v4_colaboracao.sql`: relação entre contas com aceite/revogação; pastas estáveis e assuntos sem CNJ; membros/exclusões; leitura por RLS e escrita compartilhada por RPC; criador/responsável/ator separados; atividades, assumir/delegar, decisões rápidas e correspondência conservadora de atos. Adaptadores para processos existentes sem mudar seus IDs/estados.
- `006_v4_integridade_backup.sql`: autoria e versão de edição; backup V3/V4; proteção contra restauração de outro acervo; audiência compartilhada; pausa persistida do DJEN; compatibilidade da RPC V3 com trava operacional comum; unificação humana de acompanhamento sem substituir fontes ou excluir tarefas.
- `src/app.js`, `src/store.js`, `lib/v4-domain.js`, `index.html`, `v3.css`: integração sobre as telas V3; tarefa manual já visível na pasta compartilhada; filtros de responsabilidade; origem OAB explícita; Nada a fazer/Já fiz/Vou fazer/Encaminhar/revisão individual; assuntos; colaboração; progresso DJEN sem percentual fictício. Atualização automática em até 5 segundos na aba ativa.
- Testes SQL A/B/C, migração com registros V3, backup, chamadas concorrentes locais, navegador com duas sessões e regressões. API DJEN testada com 205 itens, falha intermediária, retomada e repetição sem reimportação.
- Migrations 001–004, arquivos `/api`, LexBot/atlas, configuração Vercel e arquitetura mantidos. `BASE-E-VALIDACAO-V4.json` registra hashes da base e os arquivos alterados.

## Limites objetivos

Sem acesso/deploy em produção. Supabase hospedado/Auth/PostgREST, DJEN real, escala do acervo e restauração do backup real não foram homologados; credenciais externas não foram fornecidas. O teste concorrente PGlite usa executor local serializado: repetir em PostgreSQL hospedado com conexões independentes.

Matcher exige mesmo identificador oficial, CNJ, datas, órgão, tipo e conteúdo normalizado. IDs diferentes/indícios insuficientes continuam independentes; vinculação manual forçada de atos incertos fica pendente. Unificação de análises antigas é explícita e conserva obrigações preexistentes para revisão humana, sem mesclá-las.

Permissões de colaboração exportadas servem como referência e não são reativadas pelo restore pessoal. Recuperação integral da relação requer backup completo PostgreSQL/Auth ou novo convite/autorização. Polling usa reconsultas autenticadas; conferir desempenho/limites do plano com o volume real antes de liberar produção.
