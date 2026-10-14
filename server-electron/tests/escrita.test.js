// Roda as funções REAIS de escrita do db.js contra uma CÓPIA do banco (ver _guard.js).
const { garantirSchema } = require('./_guard');
const db = require('../server/db');

let falhas = 0;
const ok = (nome, cond, extra = '') => { if (!cond) falhas++; console.log((cond ? 'OK   ' : 'FALHA'), nome, extra); };
const step = async (nome, fn) => {
  try { return await fn(); } catch (e) { falhas++; console.log('ERRO ', nome, '->', e.message.slice(0, 220)); return null; }
};

(async () => {
  await garantirSchema(db);
  // --- limpa resquicios de execucao anterior e semeia (somente na copia) ---
  for (const t of ["TB_PRODUTO_MOVIMENTO WHERE PRDM_PRODUTO", "TB_PRODUTO_ESTOQUE WHERE PRDE_PRODUTO", "TB_PRODUTO WHERE PRD_ID"]) { try { await db.execute("DELETE FROM " + t + " = 900001"); } catch (e) {} }
  try { await db.execute("DELETE FROM TB_PEDIDO_VENDA_ITEM"); await db.execute("DELETE FROM TB_PEDIDO_VENDA"); } catch (e) {}
  await db.execute(`INSERT INTO TB_PRODUTO (PRD_ID, PRD_CODIGO, PRD_DESCRICAO, PRD_STATUS, PRD_UN_VENDA, PRD_TIPO_PRODUTO, PRD_PRECO_VENDA, PRD_PRECO_MINIMO)
    VALUES (900001, '900001', 'PRODUTO TESTE AÇAÍ', 'A', 'UN', 'N', 10.0000, 5.0000)`);
  const seqs = await db.query("SELECT SEQ_TABELA FROM TB_SEQUENCIAL WHERE SEQ_TABELA = 'TB_PEDIDO_VENDA'");
  if (seqs.length === 0) {
    await db.execute(`INSERT INTO TB_SEQUENCIAL (SEQ_EMPRESA, SEQ_TABELA, SEQ_SEQUENCIAL) VALUES (1, 'TB_PEDIDO_VENDA', 100)`);
  }

  const p0 = await step('getProductById', () => db.getProductById(900001));
  ok('produto semeado com acento', p0 && p0.descricao === 'PRODUTO TESTE AÇAÍ', JSON.stringify(p0 && p0.descricao));

  // 1. preco
  const p1 = await step('updateProductPrice', () => db.updateProductPrice(900001, 12.5, 6));
  ok('preco venda 12.5 / min 6', p1 && p1.precoVenda === 12.5 && p1.precoMinimo === 6);

  // 2. promocao
  const _d = new Date(); const hoje = `${_d.getFullYear()}-${String(_d.getMonth() + 1).padStart(2, '0')}-${String(_d.getDate()).padStart(2, '0')}`;
  const p2 = await step('updateProductPromotion', () => db.updateProductPromotion(900001, { ativo: true, valorPromocional: 9.9, dtInicio: hoje, dtFim: null, tipoValor: 'V' }));
  ok('promocao vigente', p2 && p2.emPromocao === true && p2.precoPromocao === 9.9 && p2.descontoPercentual === 21, JSON.stringify(p2 && [p2.emPromocao, p2.descontoPercentual]));
  const p2b = await step('promocao off', () => db.updateProductPromotion(900001, { ativo: false }));
  ok('promocao desligada', p2b && p2b.emPromocao === false && p2b.precoPromocao === 0);

  // 3. estoque (sem linha previa => INSERT em TB_PRODUTO_ESTOQUE)
  const p3 = await step('updateProductStock insert', () => db.updateProductStock(900001, 20, 'teste ENTRADA'));
  ok('estoque 20 (insert)', p3 && p3.estoque === 20, String(p3 && p3.estoque));
  const p3b = await step('updateProductStock update', () => db.updateProductStock(900001, 17.5, 'teste SAIDA'));
  ok('estoque 17.5 (update, fracionado)', p3b && p3b.estoque === 17.5, String(p3b && p3b.estoque));
  const mov = await db.query("SELECT PRDM_ID, PRDM_SEQUENCIA, PRDM_TIPO, PRDM_QUANTIDADE FROM TB_PRODUTO_MOVIMENTO WHERE PRDM_PRODUTO = 900001 ORDER BY PRDM_ID");
  ok('2 movimentos (ENT 20, SAI 2.5)', mov.length === 2 && mov[0].PRDM_TIPO === 'ENT' && mov[1].PRDM_TIPO === 'SAI', JSON.stringify(mov));

  // 4. quick edit (status, preco, promo, estoque) - em paralelo para testar o lock
  const [q1, q2] = await Promise.all([
    step('quickEdit A', () => db.quickEditProduct(900001, { precoVenda: 15, emPromocao: true, precoPromocao: 12, dtInicioProm: hoje, estoque: 30 })),
    step('quickEdit B (paralelo)', () => db.updateProductStock(900001, 31, 'paralelo')),
  ]);
  ok('quickEdit aplicou preco/promo', q1 && q1.precoVenda === 15 && q1.precoPromocao === 12);
  const movs = await db.query("SELECT PRDM_ID FROM TB_PRODUTO_MOVIMENTO WHERE PRDM_PRODUTO = 900001");
  const ids = new Set(movs.map(m => m.PRDM_ID));
  ok('ids de movimento unicos sob concorrencia', ids.size === movs.length, `${movs.length} movimentos`);

  // 5. campos com acento
  const p5 = await step('updateProductFields', () => db.updateProductFields(900001, { descricao: 'PAPEL HIGIÊNICO AÇAÍ 5G', referencia: 'REF-ÇÃO', observacao: "obs com 'aspas' e ção" }));
  ok('acentos ida e volta', p5 && p5.descricao === 'PAPEL HIGIÊNICO AÇAÍ 5G' && p5.referencia === 'REF-ÇÃO' && p5.observacao === "obs com 'aspas' e ção", JSON.stringify(p5 && [p5.descricao, p5.observacao]));

  // 6. status
  const p6 = await step('updateProductStatus', () => db.updateProductStatus(900001, 'I'));
  ok('status I', p6 && p6.status === 'I');

  // 7. auditoria
  const aud = await db.query("SELECT COUNT(*) AS N FROM TB_AUDITORIA WHERE AUD_ID_REGISTRO = '900001'");
  const audI = await db.query("SELECT COUNT(*) AS N FROM TB_AUDITORIA_ITEM WHERE AUDI_ID_REGISTRO = '900001'");
  ok('auditoria gravada', Number(aud[0].N) >= 6 && Number(audI[0].N) >= 6, `${aud[0].N} cabecalhos / ${audI[0].N} itens`);
  const hist = await step('getAuditHistory', () => db.getAuditHistory(5));
  ok('historico legivel', Array.isArray(hist) && hist.length > 0, JSON.stringify(hist && hist[0] && [hist[0].descricao, hist[0].valorNovo]));

  // 8. ticket rapido e pedidos
  const t1 = await step('createQuickTicket', () => db.createQuickTicket({ nome: 'JOÃO DA SILVA', comanda: 'CMD 10', itens: [{ produtoId: 900001, descricao: 'PAPEL HIGIÊNICO', quantidade: 2, valorUnitario: 7.5 }] }));
  ok('ticket criado', t1 && t1.id > 0 && t1.valorTotal === 15, JSON.stringify(t1 && [t1.id, t1.senha, t1.valorTotal]));
  const t2 = await step('createQuickTicket senha+mesa', () => db.createQuickTicket({ senha: '7', mesa: '4', nome: 'Ana' }));
  ok('ticket 2 com senha/mesa inteiras', t2 && t2.id === (t1 ? t1.id + 1 : -1), JSON.stringify(t2 && [t2.id, t2.senha]));
  const [t3, t4] = await Promise.all([
    step('ticket paralelo 1', () => db.createQuickTicket({ nome: 'P1' })),
    step('ticket paralelo 2', () => db.createQuickTicket({ nome: 'P2' })),
  ]);
  ok('ids/senhas de tickets paralelos distintos', t3 && t4 && t3.id !== t4.id && t3.senha !== t4.senha, JSON.stringify([t3 && [t3.id, t3.senha], t4 && [t4.id, t4.senha]]));
  const ped = await step('getOrders', () => db.getOrders({ filter: 'PREPARO', limit: 20 }));
  const o1 = ped && ped.find(o => t1 && o.id === t1.id);
  ok('pedido listado com item/nome acentuado', o1 && o1.itens.length === 1 && o1.clienteNome === 'JOÃO DA SILVA' && o1.estado === 'PREPARO', JSON.stringify(o1 && [o1.senha, o1.clienteNome, o1.comanda]));
  await step('PRONTO', () => db.updateOrderStatus(t1.id, 'PRONTO'));
  const pr = await db.getOrders({ filter: 'PRONTOS', limit: 20 });
  ok('pedido pronto', pr.some(o => o.id === t1.id && o.estado === 'PRONTO'));
  await step('assignOrderPassword', () => db.assignOrderPassword(t1.id, '55'));
  const apos = await db.getOrders({ filter: 'TODOS', search: 'JOÃO', limit: 20 });
  ok('busca por nome com acento + senha 55', apos.some(o => o.id === t1.id && o.senha === '55'));
  const nx = await db.generateNextDailyPassword();
  ok('proxima senha do dia', /^\d+$/.test(nx), nx);

  // 9. imagem
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await step('saveProductImage png', () => db.saveProductImage(900001, png));
  const img = await step('getProductImage', () => db.getProductImage(900001));
  ok('imagem png servida', img && img.type === 'image/png');
  await step('rejeita nao-imagem', async () => { try { await db.saveProductImage(900001, Buffer.from('<svg onload=alert(1)>')); ok('rejeitou svg', false); } catch (e) { ok('rejeitou svg', e.status === 400); } });

  // 10. validacoes
  for (const [nome, fn] of [
    ['preco negativo', () => db.updateProductPrice(900001, -1)],
    ['preco NaN', () => db.updateProductPrice(900001, 'abc')],
    ['data invalida', () => db.updateProductPromotion(900001, { ativo: true, valorPromocional: 5, dtInicio: "2026-01-01'; DROP TABLE X;--" })],
    ['produto inexistente', () => db.updateProductPrice(999999999, 5)],
  ]) {
    try { await fn(); ok('rejeita ' + nome, false); } catch (e) { ok('rejeita ' + nome, e.status === 400 || e.status === 404, `${e.status} ${e.message}`); }
  }

  console.log(falhas === 0 ? '\nTODOS OS TESTES PASSARAM' : `\n${falhas} FALHA(S)`);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
