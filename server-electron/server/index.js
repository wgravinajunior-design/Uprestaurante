const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 8080;
const PORT_TV = process.env.PORT_TV || 8081;
const PORT_ORDERS = process.env.PORT_ORDERS || 8082;

// Dedicated TV Signage Express App (Port 8081)
// CORS: aceita apenas origens do mesmo host (portas 8080/8081/8082) ou requisicoes sem Origin
const corsOptions = (req, cb) => {
    const origin = req.headers.origin;
    let ok = !origin;
    if (origin) {
        try {
            ok = new URL(origin).hostname === (req.headers.host || '').split(':')[0];
        } catch (e) { ok = false; }
    }
    cb(null, { origin: ok });
};

// Token opcional: defina API_TOKEN para exigir o header x-api-token nas rotas de escrita
const API_TOKEN = process.env.API_TOKEN || '';
const requireToken = (req, res, next) => {
    if (!API_TOKEN || req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    if (req.headers['x-api-token'] === API_TOKEN) return next();
    res.status(401).json({ success: false, error: 'Não autorizado' });
};

const tvApp = express();
tvApp.use(cors(corsOptions));

// Dedicated Orders & Password Express App (Port 8082)
const ordersApp = express();
ordersApp.use(cors(corsOptions));
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// Middleware
app.use(cors(corsOptions));
app.use('/api', requireToken);

// Alteracoes feitas por esta API avisam os paineis na hora (sem esperar o proximo ciclo)
app.use('/api', (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
        // captura agora: o Express restaura req.url/req.path antes do evento 'finish'
        const alvo = req.path;
        res.on('finish', () => {
            if (res.statusCode >= 400) return;
            if (alvo.startsWith('/orders')) sseBroadcast('orders');
            else if (alvo.startsWith('/products') || alvo.startsWith('/company')) sseBroadcast('products');
        });
    }
    next();
});

app.use(express.json({ limit: '10mb' }));
ordersApp.use(express.json({ limit: '10mb' }));
tvApp.use(express.json({ limit: '10mb' }));

// Forward ONLY API routes from dedicated ports (8081, 8082) through main app router, keeping pages completely isolated
const forwardToApi = (req, res, next) => {
    if (req.path.startsWith('/api/')) {
        return app(req, res, next);
    }
    next();
};
tvApp.use(forwardToApi);
ordersApp.use(forwardToApi);

// Valida :id numerico em todas as rotas
app.param('id', (req, res, next, val) => {
    if (!/^\d+$/.test(val)) {
        return res.status(400).json({ success: false, error: 'ID inválido' });
    }
    next();
});

// Request logging for desktop GUI
const recentLogs = [];
function logEvent(type, message, details = null) {
    const entry = {
        id: Date.now() + Math.random().toString(36).substring(7),
        time: new Date().toLocaleTimeString(),
        type,
        message,
        details
    };
    recentLogs.unshift(entry);
    if (recentLogs.length > 200) recentLogs.pop();
    console.log(`[${entry.time}] [${type}] ${message}`);
    return entry;
}

app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) {
        logEvent('HTTP', `${req.method} ${req.path}`);
    }
    next();
});

// --- COMPANY & THEME CONFIGURATION ---
const configDir = path.join(__dirname, '..', 'config');
if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
}
const themeConfigPath = path.join(configDir, 'company_theme.json');
const customLogoPath = path.join(configDir, 'company_logo.png');

function getThemeConfig() {
    try {
        if (fs.existsSync(themeConfigPath)) {
            return JSON.parse(fs.readFileSync(themeConfigPath, 'utf8'));
        }
    } catch (e) {
        console.warn('Erro ao ler company_theme.json:', e.message);
    }
    return {
        nome: 'DUSUCO',
        subtitulo: 'Sucos & Alimentos Naturais',
        corPrimaria: '#FF6B00',
        corSecundaria: '#EA580C',
        modoTema: 'light'
    };
}

function saveThemeConfig(cfg) {
    fs.writeFileSync(themeConfigPath, JSON.stringify(cfg, null, 2), 'utf8');
}

