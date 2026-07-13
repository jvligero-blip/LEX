// api/publicacoes.js
// Proxy para a API pública do DJEN (Diário de Justiça Eletrônico Nacional / CNJ).
// Resolve o CORS. O schema abaixo foi confirmado contra a resposta real da API.
//
//   GET /api/publicacoes?oab=507108&uf=SP&dias=60
//   GET /api/publicacoes?oab=507108&uf=SP&raw=1     <- JSON cru do CNJ
//
// Devolve os itens crus, com os nomes de campo originais. Quem triar e
// calcular prazo é o lex-sync.js, no cliente — assim a regra jurídica fica
// num lugar só, fácil de auditar.

const DJEN = 'https://comunicaapi.pje.jus.br/api/v1/comunicacao';

const isoMenosDias = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - Number(n));
  return d.toISOString().slice(0, 10);
};

export default async function handler(req, res) {
  const { oab, uf = 'SP', dias = '30', inicio, fim, processo, raw } = req.query;

  if (!oab && !processo) {
    return res.status(400).json({
      erro: 'Informe oab (com uf) ou processo.',
      exemplo: '/api/publicacoes?oab=507108&uf=SP&dias=60',
    });
  }

  const params = new URLSearchParams();
  if (oab) {
    params.set('numeroOab', String(oab).replace(/\D/g, ''));
    params.set('ufOab', String(uf).toUpperCase());
  }
  if (processo) params.set('numeroProcesso', String(processo).replace(/\D/g, ''));
  params.set('dataDisponibilizacaoInicio', inicio || isoMenosDias(dias));
  params.set('dataDisponibilizacaoFim', fim || new Date().toISOString().slice(0, 10));
  params.set('pagina', '1');
  params.set('itensPorPagina', '100');

  const url = `${DJEN}?${params.toString()}`;

  try {
    const r = await fetch(url, { headers: { Accept: 'application/json' } });

    if (!r.ok) {
      const corpo = await r.text();
      return res.status(502).json({
        erro: 'O DJEN respondeu com erro.',
        status: r.status,
        detalhe: corpo.slice(0, 400),
      });
    }

    const dados = await r.json();
    if (raw) return res.status(200).json(dados);

    // Publicação sai uma vez por dia — não precisa bater no CNJ a cada clique.
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');

    return res.status(200).json({
      total: dados.count ?? (dados.items || []).length,
      periodo: {
        inicio: params.get('dataDisponibilizacaoInicio'),
        fim: params.get('dataDisponibilizacaoFim'),
      },
      // Campos confirmados em cada item: id, data_disponibilizacao, siglaTribunal,
      // tipoComunicacao, nomeOrgao, texto (HTML no eproc, texto puro no SAJ),
      // numero_processo, numeroprocessocommascara, tipoDocumento, nomeClasse,
      // link, destinatarios[], destinatarioadvogados[].
      items: dados.items || [],
    });
  } catch (e) {
    return res.status(500).json({ erro: 'Falha ao consultar o DJEN.', detalhe: String(e) });
  }
}
