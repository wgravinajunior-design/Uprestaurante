# Publicar uma atualização

1. Aumente `version` em `server-electron/package.json` (ex.: 1.0.7).
2. Se o Flutter mudou: `cd flutter_web && flutter build web`.
3. Publique (os testes rodam antes; se algum falhar, nada é publicado):
   ```
   set GH_TOKEN=<token com permissão repo>   (ou: gh auth token)
   cd server-electron
   npm run release
   ```
   Os testes usam uma **cópia** do banco em `C:\Users\Public\fbtest` (configurável por `FBTEST_DIR`) e nunca gravam na produção.
   Para pular em emergência: `set SKIP_TESTS=1`.
4. Publique a Release como "latest" em GitHub → Releases (se ficou como rascunho).
5. Os sistemas instalados verificam a cada 4h (e ao abrir). Veja em ⚙️ Configuração → 🔄 Atualizações.

O repositório precisa ser **público** para os clientes baixarem as atualizações sem token.

## Assinatura do instalador (remove o aviso do SmartScreen)

Requer um certificado de assinatura de código (OV/EV, arquivo `.pfx`). Com ele, antes do `npm run release`:

```
set CSC_LINK=C:\caminho\certificado.pfx
set CSC_KEY_PASSWORD=<senha do certificado>
```

O electron-builder assina o instalador e o executável automaticamente quando essas variáveis existem.
Sem certificado o instalador funciona, mas o Windows mostra "editor desconhecido" na primeira execução.

## Logs

O servidor grava `logs/server-AAAA-MM-DD.log` ao lado da pasta de configuração (`%APPDATA%\dusuco-erp-server\logs`),
mantendo 14 dias. Abra pela aba Atualizações → "Pasta de logs".
