# DUSUCO ERP – Catálogo, Promoções e Fila de Pedidos

Aplicação local sobre o banco **Firebird 5** do ERP:

| Parte | Pasta | O que faz |
|---|---|---|
| Servidor + janela de monitoramento | `server-electron/` | API REST (Express), conexão direta ao Firebird (`node-firebird`, pool), eventos em tempo real (SSE), Electron |
| App web (Flutter, instalável como PWA) | `flutter_web/` | Produtos, edição rápida, **edição em lote**, **promoções** (ativas/expirando/futuras/vencidas/**agendadas**), foto pela câmera, auditoria, tela de **servidor offline** com reconexão |
| Vitrine de promoções (TV) | `server-electron/tv_display` | Porta 8081: layouts **destaque / grade / rotação com banners** e **chamada de senha por voz**. Configuração em `/admin.html` |
| Painel de pedidos e senhas | `server-electron/orders_display` | Porta 8082: **tempo médio de preparo** e **alerta de pedido parado** |

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

## Promoções agendadas
O ERP guarda uma promoção por produto. Para deixar a "promoção da sexta" pronta sem derrubar a que está valendo:
- produto **sem** promoção vigente/futura → a promoção é gravada direto no cadastro com as datas (o ERP passa a respeitá-las);
- produto **com** promoção vigente/futura → entra na fila (`config/promo_agenda.json`) e é aplicada no dia do início (verificação a cada minuto e ao ligar o servidor);
- períodos que se sobrepõem geram **aviso de conflito** (HTTP 409); o usuário pode confirmar "agendar mesmo assim".

## TV, voz e alertas
- Configurações (layout, tempo por tela, itens da grade, voz, limite de alerta) ficam em `config/company_theme.json`, editáveis em `http://localhost:8081/admin.html`.
- A chamada de senha usa a voz do navegador (`speechSynthesis`, pt-BR). O navegador exige **um toque** na TV para liberar o áudio (ou iniciar o Chrome com `--autoplay-policy=no-user-gesture-required`).
- Banners: imagens enviadas em `/admin.html`, guardadas em `config/banners/`.

## Endpoints principais
`GET /api/products` · `PUT /api/products/:id/{price,promotion,stock,status,quick-edit,fields}` ·
`POST /api/products/batch` · `GET /api/promotions` · `GET /api/orders` · `PUT /api/orders/:id/status` ·
`POST /api/orders/quick-ticket` · `GET /api/events` (SSE) · `GET /api/products/:id/image?w=400&v=<carimbo>` ·
`POST /api/promotions/schedule` · `GET /api/promotions/agenda` · `DELETE /api/promotions/agenda/:id` ·
`GET|POST|DELETE /api/tv/banners` · `GET /api/health`

## Testes
Os testes gravam dados e só rodam contra uma **cópia** do banco. Veja `server-electron/tests/README.md`.
