// Diagnóstico da instalação: conexão com o Firebird, charset, tabelas/colunas usadas pelo app e contagens.
// Uso: node diagnostico.js        (ou a opção 7 do iniciar_sistema.bat)
const db = require('./server/db');

// Colunas que o app lê/grava. Se faltar alguma, a função correspondente falha.
const REQUERIDO = {
    TB_PRODUTO: ['PRD_ID', 'PRD_CODIGO', 'PRD_DESCRICAO', 'PRD_STATUS', 'PRD_UN_VENDA', 'PRD_REFERENCIA',
        'PRD_TIPO_PRODUTO', 'PRD_PRECO_VENDA', 'PRD_PRECO_COMPRA', 'PRD_PRECO_MINIMO', 'PRD_VALOR_PROM',
        'PRD_DT_INI_PROM', 'PRD_DT_FIM_PROM', 'PRD_TIPO_VALOR_PROM', 'PRD_ULTIMA_ALTERACAO',
        'PRD_ESTOQUE_MINIMO_NF', 'PRD_OBSERVACAO', 'PRD_FOTO', 'PRD_IMAGEM'],
    TB_PRODUTO_ESTOQUE: ['PRDE_PRODUTO', 'PRDE_EMPRESA', 'PRDE_LOCAL', 'PRDE_ESTOQUE', 'PRDE_ESTOQUE_NF', 'PRDE_ULTIMA_ALTERACAO'],
    TB_PRODUTO_MOVIMENTO: ['PRDM_ID', 'PRDM_EMPRESA', 'PRDM_PRODUTO', 'PRDM_SEQUENCIA', 'PRDM_TIPO', 'PRDM_QUANTIDADE',
        'PRDM_ORIGEM_MOVIMENTO', 'PRDM_ORIGEM_NUMERO', 'PRDM_HISTORICO', 'PRDM_DT_MOVIMENTO', 'PRDM_DT_LANCAMENTO',
        'PRDM_LOCAL', 'PRDM_EMPRESA_ORIGEM', 'PRDM_USUARIO'],
    TB_AUDITORIA: ['AUD_EMPRESA', 'AUD_TABELA', 'AUD_ID_REGISTRO', 'AUD_SEQUENCIA', 'AUD_ACAO', 'AUD_DT_LANCAMENTO',
        'AUD_USUARIO', 'AUD_DESC_REGISTRO'],
    TB_AUDITORIA_ITEM: ['AUDI_EMPRESA', 'AUDI_TABELA', 'AUDI_ID_REGISTRO', 'AUDI_AUDITORIA', 'AUDI_CAMPO',
        'AUDI_CAMPO_DESC', 'AUDI_VALOR_ANTIGO', 'AUDI_VALOR_NOVO'],
    TB_SEQUENCIAL: ['SEQ_TABELA', 'SEQ_SEQUENCIAL', 'SEQ_EMPRESA'],
    TB_PEDIDO_VENDA: ['PEV_EMPRESA', 'PEV_ID', 'PEV_DT_EMISSAO', 'PEV_DT_LANCAMENTO', 'PEV_VALOR_TOTAL', 'PEV_STATUS',
        'PEV_SENHA', 'PEV_DT_HR_PRONTO', 'PEV_DT_HR_ENTREGUE', 'PEV_NOME', 'PEV_MESA', 'PEV_COMANDA', 'PEV_USUARIO'],
    TB_PEDIDO_VENDA_ITEM: ['PEVI_EMPRESA', 'PEVI_PEDIDO_VENDA', 'PEVI_SEQUENCIA', 'PEVI_PRODUTO', 'PEVI_DESCRICAO',
        'PEVI_QUANTIDADE', 'PEVI_VALOR_UNITARIO', 'PEVI_VALOR_TOTAL']
};

