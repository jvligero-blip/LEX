/* ============================================================================
   lex-sync.js — Sincronização do Lex com o CNJ   (v2 — schema real do DJEN)
   ----------------------------------------------------------------------------
   O que a resposta de verdade da API ensinou, e que mudou o desenho:

   1. O texto da intimação quase sempre DIZ o prazo — "no prazo de 10 dias",
      "no prazo de 05 (cinco) dias". Ler isso é muito melhor do que adivinhar
      pelo tipo do ato. A extração virou o motor principal; a classificação
      por palavra-chave é só a rede de segurança.
   2. O campo `texto` vem em HTML cru no eproc e em texto puro no SAJ.
      Tem que limpar antes de qualquer coisa.
   3. Boa parte das publicações não gera prazo nenhum (ata de sessão, pauta,
      lista de distribuição, expedição de alvará). Filtrar isso é o que separa
      um painel útil de um painel que ninguém abre.
   4. Audiência designada vem cravada no meio do ato ordinatório. Dá para pegar.
   ========================================================================== */

/* ---------------------------------------------------------------------------
   CALENDÁRIO FORENSE — ATUALIZE TODO ANO, conferindo o Provimento do CSM/TJSP.
--------------------------------------------------------------------------- */
export const FERIADOS = [
  '2026-01-01', '2026-02-16', '2026-02-17', '2026-02-18', '2026-04-03',
  '2026-04-21', '2026-05-01', '2026-06-04', '2026-07-09', '2026-08-11',
  '2026-09-07', '2026-10-12', '2026-10-28', '2026-11-02', '2026-11-15',
  '2026-11-20', '2026-12-08', '2026-12-25',
];

// Art. 220 do CPC: prazos suspensos de 20/12 a 20/01.
const emSuspensao = (d) => {
  const m = d.getMonth() + 1, dia = d.getDate();
  return (m === 12 && dia >= 20) || (m === 1 && dia <= 20);
};

const iso = (d) => d.toISOString().slice(0, 10);

export function ehDiaUtil(data, feriados = FERIADOS) {
  const s = data.getDay();
  return s !== 0 && s !== 6 && !feriados.includes(iso(data)) && !emSuspensao(data);
}

const proximoDiaUtil = (data, feriados) => {
  const d = new Date(data);
  do { d.setDate(d.getDate() + 1); } while (!ehDiaUtil(d, feriados));
  return d;
};

/* ---------------------------------------------------------------------------
   MOTOR DE PRAZO   (arts. 219 e 224, §§ 2º e 3º, do CPC)
   disponibilização -> publicação (1º dia útil seguinte)
                    -> início da contagem (1º dia útil seguinte à publicação)
                    -> vencimento (+ N dias úteis)
--------------------------------------------------------------------------- */
export function calcularPrazo(dataDisponibilizacao, diasUteis, feriados = FERIADOS) {
  const disp = new Date(`${String(dataDisponibilizacao).slice(0, 10)}T12:00:00`);
  if (isNaN(disp) || !diasUteis) return null;

  const publicacao = proximoDiaUtil(disp, feriados);
  let cursor = proximoDiaUtil(publicacao, feriados);
  for (let i = 1; i < diasUteis; i++) cursor = proximoDiaUtil(cursor, feriados);

  return {
    disponibilizacao: iso(disp),
    publicacao: iso(publicacao),
    inicioContagem: iso(proximoDiaUtil(publicacao, feriados)),
    vencimento: iso(cursor),
    diasUteis,
  };
}

export function diasRestantes(vencimento, feriados = FERIADOS) {
  const alvo = new Date(`${vencimento}T12:00:00`);
  const hoje = new Date(); hoje.setHours(12, 0, 0, 0);
  if (iso(alvo) < iso(hoje)) return -1;              // vencido
  let n = 0;
  const d = new Date(hoje);
  while (iso(d) < iso(alvo)) {
    d.setDate(d.getDate() + 1);
    if (ehDiaUtil(d, feriados)) n++;
  }
  return n;
}

