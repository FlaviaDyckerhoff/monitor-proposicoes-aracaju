const fs = require('fs');

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
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 Chrome/124', Accept: 'text/html' },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' em ' + url);
  const buf = await res.arrayBuffer();
  return new TextDecoder('iso-8859-1').decode(buf);
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
  'FIRJAN', 'Red Bull', 'Sindicerv', 'Boticario', 'Boticário', 'Abrasel', 'ANBRASEL',
  'Energisa', 'EnergisaLuz', 'SABESP', 'COMGAS', 'COMGÁS', 'Eletromidia', 'Eletromídia',
  'BRT', 'Regenera', 'Nova Infra', 'Seta', 'SETA', 'AkzoNobel', 'Expedia', 'RTSC',
  'Huawei', 'Carrefour', 'JBS', 'Ajinomoto', 'Vibra', 'Mindlab', 'ABVTEX', 'Neoenergia', 'ENEL'
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
  const rows = novas.map(p => '<tr><td style="padding:8px;border-bottom:1px solid #eee;white-space:nowrap"><a href="' + escapeHtml(p.link) + '"><b>' + escapeHtml(p.tipo + ' ' + p.numero + '/' + p.ano) + '</b></a><br><span style="color:#777;font-size:12px">' + escapeHtml(p.data || '-') + '</span></td><td style="padding:8px;border-bottom:1px solid #eee">' + escapeHtml(p.ementa) + '<br><span style="color:#777;font-size:12px">' + escapeHtml(p.situacao || '') + '</span></td></tr>').join('');
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
