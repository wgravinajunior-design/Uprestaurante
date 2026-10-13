// Agenda de promoções, configurações da TV/painel, banners, health e upload de foto (cópia do banco).
const os = require('os');
const path = require('path');
const fs = require('fs');

// Isola configuração e cache do teste (não toca na configuração real)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'upweb-test-'));
process.env.CONFIG_DIR = path.join(tmp, 'config');
process.env.CACHE_DIR = path.join(tmp, 'cache');
fs.mkdirSync(process.env.CONFIG_DIR, { recursive: true });

const { garantirSchema } = require('./_guard');
const base = path.join(__dirname, '..', 'server') + '/';
const db = require(base + 'db');
const agenda = require(base + 'agenda');
const { startServer } = require(base + 'index');
const sharp = require('sharp');

let falhas = 0;
const ok = (n, c, x = '') => { if (!c) falhas++; console.log(c ? 'OK   ' : 'FALHA', n, x); };
const B = 'http://localhost:18080';
const j = async (u, o) => { const r = await fetch(B + u, o); const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t; } return { s: r.status, d }; };
const post = (u, body) => j(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const put = (u, body) => j(u, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const ymd = (off) => { const d = new Date(); d.setDate(d.getDate() + off); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

(async () => {
  await garantirSchema(db);
  // 900201 sem promo | 900202 promo ativa ate +10 | 900203 promo ativa ate +2 | 900204 sem promo (agenda x agenda)
  const seed = [
    [900201, 'SEM PROMO', 100, null, null, null],
    [900202, 'ATIVA ATE +10', 100, 80, ymd(-1), ymd(10)],
    [900203, 'ATIVA ATE +2', 100, 85, ymd(-1), ymd(2)],
    [900204, 'AGENDA X AGENDA', 100, 90, ymd(-1), ymd(30)],
  ];
  for (const [id, d, pv, pr, ini, fim] of seed) {
    await db.execute(`INSERT INTO TB_PRODUTO (PRD_ID, PRD_CODIGO, PRD_DESCRICAO, PRD_STATUS, PRD_UN_VENDA, PRD_TIPO_PRODUTO, PRD_PRECO_VENDA, PRD_VALOR_PROM, PRD_DT_INI_PROM, PRD_DT_FIM_PROM)
      VALUES (${id}, '${id}', '${d}', 'A', 'UN', 'N', ${pv}, ${pr === null ? 'NULL' : pr}, ${ini ? "'" + ini + "'" : 'NULL'}, ${fim ? "'" + fim + "'" : 'NULL'})`);
  }
  await startServer(18080, 18081, 18082);

  // --- health ---
  let r = await j('/api/health');
  ok('health ok', r.s === 200 && r.d.db === true);

  // --- agendamento direto (produto sem promocao) ---
  r = await post('/api/promotions/schedule', { produtoId: 900201, percentual: 20, dtInicio: ymd(5), dtFim: ymd(8) });
  let p = await db.getProductById(900201);
  ok('sem promo atual: grava direto (FUTURA)', r.s === 200 && r.d.data.modo === 'DIRETO' && p.precoPromocao === 80 && p.emPromocao === false && p.dtInicioProm === ymd(5), JSON.stringify(r.d.data));

  // --- conflito com promocao atual ---
  r = await post('/api/promotions/schedule', { produtoId: 900202, percentual: 30, dtInicio: ymd(3), dtFim: ymd(6) });
  ok('conflito com promoção atual: 409 sem forçar', r.s === 409 && r.d.codigo === 'CONFLITO' && r.d.detalhes.conflitos[0].tipo === 'PROMOCAO_ATUAL', JSON.stringify(r.d.detalhes && r.d.detalhes.conflitos));
  p = await db.getProductById(900202);
  ok('conflito não alterou a promoção atual', p.precoPromocao === 80 && p.emPromocao === true);

  r = await post('/api/promotions/schedule', { produtoId: 900202, percentual: 30, dtInicio: ymd(3), dtFim: ymd(6), forcar: true });
  ok('forçar: vai para a agenda (atual segue valendo)', r.s === 200 && r.d.data.modo === 'AGENDADA' && r.d.data.conflitos.length === 1);
  p = await db.getProductById(900202);
  ok('promoção atual preservada até o início', p.precoPromocao === 80 && p.emPromocao === true);

  // --- sem sobreposicao: agenda sem conflito ---
  r = await post('/api/promotions/schedule', { produtoId: 900203, percentual: 15, dtInicio: ymd(5), dtFim: ymd(9) });
  ok('sem sobreposição: agenda sem conflito', r.s === 200 && r.d.data.modo === 'AGENDADA' && r.d.data.conflitos.length === 0, JSON.stringify(r.d.data.modo));

  // --- agenda x agenda ---
  r = await post('/api/promotions/schedule', { produtoId: 900204, percentual: 10, dtInicio: ymd(40), dtFim: ymd(45) });
  ok('agenda 1 (900204)', r.s === 200 && r.d.data.modo === 'AGENDADA');
  const primeiro = r.d.data.id;
  r = await post('/api/promotions/schedule', { produtoId: 900204, percentual: 12, dtInicio: ymd(42), dtFim: ymd(50) });
  ok('agenda x agenda: 409', r.s === 409 && r.d.detalhes.conflitos.some((c) => c.tipo === 'AGENDADA'));
  r = await post('/api/promotions/schedule', { produtoId: 900204, percentual: 12, dtInicio: ymd(42), dtFim: ymd(50), forcar: true });
  ok('forçar substitui o agendamento anterior', r.s === 200);
  let lista = await j('/api/promotions/agenda');
  ok('lista da agenda: só pendentes (3)', lista.d.data.length === 3 && !lista.d.data.some((e) => e.id === primeiro), String(lista.d.data.length));
  ok('lista traz descrição do produto', lista.d.data.every((e) => e.descricao && e.descricao !== `Produto #${e.produtoId}`));
  const promo = await j('/api/promotions');
  ok('contagem de agendadas em /api/promotions', promo.d.data.contagem.agendadas === 3, String(promo.d.data.contagem.agendadas));

  // --- validacoes ---
  for (const [nome, body] of [
    ['início no passado', { produtoId: 900201, percentual: 10, dtInicio: ymd(-2) }],
    ['sem data de início', { produtoId: 900201, percentual: 10 }],
    ['fim antes do início', { produtoId: 900201, percentual: 10, dtInicio: ymd(5), dtFim: ymd(4) }],
    ['desconto 95%', { produtoId: 900201, percentual: 95, dtInicio: ymd(5) }],
    ['preço promocional >= venda', { produtoId: 900201, precoPromocao: 100, dtInicio: ymd(5) }],
    ['produto inexistente', { produtoId: 999999999, percentual: 10, dtInicio: ymd(5) }],
  ]) {
    r = await post('/api/promotions/schedule', body);
    ok('rejeita: ' + nome, r.s === 400 || r.s === 404, r.d.error);
  }

  // --- aplicacao automatica no dia do inicio ---
  const arquivo = path.join(process.env.CONFIG_DIR, 'promo_agenda.json');
  const dados = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  const alvo = dados.find((e) => e.produtoId === 900202 && e.status === 'AGENDADA');
  alvo.dtInicio = ymd(0); // "chegou o dia"
  fs.writeFileSync(arquivo, JSON.stringify(dados));
  const proc = await agenda.processarVencimentos();
  p = await db.getProductById(900202);
  ok('processarVencimentos aplicou a promoção do dia', proc.aplicadas === 1 && p.precoPromocao === 70 && p.dtFimProm === ymd(6), JSON.stringify([proc, p.precoPromocao, p.dtFimProm]));
  lista = await j('/api/promotions/agenda?todas=1');
  ok('entrada marcada como APLICADA', lista.d.data.some((e) => e.id === alvo.id && e.status === 'APLICADA'));

  // --- cancelar ---
  const pend = (await j('/api/promotions/agenda')).d.data[0];
  r = await j('/api/promotions/agenda/' + pend.id, { method: 'DELETE' });
  ok('cancelar agendamento', r.s === 200 && r.d.data.status === 'CANCELADA');
  r = await j('/api/promotions/agenda/' + pend.id, { method: 'DELETE' });
  ok('cancelar de novo: 400', r.s === 400);
  r = await j('/api/promotions/agenda/nao-existe', { method: 'DELETE' });
  ok('cancelar inexistente: 404', r.s === 404);

  // --- configuracoes de TV / painel / voz ---
  r = await j('/api/company');
  ok('padrões operacionais no /api/company', r.d.data.tvLayout === 'DESTAQUE' && r.d.data.alertaPreparoMin === 10 && r.d.data.vozAtiva === true);
  r = await put('/api/company/theme', { tvLayout: 'ROTACAO', tvDuracaoSeg: 12, alertaPreparoMin: 15, vozAtiva: false, tvGradeItens: 8 });
  r = await j('/api/company');
  ok('configurações salvas', r.d.data.tvLayout === 'ROTACAO' && r.d.data.tvDuracaoSeg === 12 && r.d.data.alertaPreparoMin === 15 && r.d.data.vozAtiva === false && r.d.data.tvGradeItens === 8);
  for (const body of [{ tvLayout: 'XYZ' }, { alertaPreparoMin: 0 }, { tvDuracaoSeg: 9999 }, { tvGradeItens: 'abc' }]) {
    r = await put('/api/company/theme', body);
    ok('rejeita config inválida ' + JSON.stringify(body), r.s === 400, r.d.error);
  }

  // --- banners ---
  const png = await sharp({ create: { width: 800, height: 450, channels: 3, background: { r: 10, g: 120, b: 200 } } }).png().toBuffer();
  const fd = new FormData(); fd.append('banner', new Blob([png], { type: 'image/png' }), 'b.png');
  r = await j('/api/tv/banners', { method: 'POST', body: fd });
  ok('upload de banner (PNG vira JPG)', r.s === 200 && r.d.data.length === 1 && /banner_\d+\.jpg$/.test(r.d.data[0].nome), JSON.stringify(r.d.data));
  const nome = r.d.data[0].nome;
  const file = await fetch(B + r.d.data[0].url);
  ok('arquivo do banner servido', file.status === 200 && file.headers.get('content-type').includes('image/jpeg'));
  const fd2 = new FormData(); fd2.append('banner', new Blob([Buffer.from('<svg onload=alert(1)>')], { type: 'image/svg+xml' }), 'x.svg');
  r = await j('/api/tv/banners', { method: 'POST', body: fd2 });
  ok('rejeita banner que não é imagem', r.s === 400);
  r = await j('/api/tv/banners/' + nome, { method: 'DELETE' });
  ok('remove banner', r.s === 200 && r.d.data.length === 0);
  r = await j('/api/tv/banners/..%2F..%2Fsegredo', { method: 'DELETE' });
  ok('nome de banner com traversal recusado', r.s === 400 || r.s === 404);

  // --- upload de foto grande e reduzida ---
  const grande = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: { r: 200, g: 50, b: 50 } } }).jpeg({ quality: 95 }).toBuffer();
  const fd3 = new FormData(); fd3.append('image', new Blob([grande], { type: 'image/jpeg' }), 'foto.jpg');
  r = await j('/api/products/900201/image', { method: 'POST', body: fd3 });
  ok('upload de foto grande', r.s === 200, JSON.stringify(r.d));
  const img = await fetch(B + '/api/products/900201/image'); const buf = Buffer.from(await img.arrayBuffer());
  const meta = await sharp(buf).metadata();
  ok('foto reduzida para no máximo 1600 px', meta.width === 1600 && buf.length < grande.length, `${meta.width}x${meta.height} ${buf.length}B (original ${grande.length}B)`);
  const fd4 = new FormData(); fd4.append('image', new Blob([Buffer.from('lixo qualquer')], { type: 'image/jpeg' }), 'x.jpg');
  r = await j('/api/products/900201/image', { method: 'POST', body: fd4 });
  ok('foto corrompida rejeitada', r.s === 400, r.d.error);

  // --- lote com inicio futuro passa pela agenda ---
  // 900201: ja tem promo futura (gravada direto) | 900203: tem promo ativa ate +2 e uma agendada
  r = await post('/api/products/batch', { ids: [900201, 900202], acao: 'PROMOCAO_PERCENTUAL', params: { percentual: 10, dtInicio: ymd(60), dtFim: ymd(61) } });
  ok('lote futuro: sem conflito agenda/grava', r.s === 200 && r.d.data.ok === 2, JSON.stringify(r.d.data.resultados));
  r = await post('/api/products/batch', { ids: [900201, 900202], acao: 'PROMOCAO_PERCENTUAL', params: { percentual: 20, dtInicio: ymd(60), dtFim: ymd(62) } });
  ok('lote futuro: conflito é reportado por produto', r.s === 200 && r.d.data.falhas >= 1 && r.d.data.resultados.some((x) => !x.ok && /Substituir/.test(x.erro)), JSON.stringify(r.d.data.resultados.map((x) => x.ok)));
  r = await post('/api/products/batch', { ids: [900201, 900202], acao: 'PROMOCAO_PERCENTUAL', params: { percentual: 20, dtInicio: ymd(60), dtFim: ymd(62), forcar: true } });
  ok('lote futuro: substituir resolve o conflito', r.s === 200 && r.d.data.falhas === 0, JSON.stringify(r.d.data.resultados.map((x) => x.detalhe || x.erro)));

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(falhas === 0 ? '\nTODOS OS TESTES PASSARAM' : `\n${falhas} FALHA(S)`);
  process.exit(falhas === 0 ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
