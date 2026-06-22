const fs = require('fs');
const { spawnSync } = require('child_process');

const CASA = 'Camara Municipal de Aracaju';
const BASE = 'http://190.15.122.10:8080/sapl';
const ARQUIVO_ESTADO = 'estado.json';
const ANO = new Date().getFullYear();
const DATA_CORTE_PADRAO = ANO + '-01-01';

function carregarEstado() {
  if (fs.existsSync(ARQUIVO_ESTADO)) return JSON.parse(fs.readFileSync(ARQUIVO_ESTADO, 'utf8'));
  return { proposicoes_vistas: [], ultima_execucao: '', data_corte: DATA_CORTE_PADRAO };
}

function salvarEstado(estado) {
  fs.writeFileSync(ARQUIVO_ESTADO, JSON.stringify(estado, null, 2) + '\n');
}

function decodeHtml(texto) {
  return String(texto || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&Aacute;/g, 'Á').replace(/&aacute;/g, 'á')
    .replace(/&Eacute;/g, 'É').replace(/&eacute;/g, 'é')
    .replace(/&Iacute;/g, 'Í').replace(/&iacute;/g, 'í')
    .replace(/&Oacute;/g, 'Ó').replace(/&oacute;/g, 'ó')
    .replace(/&Uacute;/g, 'Ú').replace(/&uacute;/g, 'ú')
    .replace(/&Ccedil;/g, 'Ç').replace(/&ccedil;/g, 'ç')
    .replace(/&Atilde;/g, 'Ã').replace(/&atilde;/g, 'ã')
    .replace(/&Otilde;/g, 'Õ').replace(/&otilde;/g, 'õ')
    .replace(/&Ecirc;/g, 'Ê').replace(/&ecirc;/g, 'ê');
}

