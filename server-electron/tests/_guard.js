// Segurança: estes testes GRAVAM dados. Só rodam contra uma CÓPIA descartável do banco.
const path = require('path');
const os = require('os');

const conn = process.env.FB_DB_CONN || '';
const producao = path.join(os.homedir(), 'OneDrive', 'DADOS', 'DUSUCO', 'DADOS.FDB').toLowerCase();

if (!conn) {
    console.error('Defina FB_DB_CONN apontando para uma CÓPIA de teste, ex.:');
    console.error('  set FB_DB_CONN=localhost/3060:C:\\Users\\Public\\fbtest\\DADOS.FDB');
    console.error('Crie a cópia com: node tests/preparar_copia.js <origem.FDB> <destino.FDB>');
    process.exit(2);
}
if (conn.toLowerCase().includes(producao) || /dusuco/i.test(conn)) {
    console.error('RECUSADO: FB_DB_CONN parece apontar para o banco de PRODUÇÃO (' + conn + ').');
    process.exit(2);
}
if (process.env.FB_ALLOW_WRITES !== '1') {
    console.error('Defina FB_ALLOW_WRITES=1 para confirmar que o banco apontado é uma cópia descartável.');
    process.exit(2);
}

// Garante o schema mínimo (bases antigas não têm PEV_SENHA)
async function garantirSchema(db) {
    const r = await db.query(
        "SELECT COUNT(*) AS N FROM RDB$RELATION_FIELDS WHERE RDB$RELATION_NAME = 'TB_PEDIDO_VENDA' AND RDB$FIELD_NAME = 'PEV_SENHA'");
    if (Number(r[0].N) === 0) await db.execute('ALTER TABLE TB_PEDIDO_VENDA ADD PEV_SENHA INTEGER');
}

module.exports = { garantirSchema };
