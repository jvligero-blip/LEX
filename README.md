# LEX V4.2

Atualização incremental sobre o pacote V4.1.1. Comece por [README-IMPLANTACAO-V4.2.md](README-IMPLANTACAO-V4.2.md), [ALTERACOES-V4.2.md](ALTERACOES-V4.2.md) e `TESTES-V4.2.txt`. Aplicar 008 depois de 007; nunca resetar a base. Sem deploy ou alteração de produção nesta entrega.

---

Histórico preservado da entrega anterior:

# LEX V4.1.1

Correção incremental de delegação e central de notificações sobre o commit `5043473` da V4.1.

Leia [instruções para João e Claude](LEIA-PRIMEIRO-NOTIFICACOES.md) e [testes efetivos](TESTES-NOTIFICACOES.txt).
Em base com migrations 001–006, aplicar somente a **007**, após backup, revisão e homologação. Preservar o mesmo Supabase/Auth. Não recriar banco ou convites.

`npm ci` · `npm run build` · `npm test` · `npm run dev`

As orientações anteriores [da V4](README-IMPLANTACAO-V4.md) e [da V3](README-IMPLANTACAO-V3.md) são referências históricas; não reaplicar suas migrations em uma base já atualizada.
