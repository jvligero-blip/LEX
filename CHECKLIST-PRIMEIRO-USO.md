# LEX — checklist de primeiro uso

- [ ] Exportar o legado no domínio/navegador antigo de cada usuário; guardar o JSON sem limpar o armazenamento.
- [ ] Criar Supabase de homologação e produção separados; aplicar as três migrations na ordem.
- [ ] Criar duas contas reais no Auth; configurar URLs, recuperação de senha e variáveis da Vercel.
- [ ] Rodar `npm ci`, `npm run build`, `npm test` e `npm run test:online` com as duas contas de homologação.
- [ ] Fazer login A, cadastrar OAB/UF, criar uma pasta somente com CNJ e recarregar para conferir persistência.
- [ ] Importar apenas o titular legado correto; conferir relatório e pendências de revisão. Reimportar para confirmar ausência de duplicatas.
- [ ] Sincronizar de 01/10/2026 até hoje; conferir estado concluído, páginas e totais com o DJEN oficial. Retomar qualquer falha.
- [ ] Repetir a consulta; conferir zero novas publicações já conhecidas, sem reabertura da triagem nem criação de tarefas.
- [ ] Classificar uma publicação, criar dois acompanhamentos, concluir somente um e conferir a independência dos estados.
- [ ] Conferir publicações, compromissos e audiências na pasta; confirmar datas fatais manualmente.
- [ ] Sair de A e entrar em B no mesmo navegador; conferir isolamento. Abrir nova sessão/dispositivo de A e conferir os dados confirmados.
- [ ] Exportar backup online; testar restauração em ambiente controlado para a mesma conta/UUID e definir periodicidade dos backups.
- [ ] João revisar/subir o repositório e publicar na Vercel; nenhuma publicação foi feita por esta entrega.

**Pendentes de validação externa na entrega:** projeto Supabase real, contas reais, carga DJEN da OAB efetiva, e-mail de recuperação, restauração do backup de produção e deploy Vercel. O aplicativo auxilia o controle; a agenda oficial e os prazos devem continuar sendo conferidos pelo advogado.
