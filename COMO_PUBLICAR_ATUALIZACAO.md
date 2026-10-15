# Publicar uma atualização

1. Aumente `version` em `server-electron/package.json` (ex.: 1.0.1).
2. Se o Flutter mudou: `cd flutter_web && flutter build web`.
3. Defina o token e publique:
   ```
   set GH_TOKEN=<token com permissão repo>   (ou use: gh auth token)
   cd server-electron
   npm run release
   ```
   Isso gera o instalador e envia para a Release do GitHub (como rascunho: publique-a em Releases).
4. Os sistemas instalados verificam a cada 4h (e ao abrir) e atualizam sozinhos.

Observação: o repositório precisa ser **público** para os clientes baixarem as atualizações sem token.