function stripHtml(html) {
  return decodeHtml(String(html || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function escapeHtml(texto) {
  return String(texto ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function brToIso(data) {
  const m = String(data || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? m[3] + '-' + m[2] + '-' + m[1] : '';
}

async function fetchLatin1(url) {
  const headers = { 'User-Agent': 'Mozilla/5.0 Chrome/124', Accept: 'text/html' };
  let ultimoErro;
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    try {
      const res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(90000),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status + ' em ' + url);
      const buf = await res.arrayBuffer();
      return new TextDecoder('iso-8859-1').decode(buf);
    } catch (err) {
      ultimoErro = err;
      console.log('Tentativa fetch ' + tentativa + ' falhou: ' + err.message);
      try {
        return fetchLatin1ComCurl(url, headers);
      } catch (curlErr) {
        ultimoErro = curlErr;
        console.log('Fallback curl falhou: ' + curlErr.message);
      }
      await sleep(5000 * tentativa);
    }
  }
  throw ultimoErro;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function fetchLatin1ComCurl(url, headers) {
  const args = ['-L', '-sS', '--fail', '--max-time', '90'];
  for (const [nome, valor] of Object.entries(headers)) {
    args.push('-H', nome + ': ' + valor);
  }
  args.push(url);
  const res = spawnSync('curl', args, { maxBuffer: 20 * 1024 * 1024 });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    throw new Error('curl exit ' + res.status + ': ' + String(res.stderr || '').trim());
  }
  return new TextDecoder('iso-8859-1').decode(res.stdout);
}

function pesquisarUrl(dataInicial, dataFinal) {
  const p = new URLSearchParams({
    incluir: '0',
    existe_ocorrencia: '0',
    lst_tip_materia: '',
    txt_numero: '',
    txt_ano: String(ANO),
    txt_npc: '',
    dt_apres: dataInicial,
    dt_apres2: dataFinal,
    dt_public: '',
    dt_public2: '',
    txt_autor: '',
    hdn_txt_autor: '',
    hdn_cod_autor: '',
    lst_tip_autor: '',
    lst_cod_partido: '',
    lst_localizacao: '',
    lst_status: '',
    rad_tramitando: '',
    txt_assunto: '',
    txt_relator: '',
    btn_materia_pesquisar: 'Pesquisar',
  });
  return BASE + '/generico/materia_pesquisar_proc?' + p.toString();
}

function isoToBr(iso) {
  const [y, m, d] = String(iso || '').split('-');
  return y && m && d ? d + '/' + m + '/' + y : '01/01/' + ANO;
}

function hojeBr() {
  return new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function extrairProposicoes(html) {
  const itens = [];
  const blocos = html.split(/<tr>\s*<td class="texto">/i).slice(1);
  for (const bloco of blocos) {
    const linkMatch = bloco.match(/href="([^"]*materia_mostrar_proc\?cod_materia=(\d+)[^"]*)"[\s\S]*?<b>([^<]+)<\/b>/i);
    if (!linkMatch) continue;
    const [, href, id, tituloRaw] = linkMatch;
    const titulo = stripHtml(tituloRaw);
    const mTitulo = titulo.match(/^([A-Z]+)\s+([\d.]+)\/(\d{4})\s+-\s+(.+)$/i);
    const tipo = mTitulo ? mTitulo[1].toUpperCase() : titulo.split(' ')[0].toUpperCase();
    const numero = mTitulo ? mTitulo[2].replace(/\D/g, '') : '';
    const ano = mTitulo ? mTitulo[3] : String(ANO);
    const tipoNome = mTitulo ? stripHtml(mTitulo[4]) : titulo;
    const aposTitulo = bloco.slice(linkMatch.index + linkMatch[0].length);
    const ementa = stripHtml(aposTitulo.split(/<br\s*\/?>(?:\s*<b>Autor:|\s*<\/td>)/i)[0]);
    const autorMatch = bloco.match(/<b>Autor:<\/b>[\s\S]*?<br>\s*([\s\S]*?)<br>/i);
    const autor = autorMatch ? stripHtml(autorMatch[1]) : '';
    const dataMatch = bloco.match(/<b>Em:<\/b>&nbsp;([\d/]+)/i);
    const dataUltimaAcao = dataMatch ? dataMatch[1] : '';
    const situacaoMatch = bloco.match(/<b>Situa[^<]*<\/b>\s*([^<]+)<br>/i);
    const situacao = situacaoMatch ? stripHtml(situacaoMatch[1]) : '';
    const ultimaAcaoMatch = bloco.match(/<b>[^<]*ltima A[^<]*<\/b>\s*([\s\S]*?)<br>/i);
    const ultimaAcao = ultimaAcaoMatch ? stripHtml(ultimaAcaoMatch[1]) : '';
    const link = href.startsWith('http') ? href : BASE + '/' + href.replace(/^\//, '');
    itens.push({ id: String(id), tipo, tipoNome, numero, ano, ementa, autor, situacao, ultimaAcao, data: dataUltimaAcao, dataIso: brToIso(dataUltimaAcao), link });
  }
  return itens;
}

const CLIENTES_NOMES_PROPRIOS = [
  'FIRJAN', 'Red Bull', 'Sindicerv', 'Boticario',
  'Boticário', 'Grupo Boticario', 'Grupo Boticário', 'O Boticario',
  'O Boticário', 'Abrasel', 'Abrasel PB', 'Abrasel Paraíba',
  'ANBRASEL', 'Ambev', 'Heineken', 'Abralatas',
  'ABIR', 'Coca-Cola', 'Coca Cola', 'Coca-Cola Company',
  'Femsa', 'Solar', 'Grupo Simões', 'Grupo Simoes',
  'Andina', 'CVI', 'iFood', 'Zé Delivery',
  'Ze Delivery', 'Verde Brasil', 'JCRIG', 'Associação dos Cemitérios e Crematórios do Brasil',
  'Associacao dos Cemiterios e Crematorios do Brasil', 'Lalamove', 'Matrix', 'CVC',
  'Rei do Pitaco', 'Maersk', 'Mac Jee', 'Norte Energia',
  'Pacto Pela Fome', 'Sanofi', 'TikTok', 'Minalba',
  'Esmaltec', 'Nacional Gás', 'Nacional Gas', 'Syngenta',
  'Braskem', 'Ypê', 'Ype', 'VTal',
  'V.tal', 'Grupo EPR', 'EPR', 'Natural Energia',
  'DIAGEO', 'Alpargatas', 'Ternium', 'ABRADEE',
  'Eletrobras', 'Eletrobrás', 'MeetKai', 'IPQ',
  'Equatorial', 'EquatorialEnergia', 'Equatorial Energia', 'Equatorial Goiás',
  'Equatorial Goias', 'Equatorial Goiás Distribuidora de Energia', 'Equatorial Goias Distribuidora de Energia', 'CEA Equatorial',
  'CEA Equatorial Energia', 'Equtorial', 'Energisa', 'EnergisaLuz',
  'Neoenergia', 'ENEL', 'Ampla Energia', 'SABESP',
  'COMGAS', 'COMGÁS', 'AEGEA', 'Aegea Saneamento',
  'Águas de Teresina', 'Aguas de Teresina', 'Águas de Timon', 'Aguas de Timon',
  'Águas do Rio', 'Aguas do Rio', 'Águas do Rio 1', 'Águas do Rio 4',
  'Naturgy', 'Agenersa', 'Regenera', 'Comlurb',
  'Hekos', 'Orizon', 'Solvi', 'União Norte',
  'Uniao Norte', 'Vital', 'Eletromidia', 'Eletromídia',
  'AkzoNobel', 'Expedia', 'Hotels.com', 'Vrbo',
  'RTSC', 'Gramado Parks', 'Grupo Wish', 'Huawei',
  'Carrefour', 'Atacadão', 'Atacadao', 'Walmart',
  "Sam's Club", 'Sams Club', 'JBS', 'Friboi',
  'Seara', 'Swift', "Pilgrim's", 'Pilgrims',
  'Wild Fork', 'Ajinomoto', 'Vibra', 'Vibra Energia',
  'BR Distribuidora', 'Raízen', 'Raizen', 'Mindlab',
  'ABVTEX', 'Semove', 'Barcas', 'Seta',
  'Nova Infra', 'BRT'
];

function anotarClientesCitados(proposicoes) {
  for (const p of proposicoes || []) {
    const texto = [p.tipo, p.tipoNome, p.ementa, p.autor].join(' ');
    const achados = [];
    for (const nome of CLIENTES_NOMES_PROPRIOS) {
      const escaped = nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp('(^|[^A-Za-zÀ-ÿ0-9])' + escaped + '([^A-Za-zÀ-ÿ0-9]|$)', 'i');
      if (re.test(texto)) achados.push(nome);
    }
    if (achados.length) p.ementa += ' | Cliente citado: ' + Array.from(new Set(achados)).join(', ');
  }
}

async function buscarProposicoes(dataCorte) {
  const html = await fetchLatin1(pesquisarUrl(isoToBr(dataCorte), hojeBr()));
  const proposicoes = extrairProposicoes(html);
  console.log('Proposicoes encontradas: ' + proposicoes.length);
  return proposicoes.filter(p => !p.dataIso || p.dataIso >= dataCorte);
}

function mlEscapeHtmlClienteDestaque(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function mlEscapeRegExpClienteDestaque(valor) {
  return String(valor).replace(/[.*+?^\${}()|[\]\\]/g, '\\$&');
}

function mlDestacarTermosClienteEmail(texto, clientes) {
  const nomes = Array.from(new Set([...(clientes || []), ...CLIENTES_NOMES_PROPRIOS]))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  if (!nomes.length) return mlEscapeHtmlClienteDestaque(texto);

  const regex = new RegExp('(^|[^A-Za-zÀ-ÿ0-9])(' + nomes.map(mlEscapeRegExpClienteDestaque).join('|') + ')(?=[^A-Za-zÀ-ÿ0-9]|$)', 'gi');
  return mlEscapeHtmlClienteDestaque(texto).replace(regex, (match, prefixo, termo) => {
    return prefixo + '<span style="background:#dbeafe;color:#1e3a8a;font-weight:700;border-radius:3px;padding:1px 3px">' + termo + '</span>';
  });
}

function renderizarEmentaCliente(p, renderBase) {
  const texto = String((p && p.ementa) || '-');
  const partes = texto.split(/\s+\|\s+Cliente citado:\s+/i);
  const ementa = renderBase
    ? renderBase(partes[0])
    : mlDestacarTermosClienteEmail(partes[0], p && p.clientesCitados);
  const clientes = partes.length > 1
    ? partes.slice(1).join(' | Cliente citado: ')
    : ((p && p.clientesCitados) || []).join(', ');

  if (!clientes) return ementa;
  return ementa + '<div style="margin-top:6px">' +
    '<span style="display:inline-block;background:#eef6ff;border:1px solid #bfdbfe;color:#1e3a8a;border-radius:999px;padding:3px 8px;font-size:11px;font-weight:700">' +
    'Cliente citado: ' + mlDestacarTermosClienteEmail(clientes, p && p.clientesCitados) +
    '</span></div>';
}

async function enviarEmail(novas) {
  anotarClientesCitados(novas);
  if (process.env.DRY_RUN_EMAIL === 'true') {
    console.log('DRY_RUN_EMAIL=true — email nao enviado. Novas: ' + novas.length);
    novas.forEach(p => console.log(p.tipo + ' ' + p.numero + '/' + p.ano + ' — ' + p.ementa + ' — ' + p.link));
    return;
  }
  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_REMETENTE, pass: process.env.EMAIL_SENHA },
  });
  const rows = novas.map(p => '<tr><td style="padding:8px;border-bottom:1px solid #eee;white-space:nowrap"><a href="' + escapeHtml(p.link) + '"><b>' + escapeHtml(p.tipo + ' ' + p.numero + '/' + p.ano) + '</b></a><br><span style="color:#777;font-size:12px">' + escapeHtml(p.data || '-') + '</span></td><td style="padding:8px;border-bottom:1px solid #eee">' + renderizarEmentaCliente(p) + '<br><span style="color:#777;font-size:12px">' + escapeHtml(p.situacao || '') + '</span></td></tr>').join('');
  const html = '<div style="font-family:Arial,sans-serif;max-width:900px"><h2>Camara Municipal de Aracaju — ' + novas.length + ' nova(s) proposicao(oes)</h2><table style="width:100%;border-collapse:collapse">' + rows + '</table><p><a href="' + pesquisarUrl('01/01/' + ANO, hojeBr()) + '">Fonte oficial</a></p></div>';
  await transporter.sendMail({
    from: '"Monitor Aracaju" <' + process.env.EMAIL_REMETENTE + '>',
    to: process.env.EMAIL_DESTINO,
    subject: '🏛️ Aracaju: ' + novas.length + ' nova(s) proposição(ões) — ' + new Date().toLocaleDateString('pt-BR'),
    html,
  });
  console.log('Email enviado com ' + novas.length + ' proposicoes novas.');
}

(async () => {
  const estado = carregarEstado();
  const dataCorte = estado.data_corte || DATA_CORTE_PADRAO;
  const vistas = new Set((estado.proposicoes_vistas || []).map(String));
  const proposicoes = await buscarProposicoes(dataCorte);
  const novas = proposicoes.filter(p => !vistas.has(p.id));
  console.log('Novas: ' + novas.length);
  if (process.env.SEED_ONLY === 'true') {
    proposicoes.forEach(p => vistas.add(p.id));
    estado.proposicoes_vistas = Array.from(vistas);
    estado.ultima_execucao = new Date().toISOString();
    salvarEstado(estado);
    console.log('SEED_ONLY=true — estado semeado sem envio.');
    return;
  }
  if (novas.length) {
    await enviarEmail(novas);
    novas.forEach(p => vistas.add(p.id));
  }
  estado.proposicoes_vistas = Array.from(vistas);
  estado.ultima_execucao = new Date().toISOString();
  salvarEstado(estado);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