/* ---------------------------------------------------------------------------
   LIMPEZA — o eproc despeja um HTML inteiro dentro do campo `texto`.
--------------------------------------------------------------------------- */
const ENTIDADES = {
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú',
  Atilde: 'Ã', Otilde: 'Õ', atilde: 'ã', otilde: 'õ',
  Ccedil: 'Ç', ccedil: 'ç', Ecirc: 'Ê', ecirc: 'ê', acirc: 'â', ocirc: 'ô',
  // O eproc escreve "&agrave;s 15:00". Sem isto, a hora da audiência se perde.
  Agrave: 'À', agrave: 'à', Egrave: 'È', egrave: 'è',
  ordm: 'º', ordf: 'ª', sect: '§', nbsp: ' ', amp: '&', quot: '"',
};

export function limparTexto(html = '') {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&([a-zA-Z]+);/g, (m, e) => ENTIDADES[e] ?? ' ')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ---------------------------------------------------------------------------
   ATOS QUE NÃO GERAM PRAZO — para não entulhar o painel.
--------------------------------------------------------------------------- */
const SEM_PRAZO_TIPO = [/ata de sess/i, /lista de distribui/i, /pauta/i];
const SEM_PRAZO_TEXTO = [
  /arquivem-se definitivamente/i,
  /expedi[çc][ãa]o de alvar/i,
  /processo sigiloso/i,
  /distribuido para/i,
];

export function geraPrazo(tipoDocumento = '', texto = '') {
  if (SEM_PRAZO_TIPO.some((r) => r.test(tipoDocumento))) return false;
  if (SEM_PRAZO_TEXTO.some((r) => r.test(texto))) return false;
  return true;
}

/* ---------------------------------------------------------------------------
   EXTRAÇÃO DO PRAZO — o texto costuma declarar quantos dias são.
--------------------------------------------------------------------------- */
const EXTENSO = { tres: 3, 'três': 3, cinco: 5, dez: 10, quinze: 15, vinte: 20, trinta: 30 };

export function extrairDias(texto = '') {
  const num = texto.match(/prazo\s+de\s+(\d{1,2})\s*(?:\([^)]*\))?\s*dias/i);
  if (num) return { dias: parseInt(num[1], 10), fonte: 'texto da intimação' };

  const ext = texto.match(/prazo\s+de\s+([a-zA-Zçãéêóô]+)\s+dias/i);
  const chave = ext && ext[1].toLowerCase();
  if (chave && EXTENSO[chave]) return { dias: EXTENSO[chave], fonte: 'texto da intimação' };

  return null;
}

/* ---------------------------------------------------------------------------
   CLASSIFICAÇÃO — entra em cena quando o texto não declarou o prazo.
   Art. 218, §3º, do CPC: sem prazo fixado em lei ou pelo juiz, são 5 dias.
--------------------------------------------------------------------------- */
const REGRAS = [
  { tipo: 'Embargos',     dias: 5,  teste: (t) => /embargos de declara/i.test(t) },
  { tipo: 'Recurso',      dias: 10, teste: (t, d) => /senten[çc]a/i.test(d) && /juizado especial/i.test(t) },
  { tipo: 'Apelação',     dias: 15, teste: (t, d) => /senten[çc]a/i.test(d) },
  { tipo: 'Contestação',  dias: 15, teste: (t) => /contesta[çc]|apresentar defesa/i.test(t) },
  { tipo: 'Impugnação',   dias: 15, teste: (t) => /impugna[çc][ãa]o|cumprimento de senten[çc]a/i.test(t) },
  { tipo: 'Manifestação', dias: 5,  teste: (t) => /manifeste-se|manifestar-se|requerendo o que de direito/i.test(t) },
  { tipo: 'Juntada',      dias: 5,  teste: (t) => /junte|emende|apresente documento/i.test(t) },
];

export function classificar(texto = '', tipoDocumento = '') {
  const extraido = extrairDias(texto);
  for (const r of REGRAS) {
    if (r.teste(texto, tipoDocumento)) {
      return {
        tipo: r.tipo,
        dias: extraido?.dias ?? r.dias,
        fonte: extraido?.fonte ?? 'regra padrão do tipo de ato',
      };
    }
  }
  if (extraido) return { tipo: 'Outro', dias: extraido.dias, fonte: extraido.fonte };
  return { tipo: 'Outro', dias: 5, fonte: 'art. 218, §3º, CPC — prazo supletivo' };
}