(async () => {
    let problemas = 0;
    const ok = (m) => console.log('  [OK]    ' + m);
    const ruim = (m) => { problemas++; console.log('  [ERRO]  ' + m); };
    const aviso = (m) => console.log('  [AVISO] ' + m);

    console.log('Node ' + process.version + ' | node-firebird ' + require('node-firebird/package.json').version);
    console.log('Banco: ' + db.connectionInfo.host + ':' + db.connectionInfo.port + ' -> ' + db.connectionInfo.database + '\n');

    console.log('1) Conexão');
    try {
        const [v] = await db.query("SELECT rdb$get_context('SYSTEM', 'ENGINE_VERSION') AS V FROM RDB$DATABASE");
        ok('Conectado ao Firebird ' + (v && v.V));
        const [cs] = await db.query('SELECT RDB$CHARACTER_SET_NAME AS CS FROM RDB$DATABASE');
        ok('Charset do banco: ' + (cs && cs.CS));
    } catch (e) {
        ruim('Não foi possível conectar: ' + e.message);
        console.log('\n  Dicas: confira se o serviço do Firebird está ativo, o caminho do .FDB (config/db.json ou FB_DB_CONN),');
        console.log('  usuário/senha (FB_USER/FB_PASSWORD) e se o arquivo não está "somente na nuvem" no OneDrive.');
        process.exit(1);
    }

    console.log('\n2) Tabelas e colunas usadas pelo app');
    for (const [tabela, colunas] of Object.entries(REQUERIDO)) {
        try {
            const rows = await db.query(
                'SELECT TRIM(RDB$FIELD_NAME) AS C FROM RDB$RELATION_FIELDS WHERE RDB$RELATION_NAME = ?', [tabela]);
            if (rows.length === 0) { ruim(tabela + ': tabela não encontrada'); continue; }
            const tem = new Set(rows.map((r) => r.C.toUpperCase()));
            const faltam = colunas.filter((c) => !tem.has(c));
            if (faltam.length) ruim(tabela + ': faltam colunas -> ' + faltam.join(', '));
            else ok(tabela + ' (' + colunas.length + ' colunas verificadas)');
        } catch (e) { ruim(tabela + ': ' + e.message); }
    }

    console.log('\n3) Dados');
    try {
        const prod = await db.query("SELECT PRD_TIPO_PRODUTO AS T, COUNT(*) AS N FROM TB_PRODUTO GROUP BY PRD_TIPO_PRODUTO");
        ok('Produtos por tipo: ' + prod.map((r) => `${r.T}=${r.N}`).join('  '));
        const stats = await db.getDashboardStats();
        ok(`Catálogo (N/P/T): ${stats.totalProdutos} produtos, ${stats.ativos} ativos, ${stats.emPromocao} em promoção`);
        const promo = await db.getPromotions();
        const c = promo.contagem;
        if (c.vencidas > 0) aviso(`${c.vencidas} promoção(ões) vencida(s) ainda gravada(s) (use Promoções > Limpar vencidas)`);
        if (c.expirando > 0) aviso(`${c.expirando} promoção(ões) expirando em ${promo.diasAlerta} dia(s)`);
        const [neg] = await db.query("SELECT COUNT(*) AS N FROM TB_PRODUTO_ESTOQUE WHERE PRDE_EMPRESA = 1 AND PRDE_ESTOQUE < 0");
        if (Number(neg.N) > 0) aviso(`${neg.N} produto(s) com estoque negativo`);
        const [dup] = await db.query(
            'SELECT COUNT(*) AS N FROM (SELECT PRDE_PRODUTO FROM TB_PRODUTO_ESTOQUE WHERE PRDE_EMPRESA = 1 GROUP BY PRDE_PRODUTO HAVING COUNT(*) > 1)');
        if (Number(dup.N) > 0) aviso(`${dup.N} produto(s) com mais de uma linha de estoque (vários locais/variações)`);
        const orders = await db.getOrders({ filter: 'TODOS', limit: 1 });
        ok('Pedidos de hoje consultáveis (' + orders.length + ' retornado(s))');
    } catch (e) { ruim('Consulta de dados: ' + e.message); }

    console.log('\n' + (problemas === 0 ? 'Diagnóstico concluído sem erros.' : problemas + ' problema(s) encontrado(s).'));
    process.exit(problemas === 0 ? 0 : 1);
})();
