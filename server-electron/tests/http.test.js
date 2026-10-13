// Teste de integração HTTP (promoções, lote, miniaturas, eventos) contra uma CÓPIA do banco.
const { garantirSchema } = require('./_guard');
const base = require('path').join(__dirname, '..', 'server') + '/';
const db = require(base + 'db');
const { startServer } = require(base + 'index');
const sharp = require('sharp');

let falhas = 0;
const ok = (n, c, x = '') => { if (!c) falhas++; console.log(c ? 'OK   ' : 'FALHA', n, x); };
const B = 'http://localhost:18080';
const j = async (u, o) => { const r = await fetch(B + u, o); const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t; } return { s: r.status, d }; };
const post = (u, body) => j(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const ymd = (off) => { const d = new Date(); d.setDate(d.getDate() + off); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

(async () => {
  await garantirSchema(db);
  // seed: 5 produtos (copia)
  const prods = [
    [900101, 'ATIVA SEM FIM', 10, 8, null, null],
    [900102, 'ATIVA EXPIRA EM 2 DIAS', 20, 15, ymd(-5), ymd(2)],
    [900103, 'FUTURA', 30, 25, ymd(5), ymd(10)],
    [900104, 'VENCIDA', 40, 30, ymd(-20), ymd(-3)],
    [900105, 'SEM PROMO', 50, null, null, null],
  ];
  for (const [id, d, pv, pr, ini, fim] of prods) {
    await db.execute(`INSERT INTO TB_PRODUTO (PRD_ID, PRD_CODIGO, PRD_DESCRICAO, PRD_STATUS, PRD_UN_VENDA, PRD_TIPO_PRODUTO, PRD_PRECO_VENDA, PRD_VALOR_PROM, PRD_DT_INI_PROM, PRD_DT_FIM_PROM)
      VALUES (${id}, '${id}', '${d}', 'A', 'UN', 'N', ${pv}, ${pr === null ? 'NULL' : pr}, ${ini ? `'${ini}'` : 'NULL'}, ${fim ? `'${fim}'` : 'NULL'})`);
  }
  await startServer(18080, 18081, 18082);

  // --- promocoes ---
  let r = await j('/api/promotions');
  const c = r.d.data.contagem;
  ok('promocoes: contagem', r.s === 200 && c.todas === 4 && c.ativas === 2 && c.expirando === 1 && c.futuras === 1 && c.vencidas === 1, JSON.stringify(c));
  r = await j('/api/promotions?estado=VENCIDAS');
  ok('promocoes: filtro vencidas', r.d.data.itens.length === 1 && r.d.data.itens[0].id === 900104 && r.d.data.itens[0].diasParaFim === -3);
  r = await j('/api/promotions?estado=EXPIRANDO&dias=3');
  ok('promocoes: expirando', r.d.data.itens.length === 1 && r.d.data.itens[0].id === 900102 && r.d.data.itens[0].diasParaFim === 2);

  // --- eventos em tempo real ---
  const eventos = [];
  const ac = new AbortController();
  fetch(B + '/api/events', { signal: ac.signal }).then(async (res) => {
    const reader = res.body.getReader(); const dec = new TextDecoder();
    for (;;) { const { value, done } = await reader.read(); if (done) break;
      for (const m of dec.decode(value).matchAll(/event: (\w+)/g)) eventos.push(m[1]); }
  }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1200));
  ok('SSE conectado (hello)', eventos.includes('hello'), JSON.stringify(eventos));

  // --- lote ---
  r = await post('/api/products/batch', { ids: [900101, 900105], acao: 'PRECO_PERCENTUAL', params: { percentual: 10 } });
  ok('lote: reajuste +10%', r.s === 200 && r.d.data.ok === 2, JSON.stringify(r.d.data && r.d.data.resultados.map((x) => x.detalhe)));
  const p101 = await db.getProductById(900101);
  ok('lote: preco aplicado (10 -> 11)', p101.precoVenda === 11, String(p101.precoVenda));

  r = await post('/api/products/batch', { ids: [900105, 900101], acao: 'PROMOCAO_PERCENTUAL', params: { percentual: 20, dtFim: ymd(7) } });
  const p105 = await db.getProductById(900105);
  ok('lote: promocao -20% (55 -> 44) com fim', r.d.data.ok === 2 && p105.precoPromocao === 44 && p105.dtFimProm === ymd(7) && p105.emPromocao === true, JSON.stringify([p105.precoPromocao, p105.dtFimProm]));

  r = await post('/api/products/batch', { ids: [900104, 999999999], acao: 'PROMOCAO_REMOVER' });
  ok('lote: remover promocao + id inexistente isolado', r.d.data.ok === 1 && r.d.data.falhas === 1 && r.d.data.resultados[1].erro === 'Produto não encontrado', JSON.stringify(r.d.data.resultados.map((x) => x.ok)));

  r = await post('/api/products/batch', { ids: [900103], acao: 'STATUS', params: { status: 'I' } });
  ok('lote: inativar', r.d.data.ok === 1 && (await db.getProductById(900103)).status === 'I');

  for (const [nome, body] of [
    ['sem ids', { ids: [], acao: 'STATUS', params: { status: 'A' } }],
    ['acao invalida', { ids: [900101], acao: 'APAGAR' }],
    ['percentual absurdo', { ids: [900101], acao: 'PRECO_PERCENTUAL', params: { percentual: 5000 } }],
    ['desconto 100%', { ids: [900101], acao: 'PROMOCAO_PERCENTUAL', params: { percentual: 100 } }],
    ['fim no passado', { ids: [900101], acao: 'PROMOCAO_PERCENTUAL', params: { percentual: 10, dtFim: ymd(-1) } }],
    ['mais de 200', { ids: Array.from({ length: 201 }, (_, i) => i + 1), acao: 'STATUS', params: { status: 'A' } }],
  ]) { r = await post('/api/products/batch', body); ok('lote rejeita: ' + nome, r.s === 400, r.d.error); }

  r = await j('/api/promotions');
  ok('promocoes depois do lote: vencida removida', r.d.data.contagem.vencidas === 0, JSON.stringify(r.d.data.contagem));
  ok('SSE: evento products apos alteracao', eventos.includes('products'), JSON.stringify([...new Set(eventos)]));

  // --- miniaturas ---
  const jpg = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: { r: 200, g: 80, b: 40 } } }).jpeg({ quality: 95 }).toBuffer();
  const fd = new FormData(); fd.append('image', new Blob([jpg], { type: 'image/jpeg' }), 'x.jpg');
  r = await j('/api/products/900101/image', { method: 'POST', body: fd });
  ok('upload de imagem', r.s === 200, JSON.stringify(r.d));
  const full = await fetch(B + '/api/products/900101/image'); const fullBuf = Buffer.from(await full.arrayBuffer());
  const th = await fetch(B + '/api/products/900101/image?w=240'); const thBuf = Buffer.from(await th.arrayBuffer());
  const meta = await sharp(thBuf).metadata();
  ok('imagem original servida', full.status === 200 && fullBuf.length === jpg.length, `${fullBuf.length}B`);
  ok('miniatura 240px menor que original', th.status === 200 && meta.width === 240 && thBuf.length < fullBuf.length / 5, `${meta.width}px ${thBuf.length}B vs ${fullBuf.length}B`);

  // blob realmente gravado no banco (apaga o cache e le de novo)
  const fs = require('fs'), path = require('path');
  const cache = path.join(base, '..', 'cache');
  for (const n of fs.readdirSync(cache)) if (n.startsWith('prd_900101')) fs.unlinkSync(path.join(cache, n));
  await db.execute("UPDATE TB_PRODUTO SET PRD_FOTO = NULL WHERE PRD_ID = 900101");
  const again = await fetch(B + '/api/products/900101/image'); const againBuf = Buffer.from(await again.arrayBuffer());
  ok('BLOB persistido no banco (reler sem cache)', again.status === 200 && againBuf.equals(jpg), `${againBuf.length}B`);
  for (const n of fs.readdirSync(cache)) if (n.startsWith('prd_900101')) fs.unlinkSync(path.join(cache, n));

  // --- mudanca externa (simula o PDV) -> evento orders ---
  await new Promise((r) => setTimeout(r, 3500)); // deixa a vigia formar a linha de base
  const antes = eventos.filter((e) => e === 'orders').length;
  await db.execute("INSERT INTO TB_PEDIDO_VENDA (PEV_EMPRESA, PEV_ID, PEV_DT_EMISSAO, PEV_DT_LANCAMENTO, PEV_VALOR_TOTAL, PEV_STATUS, PEV_SENHA, PEV_NOME, PEV_USUARIO) VALUES (1, 990001, CURRENT_DATE, CURRENT_TIMESTAMP, 5, 'A', 77, 'PDV EXTERNO', 1)");
  await new Promise((r) => setTimeout(r, 7500));
  ok('SSE: evento orders por mudanca externa (vigia do banco)', eventos.filter((e) => e === 'orders').length > antes, JSON.stringify(eventos));

  ac.abort();
  console.log(falhas === 0 ? '\nTODOS OS TESTES PASSARAM' : `\n${falhas} FALHA(S)`);
  process.exit(falhas === 0 ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
