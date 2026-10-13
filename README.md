# DUSUCO ERP – Catálogo, Promoções e Fila de Pedidos

Aplicação local sobre o banco **Firebird 5** do ERP:

| Parte | Pasta | O que faz |
|---|---|---|
| Servidor + janela de monitoramento | `server-electron/` | API REST (Express), conexão direta ao Firebird (`node-firebird`, pool), eventos em tempo real (SSE), Electron |
| App web (Flutter) | `flutter_web/` | Produtos, edição rápida, **edição em lote**, **promoções** (ativas/expirando/futuras/vencidas), auditoria |
| Vitrine de promoções (TV) | `server-electron/tv_display` | Porta 8081 |
| Painel de pedidos e senhas | `server-electron/orders_display` | Porta 8082 |

## Como usar
Execute `iniciar_sistema.bat` e escolha uma opção (1 = servidor completo; 6 = recompilar o Flutter; 7 = diagnóstico).

- API / app: <http://localhost:8080> · TV: <http://localhost:8081> · Pedidos: <http://localhost:8082>
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

## Endpoints principais
`GET /api/products` · `PUT /api/products/:id/{price,promotion,stock,status,quick-edit,fields}` ·
`POST /api/products/batch` · `GET /api/promotions` · `GET /api/orders` · `PUT /api/orders/:id/status` ·
`POST /api/orders/quick-ticket` · `GET /api/events` (SSE) · `GET /api/products/:id/image?w=400&v=<carimbo>`

## Testes
Os testes gravam dados e só rodam contra uma **cópia** do banco. Veja `server-electron/tests/README.md`.