// Company & Theme Endpoints
app.get('/api/company', async (req, res) => {
    try {
        const dbCompany = await db.getCompanyInfo();
        const themeCfg = getThemeConfig();
        const hasCustomLogo = fs.existsSync(customLogoPath);
        res.json({
            success: true,
            data: {
                id: dbCompany.id,
                nome: themeCfg.nome || dbCompany.fantasia || 'DUSUCO',
                fantasia: dbCompany.fantasia,
                razaoSocial: dbCompany.razaoSocial,
                cnpj: dbCompany.cnpj,
                telefone: dbCompany.telefone,
                email: dbCompany.email,
                endereco: dbCompany.endereco,
                subtitulo: themeCfg.subtitulo || 'Sucos & Alimentos Naturais',
                corPrimaria: themeCfg.corPrimaria || '#FF6B00',
                corSecundaria: themeCfg.corSecundaria || '#EA580C',
                modoTema: themeCfg.modoTema || 'light',
                temLogoCustom: hasCustomLogo,
                logoUrl: '/api/company/logo'
            }
        });
    } catch (err) {
        logEvent('ERROR', 'Erro ao obter dados da empresa: ' + err.message);
        res.status(err.status || 500).json({ success: false, error: err.message });
    }
});

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const xmlEscape = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const handleSaveTheme = async (req, res) => {
    try {
        const current = getThemeConfig();
        const body = req.body || {};
        const patch = {};
        if (body.nome !== undefined) patch.nome = String(body.nome).trim().substring(0, 40);
        if (body.subtitulo !== undefined) patch.subtitulo = String(body.subtitulo).trim().substring(0, 80);
        for (const k of ['corPrimaria', 'corSecundaria']) {
            if (body[k] !== undefined) {
                if (!HEX_COLOR.test(String(body[k]))) {
                    return res.status(400).json({ success: false, error: `Cor inválida em ${k} (use #RRGGBB)` });
                }
                patch[k] = String(body[k]);
            }
        }
        if (body.modoTema !== undefined) {
            if (body.modoTema !== 'light' && body.modoTema !== 'dark') {
                return res.status(400).json({ success: false, error: "modoTema deve ser 'light' ou 'dark'" });
            }
            patch.modoTema = body.modoTema;
        }
        const updated = {
            ...current,
            ...patch
        };
        saveThemeConfig(updated);
        logEvent('AUDIT', `Identidade visual da empresa atualizada (Cor: ${updated.corPrimaria}, Tema: ${updated.modoTema})`);
        res.json({ success: true, data: updated });
    } catch (err) {
        logEvent('ERROR', 'Erro ao salvar tema da empresa: ' + err.message);
        res.status(err.status || 500).json({ success: false, error: err.message });
    }
};

app.put('/api/company', handleSaveTheme);
app.post('/api/company', handleSaveTheme);
app.put('/api/company/theme', handleSaveTheme);
app.post('/api/company/theme', handleSaveTheme);

