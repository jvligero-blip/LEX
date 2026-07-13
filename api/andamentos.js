// api/andamentos.js
// Proxy para a API Pública do DataJud (CNJ). Traz a capa processual e as
// movimentações de um processo a partir do número CNJ.
//
// Uso:
//   GET /api/andamentos?processo=1001234-56.2025.8.26.0291
//   GET /api/andamentos?processo=...&tribunal=tjsp   (força o alias)
//
// ATENÇÃO — leia antes de confiar no dado:
// O DataJud é base de METADADOS com defasagem (semanas, às vezes meses).
// Serve para panorama e gestão de carteira. NÃO serve para prazo fatal.
// Prazo se confere no eproc e no DJEN. Sempre.
//
// A chave é pública (o CNJ a divulga na wiki), mas fica em env var porque
// o CNJ pode trocá-la a qualquer momento — assim você atualiza sem redeploy
// de código.

const DATAJUD_BASE = 'https://api-publica.datajud.cnj.jus.br';

// Deriva o alias do tribunal a partir do número CNJ: NNNNNNN-DD.AAAA.J.TR.OOOO
// J = segmento do Judiciário, TR = tribunal.
function aliasPeloNumeroCNJ(numero) {
  const d = String(numero).replace(/\D/g, '');
  if (d.length !== 20) return null;
  const j = d.slice(13, 14);   // segmento
  const tr = d.slice(14, 16);  // tribunal

  if (j === '8') {
    // Justiça Estadual. 26 = SP.
    const estaduais = {
      '26': 'tjsp', '19': 'tjrj', '13': 'tjmg', '21': 'tjrs', '24': 'tjsc',
      '16': 'tjpr', '05': 'tjba', '06': 'tjce', '07': 'tjdft', '09': 'tjes',
      '17': 'tjpe', '02': 'tjal', '25': 'tjse', '11': 'tjgo',
    };
    return estaduais[tr] || null;
  }
  if (j === '4') return `trf${Number(tr)}`;       // Justiça Federal
  if (j === '5') return `trt${Number(tr)}`;       // Justiça do Trabalho
  if (j === '3') return 'stj';
  return null;
}

export default async function handler(req, res) {
  const { processo, tribunal, raw } = req.query;

  if (!processo) {
    return res.status(400).json({
      erro: 'Informe o número CNJ do processo.',
      exemplo: '/api/andamentos?processo=1001234-56.2025.8.26.0291',
    });
  }

  const alias = tribunal || aliasPeloNumeroCNJ(processo);
  if (!alias) {
    return res.status(400).json({
      erro: 'Não consegui identificar o tribunal pelo número. Passe ?tribunal=tjsp explicitamente.',
    });
  }

  const apiKey = process.env.DATAJUD_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ erro: 'DATAJUD_API_KEY não configurada nas variáveis de ambiente da Vercel.' });
  }

  const numeroLimpo = String(processo).replace(/\D/g, '');
  const url = `${DATAJUD_BASE}/api_publica_${alias}/_search`;

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `APIKey ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: { match: { numeroProcesso: numeroLimpo } } }),
    });

    if (!r.ok) {
      const corpo = await r.text();
      return res.status(502).json({
        erro: 'O DataJud respondeu com erro.',
        status: r.status,
        dica: r.status === 429 ? 'Limite de requisições. Espalhe as consultas no tempo.' : undefined,
        detalhe: corpo.slice(0, 500),
      });
    }

    const dados = await r.json();
    if (raw) return res.status(200).json(dados);

    const hits = dados?.hits?.hits || [];
    if (!hits.length) {
      return res.status(200).json({
        encontrado: false,
        aviso: 'Processo não localizado no DataJud. Pode ser defasagem de carga do tribunal, sigilo, ou número incorreto.',
        tribunalConsultado: alias,
      });
    }

    const p = hits[0]._source;
    const movimentos = (p.movimentos || [])
      .map((m) => ({
        codigo: m.codigo,
        nome: m.nome,
        data: m.dataHora,
        complementos: (m.complementosTabelados || []).map((c) => c.nome),
      }))
      .sort((a, b) => String(b.data).localeCompare(String(a.data)));

    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');

    return res.status(200).json({
      encontrado: true,
      tribunal: alias,
      numeroProcesso: p.numeroProcesso,
      classe: p.classe?.nome || null,
      assuntos: (p.assuntos || []).map((a) => a.nome),
      orgaoJulgador: p.orgaoJulgador?.nome || null,
      grau: p.grau || null,
      dataAjuizamento: p.dataAjuizamento || null,
      ultimaAtualizacao: p.dataHoraUltimaAtualizacao || null,
      ultimoMovimento: movimentos[0] || null,
      movimentos,
      aviso: 'Metadados do DataJud, com defasagem. Não use para contagem de prazo.',
    });
  } catch (e) {
    return res.status(500).json({ erro: 'Falha ao consultar o DataJud.', detalhe: String(e) });
  }
}