/* ---------------------------------------------------------------------------
   AUDIÊNCIA
--------------------------------------------------------------------------- */
export function extrairAudiencia(texto = '') {
  const m = texto.match(/audi[êe]ncia[\s\S]{0,80}?para o dia\s+(\d{2}\/\d{2}\/\d{4})(?:\s*[àa]s\s*(\d{1,2}:\d{2}))?/i);
  if (!m) return null;
  const [dia, mes, ano] = m[1].split('/');
  return {
    data: `${ano}-${mes}-${dia}`,
    hora: m[2] || null,
    virtual: /teams|videoconfer|h[íi]brida/i.test(texto),
  };
}

/* ---------------------------------------------------------------------------
   SINCRONIZAÇÃO
--------------------------------------------------------------------------- */
export async function buscarPublicacoes({ oab, uf = 'SP', dias = 30 }) {
  const r = await fetch(`/api/publicacoes?oab=${encodeURIComponent(oab)}&uf=${uf}&dias=${dias}`);
  if (!r.ok) throw new Error(`DJEN respondeu ${r.status}`);
  return r.json();
}

export async function buscarAndamento(numeroProcesso) {
  const r = await fetch(`/api/andamentos?processo=${encodeURIComponent(numeroProcesso)}`);
  if (!r.ok) throw new Error(`DataJud respondeu ${r.status}`);
  return r.json();
}

const soDigitos = (s) => String(s || '').replace(/\D/g, '');

/**
 * Recebe os `items` crus do DJEN e devolve tudo separado por destino no Lex.
 * Nada aqui vira prazo sozinho: o que sai é sugestão, para você aprovar.
 */
export function triar(items = [], processosCadastrados = []) {
  const cadastrados = new Set(processosCadastrados.map(soDigitos));
  const out = { prazos: [], audiencias: [], publicacoes: [], semPrazo: [], orfaos: new Set() };

  for (const it of items) {
    const texto = limparTexto(it.texto);
    const numero = it.numeroprocessocommascara || it.numero_processo;
    const partes = (it.destinatarios || []).map((d) => d.nome).filter((n) => n !== 'SIGILO');

    out.publicacoes.push({
      idCNJ: it.id,
      data: it.data_disponibilizacao,
      tribunal: it.siglaTribunal,
      orgao: it.nomeOrgao,
      processo: numero,
      classe: it.nomeClasse,
      tipoDocumento: it.tipoDocumento,
      partes,
      conteudo: texto,
      link: it.link,
    });

    if (!cadastrados.has(soDigitos(numero))) out.orfaos.add(numero);

    const audiencia = extrairAudiencia(texto);
    if (audiencia) {
      out.audiencias.push({ processo: numero, ...audiencia, vara: it.nomeOrgao, partes });
      continue;
    }

    if (!geraPrazo(it.tipoDocumento, texto)) {
      out.semPrazo.push({ processo: numero, tipoDocumento: it.tipoDocumento, resumo: texto.slice(0, 120) });
      continue;
    }

    const { tipo, dias, fonte } = classificar(texto, it.tipoDocumento);
    const prazo = calcularPrazo(it.data_disponibilizacao, dias);
    if (!prazo) continue;

    const restam = diasRestantes(prazo.vencimento);
    out.prazos.push({
      processo: numero,
      tipo,
      descricao: texto.slice(0, 180),
      fonteDoPrazo: fonte,
      ...prazo,
      restam,
      status: restam < 0 ? 'Atrasado' : 'Pendente',
      confirmado: false,           // só vira prazo de verdade com o seu aval
      origem: 'DJEN',
      link: it.link,
    });
  }

  out.prazos.sort((a, b) => a.vencimento.localeCompare(b.vencimento));
  out.orfaos = [...out.orfaos];
  return out;
}

if (typeof window !== 'undefined') {
  window.LexSync = {
    triar, buscarPublicacoes, buscarAndamento, calcularPrazo, diasRestantes,
    limparTexto, extrairDias, extrairAudiencia, classificar, geraPrazo, ehDiaUtil, FERIADOS,
  };
}
