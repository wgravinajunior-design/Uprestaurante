# DUSUCO ERP – Catálogo, Promoções e Fila de Pedidos

Aplicação local sobre o banco **Firebird 5** do ERP:

| Parte | Pasta | O que faz |
|---|---|---|
| Servidor + janela de monitoramento | `server-electron/` | API REST (Express), conexão direta ao Firebird (`node-firebird`, pool), eventos em tempo real (SSE), Electron |
| App web (Flutter, instalável como PWA) | `flutter_web/` | Produtos, edição rápida, **edição em lote**, **promoções** (ativas/expirando/futuras/vencidas/**agendadas**), foto pela câmera, auditoria, tela de **servidor offline** com reconexão |
| Vitrine de promoções (TV) | `server-electron/tv_display` | Porta 8081: layouts **destaque / grade / rotação com banners** e **chamada de senha por voz**. Configuração em `/admin.html` |
| Painel de pedidos e senhas | `server-electron/orders_display` | Porta 8082: **tempo médio de preparo** e **alerta de pedido parado** |
| KDS (cozinha por estação) | `server-electron/kds_display` | `http://localhost:8082/kds/` |
| Área pública (cliente) | `server-electron/public_display` | Porta **8083**: acompanhar a **senha** pelo celular (`/senha`) e **cardápio digital** (`/cardapio`) |

## Como usar
Execute `iniciar_sistema.bat` e escolha uma opção (1 = servidor completo; 6 = recompilar o Flutter; 7 = diagnóstico).

- API / app: <http://localhost:8080> · TV: <http://localhost:8081> · Pedidos: <http://localhost:8082> · KDS: <http://localhost:8082/kds/> · Cliente: <http://localhost:8083>
- Diagnóstico (conexão, colunas e dados): `cd server-electron && node diagnostico.js`

## Configuração
Variáveis de ambiente (ou `server-electron/config/db.json`; veja `db.example.json`):

| Variável | Padrão |
|---|---|
| `FB_DB_CONN` | `localhost/3060:<pasta do usuário>\OneDrive\DADOS\DUSUCO\DADOS.FDB` |
| `FB_USER` / `FB_PASSWORD` | `SYSDBA` / `masterkey` (**troque a senha**) |
| `FB_POOL` | `5` conexões |
| `API_TOKEN` | vazio. Se definido, escritas exigem o header `x-api-token` (no Flutter: `--dart-define=API_TOKEN=...`; no painel de pedidos: abrir uma vez com `?token=...`) |

> **Importante:** não deixe o `.FDB` em pasta sincronizada pelo OneDrive. Arquivos "somente na nuvem" não abrem no Firebird e a sincronização com o banco aberto pode corrompê-lo.

## Notas técnicas
- O banco usa charset `NONE` com texto em **Windows-1252**; a conexão usa `encoding: WIN1252`.
- `PEV_SENHA` e `PEV_MESA` são **inteiros**; `PRD_OBSERVACAO` é BLOB (lido/gravado por bytes).
- Alterações geram auditoria (`TB_AUDITORIA` / `TB_AUDITORIA_ITEM`); estoque gera movimento (`TB_PRODUTO_MOVIMENTO`).
- Imagens: cache em `server-electron/cache` (miniaturas via `?w=`), invalidado quando `PRD_ULTIMA_ALTERACAO` muda.

## Promoções agendadas
O ERP guarda uma promoção por produto. Para deixar a "promoção da sexta" pronta sem derrubar a que está valendo:
- produto **sem** promoção vigente/futura → a promoção é gravada direto no cadastro com as datas (o ERP passa a respeitá-las);
- produto **com** promoção vigente/futura → entra na fila (`config/promo_agenda.json`) e é aplicada no dia do início (verificação a cada minuto e ao ligar o servidor);
- períodos que se sobrepõem geram **aviso de conflito** (HTTP 409); o usuário pode confirmar "agendar mesmo assim".

## TV, voz e alertas
- Configurações (layout, tempo por tela, itens da grade, voz, limite de alerta) ficam em `config/company_theme.json`, editáveis em `http://localhost:8081/admin.html`.
- A chamada de senha usa a voz do navegador (`speechSynthesis`, pt-BR). O navegador exige **um toque** na TV para liberar o áudio (ou iniciar o Chrome com `--autoplay-policy=no-user-gesture-required`).
- Banners: imagens enviadas em `/admin.html`, guardadas em `config/banners/`.

## Área do cliente (QR Code, senha e cardápio)
- A porta **8083** é separada e **somente leitura**: expõe só `/senha`, `/cardapio`, `/api/public/*`, a foto do produto e o logotipo. A API administrativa (8080) não é acessível por ela. Libere no firewall **apenas a 8083** para o Wi-Fi dos clientes.
- Os QR Codes (cardápio e senha) são gerados e impressos em `http://localhost:8081/admin.html`; o cupom do painel de pedidos também imprime o QR da senha.
- O cliente digita a senha (ou lê o QR do cupom) e é avisado na própria tela, por vibração, som e notificação, quando o pedido fica pronto.
- Cardápio: grupos "exibir no touch" do ERP, promoções vigentes em destaque, produtos ocultáveis em `/admin.html`.

## KDS (cozinha por estação)
- Cada item vai para uma estação por regra: produto → grupo → setor do ERP (`TB_SETOR`, `PRD_SETOR`) → estação padrão. As estações são editadas em `/admin.html`.
- Cada estação conclui o seu pedaço; o pedido vira PRONTO no ERP quando **todas** concluírem. O estado por estação fica em `config/kds_state.json`.
- A coluna "Preparar agora" agrupa os itens iguais de todos os pedidos pendentes.

## Dashboard e "o que mudou hoje"
- Dashboard (`GET /api/dashboard`): vendas finalizadas (`PEV_STATUS = 'F'`), faturamento, pedidos, ticket médio, comparativo, horários de pico, dia da semana e mais vendidos.
- Mudanças do dia (`GET /api/changes`): auditoria do ERP e deste sistema, movimentos de estoque que não são venda e produtos alterados sem detalhe.

## Endpoints principais
`GET /api/products` · `PUT /api/products/:id/{price,promotion,stock,status,quick-edit,fields}` ·
`POST /api/products/batch` · `GET /api/promotions` · `GET /api/orders` · `PUT /api/orders/:id/status` ·
`POST /api/orders/quick-ticket` · `GET /api/events` (SSE) · `GET /api/products/:id/image?w=400&v=<carimbo>` ·
`POST /api/promotions/schedule` · `GET /api/promotions/agenda` · `DELETE /api/promotions/agenda/:id` ·
`GET|POST|DELETE /api/tv/banners` · `GET /api/health` ·
`GET /api/dashboard` · `GET /api/changes` · `GET|PUT /api/kds/config` · `GET /api/kds/orders` · `POST /api/kds/orders/:id/done` ·
`GET /api/qr` · `GET /api/public-info` · `GET|PUT /api/cardapio/config`

## Testes
Os testes gravam dados e só rodam contra uma **cópia** do banco. Veja `server-electron/tests/README.md`.