// Company Logo Endpoint (serves custom uploaded logo or dynamic high-res SVG)
app.get('/api/company/logo', (req, res) => {
    if (fs.existsSync(customLogoPath)) {
        return res.sendFile(customLogoPath);
    }
    const themeCfg = getThemeConfig();
    const primary = HEX_COLOR.test(themeCfg.corPrimaria || '') ? themeCfg.corPrimaria : '#FF6B00';
    const secondary = HEX_COLOR.test(themeCfg.corSecundaria || '') ? themeCfg.corSecundaria : '#EA580C';
    const rawName = (themeCfg.nome || 'DUSUCO').toUpperCase();
    const name = xmlEscape(rawName);
    const initial = xmlEscape(rawName.charAt(0) || 'D');

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 70" width="240" height="70">
  <defs>
    <linearGradient id="logoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${primary}" />
      <stop offset="100%" stop-color="${secondary}" />
    </linearGradient>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="${primary}" flood-opacity="0.3"/>
    </filter>
  </defs>
  <rect x="6" y="8" width="54" height="54" rx="16" fill="url(#logoGrad)" filter="url(#glow)"/>
  <text x="33" y="45" font-family="'Segoe UI', Roboto, Helvetica, sans-serif" font-weight="900" font-size="28" fill="#FFFFFF" text-anchor="middle">${initial}</text>
  <text x="72" y="38" font-family="'Segoe UI', Roboto, Helvetica, sans-serif" font-weight="900" font-size="21" fill="#0F172A" letter-spacing="0.5">${name}</text>
  <text x="72" y="53" font-family="'Segoe UI', Roboto, Helvetica, sans-serif" font-weight="700" font-size="10" fill="#64748B" letter-spacing="1.5">SISTEMA ERP</text>
</svg>`;

    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(svg);
});

// Logo Upload
const isPngOrJpg = (b) => b && b.length > 4 &&
    ((b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) || (b[0] === 0xFF && b[1] === 0xD8));

app.post('/api/company/logo', upload.single('logo'), (req, res) => {
    try {
        if (req.file && req.file.buffer) {
            if (!isPngOrJpg(req.file.buffer)) {
                return res.status(400).json({ success: false, error: 'Logo deve ser PNG ou JPG' });
            }
            fs.writeFileSync(customLogoPath, req.file.buffer);
            logEvent('AUDIT', 'Novo logotipo da empresa carregado via upload');
            return res.json({ success: true, message: 'Logo salva com sucesso!' });
        }
        if (req.body && req.body.imageBase64) {
            const base64Data = String(req.body.imageBase64).replace(/^data:image\/\w+;base64,/, '');
            const logoBuf = Buffer.from(base64Data, 'base64');
            if (!isPngOrJpg(logoBuf)) {
                return res.status(400).json({ success: false, error: 'Logo deve ser PNG ou JPG' });
            }
            fs.writeFileSync(customLogoPath, logoBuf);
            logEvent('AUDIT', 'Novo logotipo da empresa salvo via Base64');
            return res.json({ success: true, message: 'Logo salva com sucesso!' });
        }
        res.status(400).json({ success: false, error: 'Nenhuma imagem enviada.' });
    } catch (err) {
        logEvent('ERROR', 'Erro ao salvar logotipo: ' + err.message);
        res.status(err.status || 500).json({ success: false, error: err.message });
    }
});

app.delete('/api/company/logo', (req, res) => {
    try {
        if (fs.existsSync(customLogoPath)) {
            fs.unlinkSync(customLogoPath);
            logEvent('AUDIT', 'Logotipo customizado removido (restaurado padrão)');
        }
        res.json({ success: true, message: 'Logotipo restaurado para o padrão.' });
    } catch (err) {
        res.status(err.status || 500).json({ success: false, error: err.message });
    }
});

// --- API ROUTES ---

// 1. Health & Dashboard Stats
app.get('/api/stats', async (req, res) => {
    try {
        const stats = await db.getDashboardStats();
        res.json({ success: true, data: stats });
    } catch (err) {
        logEvent('ERROR', 'Erro ao obter estatísticas: ' + err.message);
        res.status(err.status || 500).json({ success: false, error: err.message });
    }
});

// 1b. TV Promotions (Dedicated for Store TV Display)
app.get('/api/tv/promotions', async (req, res) => {
    try {
        const promotions = await db.getTvPromotions();
        res.json({ success: true, count: promotions.length, data: promotions });
    } catch (err) {
        logEvent('ERROR', 'Erro ao obter promoções para TV: ' + err.message);
        res.status(err.status || 500).json({ success: false, error: err.message });
    }
});

// 2. Products List
app.get('/api/products', async (req, res) => {
    try {
        const { search, status, promo, stock, sort, page, pageSize } = req.query;
        const result = await db.getProducts({
            search: search || '',
            status: status || 'TODOS',
            promo: promo || 'TODOS',
            stock: stock || 'TODOS',
            sort: sort || 'PADRAO',
            page: parseInt(page, 10) || 1,
            pageSize: parseInt(pageSize, 10) || 24
        });
        res.json({ success: true, data: result });
    } catch (err) {
        logEvent('ERROR', 'Erro ao listar produtos: ' + err.message);
        res.status(err.status || 500).json({ success: false, error: err.message });
    }
});

// 3. Product Details
app.get('/api/products/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const product = await db.getProductById(id);
        if (!product) {
            return res.status(404).json({ success: false, error: 'Produto não encontrado' });
        }
        res.json({ success: true, data: product });
    } catch (err) {
        logEvent('ERROR', `Erro ao buscar produto ${req.params.id}: ` + err.message);
        res.status(err.status || 500).json({ success: false, error: err.message });
    }
});

// 4. Product Image Stream
app.get('/api/products/:id/image', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const versao = typeof req.query.v === 'string' ? req.query.v : '';
        const img = await db.getProductImage(id, versao, parseInt(req.query.w, 10) || 0);
        if (!img) {
            // Return 404 or transparent SVG placeholder
            res.setHeader('Content-Type', 'image/svg+xml');
            return res.send(`
                <svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
                    <rect width="100%" height="100%" fill="#f1f5f9"/>
                    <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#94a3b8" font-family="sans-serif" font-size="14">Sem Foto</text>
                </svg>
            `);
        }
        const buf = img.buffer || (img.path && fs.existsSync(img.path) ? fs.readFileSync(img.path) : null);
        if (!buf) {
            res.setHeader('Content-Type', 'image/svg+xml');
            return res.send(`
                <svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
                    <rect width="100%" height="100%" fill="#0f172a"/>
                    <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#64748b" font-family="sans-serif" font-size="14">Sem Foto</text>
                </svg>
            `);
        }
        res.setHeader('Content-Type', img.type || 'image/jpeg');
        res.setHeader('Cache-Control', req.query.v ? 'public, max-age=86400' : 'public, max-age=3600');
        res.send(buf);
    } catch (err) {
        res.status(500).end();
    }
});

// 5. Upload Product Image
app.post('/api/products/:id/image', upload.single('image'), async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'Nenhum arquivo enviado' });
        }
        await db.saveProductImage(id, req.file.buffer);
        logEvent('UPDATE', `Foto atualizada para produto ${id}`);
        res.json({ success: true, message: 'Foto atualizada com sucesso' });
    } catch (err) {
        logEvent('ERROR', `Erro ao salvar foto produto ${req.params.id}: ` + err.message);
        res.status(err.status || 500).json({ success: false, error: err.message });
    }
});

// 6. Update Status (Ativar / Inativar)
app.put('/api/products/:id/status', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const { status } = req.body;
        if (status !== 'A' && status !== 'I') {
            return res.status(400).json({ success: false, error: "Status deve ser 'A' ou 'I'" });
        }
        const updated = await db.updateProductStatus(id, status);
        logEvent('AUDIT', `Status do produto ${id} alterado para ${status === 'A' ? 'ATIVO' : 'INATIVO'} (Auditoria gerada)`);
        res.json({ success: true, data: updated });
    } catch (err) {
        logEvent('ERROR', `Erro ao alterar status do produto ${req.params.id}: ` + err.message);
        res.status(err.status || 500).json({ success: false, error: err.message });
    }
});

// 7. Update Price
app.put('/api/products/:id/price', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const { precoVenda, precoMinimo } = req.body;
        const updated = await db.updateProductPrice(id, precoVenda, precoMinimo);
        logEvent('AUDIT', `Preço do produto ${id} alterado para R$ ${Number(updated.precoVenda).toFixed(2)} (Auditoria gerada)`);
        res.json({ success: true, data: updated });
    } catch (err) {
        logEvent('ERROR', `Erro ao alterar preço do produto ${req.params.id}: ` + err.message);
        res.status(err.status || 500).json({ success: false, error: err.message });
    }
});

// 8. Update Promotion
app.put('/api/products/:id/promotion', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const { ativo, valorPromocional, dtInicio, dtFim, tipoValor } = req.body;
        const updated = await db.updateProductPromotion(id, {
            ativo: ativo !== false,
            valorPromocional,
            dtInicio,
            dtFim,
            tipoValor: tipoValor || 'V'
        });
        logEvent('AUDIT', `Promoção do produto ${id} atualizada: ${ativo ? 'R$ ' + valorPromocional : 'Removida'} (Auditoria gerada)`);
        res.json({ success: true, data: updated });
    } catch (err) {
        logEvent('ERROR', `Erro ao atualizar promoção do produto ${req.params.id}: ` + err.message);
        res.status(err.status || 500).json({ success: false, error: err.message });
    }
});

// 9. Update Stock with Upweb Movement & Audit
app.put('/api/products/:id/stock', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const { estoque, motivo } = req.body;
        const updated = await db.updateProductStock(id, estoque, motivo);
        logEvent('AUDIT', `Estoque do produto ${id} alterado para ${estoque} (Movimento e Auditoria Upweb gerados)`);
        res.json({ success: true, data: updated });
    } catch (err) {
        logEvent('ERROR', `Erro ao atualizar estoque do produto ${req.params.id}: ` + err.message);
        res.status(err.status || 500).json({ success: false, error: err.message });
    }
});

// 10. Quick Edit (Preço, Promoção, Estoque, Status) - Origem Upweb
app.put('/api/products/:id/quick-edit', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const updated = await db.quickEditProduct(id, req.body);
        logEvent('AUDIT', `Edição rápida do produto ${id} concluída (Origem: Upweb)`);
        res.json({ success: true, data: updated });
    } catch (err) {
        logEvent('ERROR', `Erro na edição rápida do produto ${req.params.id}: ` + err.message);
        res.status(err.status || 500).json({ success: false, error: err.message });
    }
});

// 11. Update Specific Product Fields
app.put('/api/products/:id/fields', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const updated = await db.updateProductFields(id, req.body);
        logEvent('AUDIT', `Campos cadastrais do produto ${id} alterados (Auditoria gerada)`);
        res.json({ success: true, data: updated });
    } catch (err) {
        logEvent('ERROR', `Erro ao atualizar campos do produto ${req.params.id}: ` + err.message);
        res.status(err.status || 500).json({ success: false, error: err.message });
    }
});

// 10. Product Sales History
app.get('/api/products/:id/sales', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const history = await db.getProductSalesHistory(id);
        res.json({ success: true, data: history });
    } catch (err) {
        logEvent('ERROR', `Erro ao buscar histórico de vendas ${req.params.id}: ` + err.message);
        res.status(err.status || 500).json({ success: false, error: err.message });
    }
});

// 11. Audit History List
app.get('/api/audit', async (req, res) => {
    try {
        const history = await db.getAuditHistory();
        res.json({ success: true, data: history });
    } catch (err) {
        logEvent('ERROR', 'Erro ao obter histórico de auditoria: ' + err.message);
        res.status(err.status || 500).json({ success: false, error: err.message });
    }
});

// 12. Server Logs endpoint (for GUI)
app.get('/api/logs', (req, res) => {
    res.json({ success: true, data: recentLogs });
});

// --- 13. Orders & Password API (KDS & Fila) ---
app.get('/api/orders', async (req, res) => {
    try {
        const { filter, search, limit } = req.query;
        const orders = await db.getOrders({
            filter: filter || 'PREPARO',
            search: search || '',
            limit: parseInt(limit, 10) || 50,
            todosDias: req.query.todosDias === '1'
        });
        res.json({ success: true, count: orders.length, data: orders });
    } catch (err) {
        logEvent('ERROR', 'Erro ao listar pedidos: ' + err.message);
        res.status(err.status || 500).json({ success: false, error: err.message });
    }
});

app.get('/api/orders/next-password', async (req, res) => {
    try {
        const senha = await db.generateNextDailyPassword();
        res.json({ success: true, senha });
    } catch (err) {
        logEvent('ERROR', 'Erro ao gerar senha: ' + err.message);
        res.status(err.status || 500).json({ success: false, error: err.message });
    }
});

app.put('/api/orders/:id/status', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const { action } = req.body;
        const result = await db.updateOrderStatus(id, action);
        logEvent('AUDIT', `Status do pedido ${id} alterado para ${action}`);
        res.json({ success: true, data: result });
    } catch (err) {
        logEvent('ERROR', `Erro ao atualizar status do pedido ${req.params.id}: ` + err.message);
        res.status(err.status || 500).json({ success: false, error: err.message });
    }
});

app.put('/api/orders/:id/password', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const { senha } = req.body;
        const result = await db.assignOrderPassword(id, senha);
        logEvent('AUDIT', `Senha do pedido ${id} alterada para ${senha}`);
        res.json({ success: true, data: result });
    } catch (err) {
        logEvent('ERROR', `Erro ao atribuir senha ao pedido ${req.params.id}: ` + err.message);
        res.status(err.status || 500).json({ success: false, error: err.message });
    }
});

app.post('/api/orders/quick-ticket', async (req, res) => {
    try {
        const result = await db.createQuickTicket(req.body);
        logEvent('AUDIT', `Novo ticket/pedido ${result.id} gerado com senha ${result.senha}`);
        res.json({ success: true, data: result });
    } catch (err) {
        logEvent('ERROR', 'Erro ao emitir ticket rápido: ' + err.message);
        res.status(err.status || 500).json({ success: false, error: err.message });
    }
});

// --- Promocoes (ativas / expirando / futuras / vencidas) ---
app.get('/api/promotions', async (req, res) => {
    try {
        const estado = String(req.query.estado || 'TODAS').toUpperCase();
        const data = await db.getPromotions({ estado, diasAlerta: req.query.dias });
        res.json({ success: true, data });
    } catch (err) {
        logEvent('ERROR', 'Erro ao listar promoções: ' + err.message);
        res.status(err.status || 500).json({ success: false, error: err.message });
    }
});

// --- Edicao em lote ---
app.post('/api/products/batch', async (req, res) => {
    try {
        const { ids, acao, params } = req.body || {};
        const result = await db.batchUpdateProducts({ ids, acao, params: params || {} });
        logEvent('AUDIT', `Lote ${acao}: ${result.ok}/${result.total} produtos alterados (Auditoria gerada)`);
        res.json({ success: true, data: result });
    } catch (err) {
        logEvent('ERROR', 'Erro na edição em lote: ' + err.message);
        res.status(err.status || 500).json({ success: false, error: err.message });
    }
});

// --- Eventos em tempo real (Server-Sent Events) ---
const sseClients = new Set();
function sseBroadcast(evt) {
    const data = `event: ${evt}\ndata: ${Date.now()}\n\n`;
    for (const client of sseClients) {
        try { client.write(data); } catch (e) { sseClients.delete(client); }
    }
}

app.get('/api/events', (req, res) => {
    res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
    });
    res.flushHeaders && res.flushHeaders();
    res.write('retry: 3000\n\n');
    res.write(`event: hello\ndata: ${Date.now()}\n\n`);
    sseClients.add(res);
    const beat = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) {} }, 20000);
    res.on('close', () => { clearInterval(beat); sseClients.delete(res); });
});

// Vigia o banco (mudancas feitas pelo ERP/PDV) enquanto houver paineis conectados
let lastSignatures = null;
let watcherTimer = null;
function startChangeWatcher() {
    if (watcherTimer) return;
    watcherTimer = setInterval(async () => {
        if (process.env.DEBUG_SSE) console.log('SSE tick clientes=' + sseClients.size);
        if (sseClients.size === 0) { lastSignatures = null; return; }
        try {
            const sig = await db.getChangeSignatures();
            if (lastSignatures) {
                if (sig.orders !== lastSignatures.orders) sseBroadcast('orders');
                if (sig.products !== lastSignatures.products) sseBroadcast('products');
            }
            lastSignatures = sig;
        } catch (e) { console.warn('WATCHER:', e.message); }
    }, 3000);
    if (watcherTimer.unref) watcherTimer.unref();
}

// Erros de parsing/upload viram JSON (o handler padrao devolve HTML com stack trace)
app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err.status || err.statusCode || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
    const msg = err.type === 'entity.parse.failed' ? 'JSON inválido'
        : (err.code === 'LIMIT_FILE_SIZE' ? 'Arquivo muito grande (máx. 10 MB)' : err.message);
    res.status(status).json({ success: false, error: msg });
});

// --- TV Digital Signage Hosting (Port 8081 & /tv mirror on Port 8080) ---
const tvDisplayPath = path.join(__dirname, '..', 'tv_display');
if (fs.existsSync(tvDisplayPath)) {
    // Serve on main app as mirror
    app.use('/tv', express.static(tvDisplayPath));

    // Serve on dedicated tvApp (Port 8081)
    tvApp.use(express.static(tvDisplayPath));
    tvApp.get('*', (req, res) => {
        res.sendFile(path.join(tvDisplayPath, 'index.html'));
    });
}

// --- Orders & Password Panel Hosting (Port 8082 & /pedidos mirror on Port 8080) ---
const ordersDisplayPath = path.join(__dirname, '..', 'orders_display');
if (fs.existsSync(ordersDisplayPath)) {
    // Serve on main app as mirror
    app.use('/pedidos', express.static(ordersDisplayPath));

    // Serve on dedicated ordersApp (Port 8082)
    ordersApp.use(express.static(ordersDisplayPath));
    ordersApp.get('*', (req, res) => {
        res.sendFile(path.join(ordersDisplayPath, 'index.html'));
    });
}

// --- Static Flutter Web Hosting ---
// When the Flutter app is compiled to build/web, serve it directly!
const flutterWebPath = path.join(__dirname, '..', '..', 'flutter_web', 'build', 'web');
if (fs.existsSync(flutterWebPath)) {
    app.use(express.static(flutterWebPath));
    app.get('*', (req, res) => {
        if (!req.path.startsWith('/api/') && !req.path.startsWith('/tv') && !req.path.startsWith('/pedidos')) {
            return res.sendFile(path.join(flutterWebPath, 'index.html'));
        }
        res.status(404).json({ success: false, error: 'Rota não encontrada' });
    });
}

function startServer(port = PORT, tvPort = PORT_TV, ordersPort = PORT_ORDERS) {
    startChangeWatcher();
    return new Promise((resolve, reject) => {
        const server = app.listen(port, () => {
            logEvent('SYSTEM', `Servidor Principal HTTP ativo na porta ${port}`);
            logEvent('DATABASE', `Conectado ao Firebird 5.0 (3060:DADOS.FDB)`);

            let tvServer = null;
            let ordersServer = null;

            try {
                tvServer = tvApp.listen(tvPort, () => {
                    logEvent('SYSTEM', `Servidor Vitrine TV ativo na porta ${tvPort} (http://localhost:${tvPort})`);
                });
                tvServer.on('error', (err) => {
                    logEvent('ERROR', `Aviso ao abrir porta TV ${tvPort}: ` + err.message);
                });
            } catch (err) {
                logEvent('ERROR', `Erro ao iniciar porta TV: ` + err.message);
            }

            try {
                ordersServer = ordersApp.listen(ordersPort, () => {
                    logEvent('SYSTEM', `Servidor Painel de Pedidos & Senhas ativo na porta ${ordersPort} (http://localhost:${ordersPort})`);
                    resolve({ app, server, port, tvApp, tvServer, tvPort, ordersApp, ordersServer, ordersPort });
                });
                ordersServer.on('error', (err) => {
                    logEvent('ERROR', `Aviso ao abrir porta Pedidos ${ordersPort}: ` + err.message);
                    resolve({ app, server, port, tvApp, tvServer, tvPort, ordersApp, ordersServer: null, ordersPort });
                });
            } catch (err) {
                logEvent('ERROR', `Erro ao iniciar porta Pedidos: ` + err.message);
                resolve({ app, server, port, tvApp, tvServer, tvPort, ordersApp, ordersServer: null, ordersPort });
            }
        });
        server.on('error', (err) => {
            logEvent('ERROR', `Falha ao abrir porta principal ${port}: ` + err.message);
            reject(err);
        });
    });
}

if (require.main === module) {
    startServer().catch(() => process.exit(1));
}

module.exports = { app, tvApp, ordersApp, startServer, logEvent, recentLogs, sseBroadcast };
