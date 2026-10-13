# Testes de integração

Estes testes **gravam** no banco (produtos, estoque, pedidos, auditoria). Por isso só rodam contra uma **cópia
descartável**; `_guard.js` recusa o banco de produção.

1. Faça a cópia (use uma pasta que o serviço do Firebird consiga ler, fora do OneDrive):

   ```
   node tests/preparar_copia.js "C:\\caminho\\BASE TESTE\\DADOS.FDB" C:\\Users\\Public\\fbtest\\DADOS.FDB
   ```

2. Rode (a cada execução use uma cópia **nova**: os testes inserem produtos com IDs fixos):

   ```
   set FB_DB_CONN=localhost/3060:C:\\Users\\Public\\fbtest\\DADOS.FDB
   set FB_ALLOW_WRITES=1
   npm test
   ```

- `escrita.test.js`: preço, promoção, estoque (com concorrência), acentos, auditoria, tickets, pedidos, imagem, validações.
- `http.test.js`: /api/promotions, /api/products/batch, miniaturas, BLOB e eventos em tempo real (SSE).
