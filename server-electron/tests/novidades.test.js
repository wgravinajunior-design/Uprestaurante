// Dashboard, "o que mudou hoje", KDS por estação, área pública (senha/cardápio) e QR Code — cópia do banco.
const os = require('os');
const path = require('path');
const fs = require('fs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'upweb-test-'));
process.env.CONFIG_DIR = path.join(tmp, 'config');
process.env.CACHE_DIR = path.join(tmp, 'cache');
process.env.PORT_PUBLIC = '18083';
fs.mkdirSync(process.env.CONFIG_DIR, { recursive: true });

const { garantirSchema } = require('./_guard');
const base = path.join(__dirname, '..', 'server') + '/';
const db = require(base + 'db');
const reports = require(base + 'reports');
const kds = require(base + 'kds');
const { startServer } = require(base + 'index');

let falhas = 0;
const ok = (n, c, x = '') => { if (!c) falhas++; console.log(c ? 'OK   ' : 'FALHA', n, x); };
const M = 'http://localhost:18080';
const P = 'http://localhost:18083';
const j = async (b, u, o) => { const r = await fetch(b + u, o); const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t; } return { s: r.status, d, h: r.headers }; };
const jsonPost = (b, u, body, method = 'POST') => j(b, u, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const ymd = (off) => { const d = new Date(); d.setDate(d.getDate() + off); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const exec = (sql) => db.execute(sql);

(async () => {
  await garantirSchema(db);

  // ------------------------------------------------------------------ seed
  // a base de teste pode nao ter a sequencia de pedidos (producao tem)
  const seq = await db.query("SELECT SEQ_TABELA FROM TB_SEQUENCIAL WHERE SEQ_TABELA = 'TB_PEDIDO_VENDA'");
  if (seq.length === 0) await exec("INSERT INTO TB_SEQUENCIAL (SEQ_EMPRESA, SEQ_TABELA, SEQ_SEQUENCIAL) VALUES (1, 'TB_PEDIDO_VENDA', 1000)");
  await exec("INSERT INTO TB_PROD_GRUPO (PGRU_EMPRESA, PGRU_ID, PGRU_DESCRICAO, PGRU_EXIBIR_TOUCH, PGRU_ORDEM_TOUCH) VALUES (1, 9001, 'SUCOS TESTE', 'S', 1)");
  await exec("INSERT INTO TB_PROD_GRUPO (PGRU_EMPRESA, PGRU_ID, PGRU_DESCRICAO, PGRU_EXIBIR_TOUCH, PGRU_ORDEM_TOUCH) VALUES (1, 9002, 'INSUMOS TESTE', 'N', 2)");
  for (const [id, nome] of [[91, 'COZINHA'], [92, 'SALGADO']]) {
    await exec(`INSERT INTO TB_SETOR (SET_ID, SET_EMPRESA, SET_DESCRICAO) VALUES (${id}, 1, '${nome}')`);
  }
  const prod = [
    // id, nome, preco, promo, ini, fim, grupo, setor
    [900301, 'SUCO TESTE', 10, null, null, null, 9001, null],
    [900302, 'SALGADO TESTE', 6, null, null, null, 9001, 92],
    [900303, 'PROMO TESTE', 20, 15, ymd(-1), ymd(5), 9001, null],
    [900304, 'OCULTO TESTE', 8, null, null, null, 9001, null],
    [900305, 'SEM GRUPO TESTE', 5, null, null, null, null, null],
    [900306, 'GRUPO TOUCH N', 7, null, null, null, 9002, null],
  ];
  for (const [id, nome, pv, pr, ini, fim, g, s] of prod) {
    await exec(`INSERT INTO TB_PRODUTO (PRD_ID, PRD_CODIGO, PRD_DESCRICAO, PRD_STATUS, PRD_UN_VENDA, PRD_TIPO_PRODUTO, PRD_PRECO_VENDA, PRD_VALOR_PROM, PRD_DT_INI_PROM, PRD_DT_FIM_PROM, PRD_GRUPO, PRD_SETOR)
      VALUES (${id}, '${id}', '${nome}', 'A', 'UN', 'N', ${pv}, ${pr === null ? 'NULL' : pr}, ${ini ? `'${ini}'` : 'NULL'}, ${fim ? `'${fim}'` : 'NULL'}, ${g === null ? 'NULL' : g}, ${s === null ? 'NULL' : s})`);
  }

  // vendas finalizadas (F) para o dashboard: periodo 02/03..08/03/2026 (seg-dom) e anterior 23/02..01/03
  const vendas = [
    [800001, '2026-03-02', '2026-03-02 09:15:00', 20, 'F', [[900301, 'SUCO TESTE', 2, 20]]],
    [800002, '2026-03-02', '2026-03-02 16:40:00', 30, 'F', [[900302, 'SALGADO TESTE', 1, 30]]],
    [800003, '2026-03-04', '2026-03-04 15:05:00', 50, 'F', [[900301, 'SUCO TESTE', 3, 20], [900302, 'SALGADO TESTE', 1, 30]]],
    [800004, '2026-03-04', '2026-03-04 15:30:00', 999, 'C', [[900301, 'SUCO TESTE', 9, 999]]],   // cancelado: nao conta
    [800005, '2026-02-25', '2026-02-25 10:00:00', 40, 'F', [[900301, 'SUCO TESTE', 4, 40]]],     // periodo anterior
  ];
  for (const [id, dt, lanc, total, st, itens] of vendas) {
    await exec(`INSERT INTO TB_PEDIDO_VENDA (PEV_EMPRESA, PEV_ID, PEV_DT_EMISSAO, PEV_DT_LANCAMENTO, PEV_VALOR_TOTAL, PEV_STATUS, PEV_USUARIO) VALUES (1, ${id}, '${dt}', '${lanc}', ${total}, '${st}', 1)`);
    let seq = 1;
    for (const [pid, desc, q, v] of itens) {
      await exec(`INSERT INTO TB_PEDIDO_VENDA_ITEM (PEVI_EMPRESA, PEVI_PEDIDO_VENDA, PEVI_SEQUENCIA, PEVI_PRODUTO, PEVI_DESCRICAO, PEVI_QUANTIDADE, PEVI_VALOR_UNITARIO, PEVI_VALOR_TOTAL) VALUES (1, ${id}, ${seq++}, ${pid}, '${desc}', ${q}, ${v / q}, ${v})`);
    }
  }

  // ------------------------------------------------------------------ dashboard
  const dash = await reports.dashboard({ inicio: '2026-03-02', fim: '2026-03-08', comparar: 'ANTERIOR' });
  ok('dashboard: pedidos/faturamento/ticket (cancelado fora)', dash.atual.pedidos === 3 && dash.atual.faturamento === 100 && dash.atual.ticketMedio === 33.33, JSON.stringify(dash.atual));
  ok('dashboard: período anterior', dash.anterior.inicio === '2026-02-23' && dash.anterior.fim === '2026-03-01' && dash.anterior.pedidos === 1 && dash.anterior.faturamento === 40, JSON.stringify(dash.anterior));
  ok('dashboard: variação (+200% pedidos, +150% faturamento)', dash.variacao.pedidos === 200 && dash.variacao.faturamento === 150, JSON.stringify(dash.variacao));
  ok('dashboard: 7 dias com zeros nos vazios', dash.porDia.length === 7 && dash.porDia[0].pedidos === 2 && dash.porDia[1].pedidos === 0 && dash.porDia[2].faturamento === 50);
  ok('dashboard: horários 9h/15h/16h', dash.porHora[9].pedidos === 1 && dash.porHora[15].pedidos === 1 && dash.porHora[16].pedidos === 1 && dash.porHora[10].pedidos === 0);
  ok('dashboard: dia da semana (seg=2 pedidos)', dash.porDiaSemana[1].pedidos === 2 && dash.porDiaSemana[3].pedidos === 1, JSON.stringify(dash.porDiaSemana.map((d) => d.pedidos)));
  ok('dashboard: mais vendidos por quantidade', dash.topQuantidade[0].descricao === 'SUCO TESTE' && dash.topQuantidade[0].quantidade === 5, JSON.stringify(dash.topQuantidade[0]));
  ok('dashboard: mais vendidos por faturamento', dash.topFaturamento[0].descricao === 'SALGADO TESTE' && dash.topFaturamento[0].faturamento === 60, JSON.stringify(dash.topFaturamento[0]));
  ok('dashboard: melhor dia (R$ 50, empate entre 02/03 e 04/03)', dash.melhorDia && dash.melhorDia.faturamento === 50 && ['2026-03-02', '2026-03-04'].includes(dash.melhorDia.data));
  ok('dashboard: última venda conhecida', dash.ultimaVenda === '2026-03-04');
  const semComp = await reports.dashboard({ inicio: '2026-03-02', fim: '2026-03-08', comparar: 'NENHUM' });
  ok('dashboard: sem comparação', semComp.anterior === null && semComp.variacao === null);
  const semana = await reports.dashboard({ inicio: '2026-03-02', fim: '2026-03-08', comparar: 'SEMANA' });
  ok('dashboard: comparar com 7 dias antes', semana.anterior.inicio === '2026-02-23');
  for (const [nome, args] of [['data inválida', { inicio: '2026-13-45', fim: '2026-03-08' }], ['inicio > fim', { inicio: '2026-03-09', fim: '2026-03-08' }], ['intervalo enorme', { inicio: '2020-01-01', fim: '2026-03-08' }]]) {
    try { await reports.dashboard(args); ok('dashboard rejeita ' + nome, false); } catch (e) { ok('dashboard rejeita ' + nome, e.status === 400, e.message); }
  }

  // ------------------------------------------------------------------ mudancas do dia
  await db.updateProductPrice(900301, 12.5);
  await db.updateProductPromotion(900302, { ativo: true, valorPromocional: 4.5, dtInicio: ymd(0), dtFim: ymd(3) });
  await db.updateProductStock(900301, 7, 'Contagem do dia');
  await db.updateProductStatus(900304, 'I');
  const mud = await reports.mudancas({});
  ok('mudanças: tipos PRECO/PROMOCAO/ESTOQUE/STATUS', ['PRECO', 'PROMOCAO', 'ESTOQUE', 'STATUS'].every((t) => mud.porTipo[t] > 0), JSON.stringify(mud.porTipo));
  const preco = mud.itens.find((i) => i.tipo === 'PRECO' && i.produtoId === 900301);
  ok('mudanças: preço de→para, origem e hora', preco && preco.de === '10.00' && preco.para === '12.50' && preco.origem === 'Este sistema' && /^\d{2}:\d{2}$/.test(preco.hora), JSON.stringify(preco));
  ok('mudanças: movimento de estoque listado', mud.itens.some((i) => i.tipo === 'ESTOQUE' && i.produtoId === 900301 && i.detalhe === 'Contagem do dia'));
  ok('mudanças: produtos afetados', mud.produtosAfetados >= 3, String(mud.produtosAfetados));
  const vazio = await reports.mudancas({ data: '2001-01-01' });
  ok('mudanças: dia sem alterações', vazio.total === 0);

  // ------------------------------------------------------------------ KDS
  const cfgPadrao = await kds.getConfig();
  ok('KDS: estações padrão a partir dos setores do ERP', cfgPadrao.estacoes.some((e) => e.nome === 'Cozinha') && cfgPadrao.estacoes.some((e) => e.padrao), cfgPadrao.estacoes.map((e) => e.id).join(','));
  const tk = await db.createQuickTicket({ senha: '7', nome: 'Cliente KDS', itens: [
    { produtoId: 900302, descricao: 'SALGADO TESTE', quantidade: 2, valorUnitario: 6 },
    { produtoId: 900301, descricao: 'SUCO TESTE', quantidade: 1, valorUnitario: 12.5 }
  ] });
  const idSal = cfgPadrao.estacoes.find((e) => e.setores.includes(92)).id;
  const idPad = cfgPadrao.estacoes.find((e) => e.padrao).id;
  let v = await kds.pedidosDaEstacao(idSal);
  ok('KDS: estação do salgado vê só o salgado', v.pedidos.length === 1 && v.pedidos[0].itens.length === 1 && v.pedidos[0].itens[0].descricao === 'SALGADO TESTE', JSON.stringify(v.pedidos[0] && v.pedidos[0].itens.map((i) => i.descricao)));
  v = await kds.pedidosDaEstacao(idPad);
  ok('KDS: estação padrão recebe o que não casa regra', v.pedidos[0].itens.length === 1 && v.pedidos[0].itens[0].descricao === 'SUCO TESTE');
  v = await kds.pedidosDaEstacao(null);
  ok('KDS: visão geral com os 2 itens e agrupado', v.pedidos[0].itens.length === 2 && v.agrupado.length === 2 && v.agrupado.find((g) => g.descricao === 'SALGADO TESTE').quantidade === 2);

  let c = await kds.concluir(tk.id, idSal);
  ok('KDS: concluir uma estação não finaliza o pedido', c.pedidoPronto === false && c.faltam.length === 1);
  v = await kds.pedidosDaEstacao(idSal);
  ok('KDS: concluído some da estação', v.pedidos.length === 0);
  let ped = (await db.getOrders({ filter: 'PREPARO', limit: 50 })).find((o) => o.id === tk.id);
  ok('KDS: pedido ainda em preparo no ERP', !!ped && ped.estado === 'PREPARO');
  c = await kds.concluir(tk.id, idSal, { desfazer: true });
  ok('KDS: desfazer reabre a estação', c.faltam.length === 2);
  await kds.concluir(tk.id, idSal);
  c = await kds.concluir(tk.id, idPad);
  ok('KDS: última estação conclui e marca PRONTO', c.pedidoPronto === true && c.faltam.length === 0);
  ped = (await db.getOrders({ filter: 'PRONTOS', limit: 50 })).find((o) => o.id === tk.id);
  ok('KDS: pedido PRONTO no ERP', !!ped && ped.estado === 'PRONTO');
  try { await kds.concluir(tk.id, 'nao-existe'); ok('KDS: estação inexistente', false); } catch (e) { ok('KDS: estação inexistente rejeitada', e.status === 404); }

  // configuracao personalizada
  try { await kds.salvarConfig({ estacoes: [{ nome: 'A', padrao: false }] }); ok('KDS: exige estação padrão', false); } catch (e) { ok('KDS: exige exatamente uma estação padrão', e.status === 400, e.message); }
  const salvo = await kds.salvarConfig({ estacoes: [
    { id: 'lanches', nome: 'Lanches', produtos: [900301], padrao: false },
    { id: 'geral', nome: 'Geral', padrao: true }
  ] });
  ok('KDS: configuração salva e usada', salvo.estacoes.length === 2);
  const tk2 = await db.createQuickTicket({ senha: '8', itens: [{ produtoId: 900301, descricao: 'SUCO TESTE', quantidade: 1, valorUnitario: 12.5 }] });
  v = await kds.pedidosDaEstacao('lanches');
  ok('KDS: regra por produto vence setor/padrão', v.pedidos.some((p) => p.id === tk2.id));

  // ------------------------------------------------------------------ servidor (API principal + publica)
  await startServer(18080, 18081, 18082);

  let r = await j(M, '/api/dashboard?inicio=2026-03-02&fim=2026-03-08');
  ok('API /api/dashboard', r.s === 200 && r.d.data.atual.faturamento === 100);
  r = await j(M, '/api/dashboard?inicio=lixo&fim=2026-03-08');
  ok('API /api/dashboard rejeita data inválida (400)', r.s === 400);
  r = await j(M, '/api/changes');
  ok('API /api/changes', r.s === 200 && r.d.data.total > 0);
  r = await j(M, '/api/kds/config');
  ok('API /api/kds/config traz opções', r.s === 200 && r.d.data.opcoes.setores.length >= 2);
  r = await jsonPost(M, '/api/kds/config', { estacoes: [] }, 'PUT');
  ok('API KDS rejeita configuração vazia', r.s === 400);
  r = await j(M, '/api/kds/orders?estacao=lanches');
  ok('API /api/kds/orders', r.s === 200 && r.d.data.pedidos.length >= 1);
  r = await j(M, '/api/kds/orders?estacao=nao-existe');
  ok('API KDS estação inexistente (404)', r.s === 404);

  // QR
  r = await j(M, '/api/qr?data=' + encodeURIComponent('http://192.168.0.10:8083/senha'));
  ok('QR Code em SVG', r.s === 200 && String(r.h.get('content-type')).includes('image/svg+xml') && String(r.d).startsWith('<?xml') || String(r.d).includes('<svg'));
  r = await j(M, '/api/qr?data=' + encodeURIComponent('javascript:alert(1)'));
  ok('QR recusa URL que não é http(s)', r.s === 400);
  r = await j(M, '/api/public-info');
  ok('API /api/public-info', r.s === 200 && r.d.data.porta === 18083 && typeof r.d.data.baseSugerida === 'string', r.d.data && r.d.data.baseSugerida);
  r = await jsonPost(M, '/api/company/theme', { publicUrl: 'https://loja.exemplo.com.br/' }, 'PUT');
  r = await j(M, '/api/public-info');
  ok('publicUrl salvo (sem barra final) vira a base sugerida', r.d.data.baseSugerida === 'https://loja.exemplo.com.br');
  r = await jsonPost(M, '/api/company/theme', { publicUrl: 'javascript:alert(1)' }, 'PUT');
  ok('publicUrl inválida rejeitada', r.s === 400);

  // cardapio (config + publico)
  r = await jsonPost(M, '/api/cardapio/config', { ocultos: [900304] }, 'PUT');
  ok('config do cardápio salva', r.s === 200 && r.d.data.ocultos.includes(900304));
  r = await j(P, '/api/public/menu');
  const nomes = r.d.data.secoes.flatMap((s) => s.itens.map((i) => i.nome));
  ok('cardápio: grupo "touch" aparece com seus itens', r.s === 200 && r.d.data.secoes.some((s) => s.nome === 'SUCOS TESTE') && nomes.includes('SUCO TESTE'));
  ok('cardápio: produto oculto some', !nomes.includes('OCULTO TESTE'));
  ok('cardápio: grupo com touch=N some', !nomes.includes('GRUPO TOUCH N'));
  ok('cardápio: sem grupo vai para "Outros"', r.d.data.secoes.some((s) => s.id === 'outros' && s.itens.some((i) => i.nome === 'SEM GRUPO TESTE')));
  const promo = r.d.data.promocoes.find((p) => p.nome === 'PROMO TESTE');
  ok('cardápio: promoção vigente em destaque', promo && promo.precoPromocao === 15 && promo.descontoPercentual === 25, JSON.stringify(promo));
  ok('cardápio: preço atualizado (12,50)', r.d.data.secoes.flatMap((s) => s.itens).find((i) => i.nome === 'SUCO TESTE').preco === 12.5);
  r = await jsonPost(M, '/api/cardapio/config', { respeitarTouch: false, incluirSemGrupo: false, ocultos: [] }, 'PUT');
  await new Promise((rs) => setTimeout(rs, 50));
  r = await j(P, '/api/public/menu');
  const nomes2 = r.d.data.secoes.flatMap((s) => s.itens.map((i) => i.nome));
  ok('cardápio: opções (todos os grupos, sem "Outros"; inativo nunca aparece)', nomes2.includes('GRUPO TOUCH N') && !nomes2.includes('OCULTO TESTE') && !nomes2.includes('SEM GRUPO TESTE'));

  // senha (publico)
  r = await j(P, '/api/public/senha/7');
  ok('senha: pedido pronto é encontrado', r.s === 200 && r.d.data.encontrado === true && r.d.data.estado === 'PRONTO' && r.d.data.senha === '07', JSON.stringify(r.d.data));
  r = await j(P, '/api/public/senha/8');
  ok('senha: em preparo informa fila e não vaza dados pessoais', r.d.data.estado === 'PREPARO' && r.d.data.aFrente === 0 && !JSON.stringify(r.d.data).match(/nome|cliente|valor|preco/i), JSON.stringify(r.d.data));
  await db.updateOrderStatus(tk2.id, 'PRONTO');
  r = await j(P, '/api/public/senha/8');
  ok('senha: muda para PRONTO', r.d.data.estado === 'PRONTO');
  r = await j(P, '/api/public/senha/9999');
  ok('senha: inexistente', r.s === 200 && r.d.data.encontrado === false);
  r = await j(P, '/api/public/senha/abc');
  ok('senha: entrada inválida (400)', r.s === 400);
  r = await j(P, "/api/public/senha/1;DROP");
  ok('senha: injeção recusada', r.s === 400);

  // isolamento da porta publica
  r = await j(P, '/api/products?pageSize=1');
  ok('porta pública não expõe a API administrativa', r.s === 404, String(r.s));
  r = await jsonPost(P, '/api/products/900301/price', { precoVenda: 1 }, 'PUT');
  ok('porta pública recusa escrita (405)', r.s === 405);
  r = await j(P, '/api/orders');
  ok('porta pública não expõe pedidos', r.s === 404);
  r = await j(P, '/api/public/info');
  ok('info pública (marca)', r.s === 200 && typeof r.d.data.nome === 'string');
  r = await j(P, '/api/products/abc/image');
  ok('imagem pública valida o id', r.s === 400);
  r = await j(P, '/senha');
  ok('página /senha servida', r.s === 200 && String(r.d).includes('Qual é a sua senha'));
  r = await j(P, '/cardapio');
  ok('página /cardapio servida', r.s === 200 && String(r.d).includes('Cardápio'));

  // eventos publicos (SSE)
  const ac = new AbortController();
  const eventos = [];
  fetch(P + '/api/public/events', { signal: ac.signal }).then(async (res) => {
    const reader = res.body.getReader(); const dec = new TextDecoder();
    for (;;) { const { value, done } = await reader.read(); if (done) break; for (const m of dec.decode(value).matchAll(/event: (\w+)/g)) eventos.push(m[1]); }
  }).catch(() => {});
  await new Promise((rs) => setTimeout(rs, 1200));
  ok('SSE público conecta (hello)', eventos.includes('hello'));
  ac.abort();

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(falhas === 0 ? '\nTODOS OS TESTES PASSARAM' : `\n${falhas} FALHA(S)`);
  process.exit(falhas === 0 ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
