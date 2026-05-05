# Guia completo de Auto-Update (Electron Forge + update-electron-app + Cloudflare R2)

Este guia documenta o fluxo completo de atualização automática do app usando **apenas**:

- `update-electron-app`
- `UpdateSourceType.StaticStorage`
- Cloudflare R2 exposto por HTTP (domínio próprio)

> **Não usa GitHub Releases como fonte de update** e **não usa `electron-updater`**.

---

## 1) Visão geral da arquitetura

Fluxo:

1. CI gera builds com `bun run make` (Electron Forge).
2. Artefatos de update são enviados ao R2 em `updates/<platform>/<arch>/`.
3. App em produção resolve URL:
   - `${UPDATE_BASE_URL}/${process.platform}/${process.arch}`
4. `update-electron-app` consulta o feed estático dessa pasta.
5. Se houver versão nova, baixa e solicita reinício para aplicar.

---

## 2) Pré-requisitos

- Electron Forge configurado (já está no projeto)
- Dependências:
  - `update-electron-app`
  - `electron-log`
- Domínio público para updates (ex.: `https://updates.seudominio.com`)
- Bucket R2 com acesso S3-compatible
- App macOS assinado (requisito da stack de auto-update no macOS)

---

## 3) Variáveis de ambiente

## 3.1 Runtime do app (produção)

Obrigatória:

```bash
UPDATE_BASE_URL=https://update.novon.tech/updates
```

O app monta automaticamente:

- Windows x64: `https://update.novon.tech/updates/win32/x64`
- macOS arm64: `https://update.novon.tech/updates/darwin/arm64`

Se `UPDATE_BASE_URL` não estiver definida, o app apenas loga aviso e **não checa updates**.

## 3.2 CI (GitHub Actions)

Secrets sugeridos:

- `UPDATE_BASE_URL`
- `R2_BUCKET`
- `R2_ENDPOINT` (ex.: `https://<accountid>.r2.cloudflarestorage.com`)
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`

Variable opcional:

- `UPDATE_BASE_PREFIX` (default: `updates`)

---

## 4) Código do main process

No `src/features/shell/main.ts`, o setup é feito em produção (`app.isPackaged`), usando `StaticStorage`:

```ts
const updateBaseUrl = process.env.UPDATE_BASE_URL?.trim().replace(/\/+$/, "");
if (!updateBaseUrl) {
  log.warn("[updater] UPDATE_BASE_URL is not defined; skipping auto-update checks.");
  return;
}

const baseUrl = `${updateBaseUrl}/${process.platform}/${process.arch}`;

updateElectronApp({
  updateSource: {
    type: UpdateSourceType.StaticStorage,
    baseUrl,
  },
  logger: log,
  updateInterval: "1 hour",
});
```

---

## 5) Estrutura obrigatória no R2

A estrutura de diretórios deve seguir:

```text
updates/
  win32/
    x64/
      RELEASES
      <app>-<versao>-full.nupkg
      <app> Setup <versao>.exe
  darwin/
    arm64/
      RELEASES.json
      <app>-darwin-arm64-<versao>.zip
```

Você pode adicionar outras combinações conforme buildar:

- `win32/arm64`
- `darwin/x64`
- etc.

### 5.1 Manifest esperado

- **Windows:** `RELEASES`
- **macOS:** `RELEASES.json`

Exemplo de `RELEASES.json`:

```json
{
  "currentRelease": "TarsDB-darwin-arm64-0.0.2.zip",
  "releases": [
    {
      "updateTo": {
        "name": "TarsDB-darwin-arm64-0.0.2.zip",
        "version": "0.0.2",
        "pub_date": "2026-05-05T12:00:00.000Z",
        "notes": "Bug fixes"
      }
    }
  ]
}
```

> Esses manifests são gerados pelo Forge makers quando `make` roda com configuração correta.

---

## 6) Configuração do Forge

No `forge.config.ts`:

- `MakerSquirrel` usa `remoteReleases` apontando para:
  - `${UPDATE_BASE_URL}/win32/${process.arch}`
- `MakerZIP` usa `macUpdateManifestBaseUrl` apontando para:
  - `${UPDATE_BASE_URL}/darwin/${process.arch}`

Exemplo (conceitual):

```ts
const updateBaseUrl = process.env.UPDATE_BASE_URL?.trim().replace(/\/+$/, "");

const winRemoteReleases = updateBaseUrl
  ? `${updateBaseUrl}/win32/${process.arch}`
  : undefined;

const macUpdateManifestBaseUrl = updateBaseUrl
  ? `${updateBaseUrl}/darwin/${process.arch}`
  : undefined;
```

---

## 7) Build e upload manual

## 7.1 Build

```bash
export UPDATE_BASE_URL="https://update.novon.tech/updates"
bun run make
```

## 7.2 Upload para R2

Script disponível:

- `scripts/upload-r2-updates.sh`

Uso:

```bash
export R2_BUCKET="meu-bucket"
export R2_ENDPOINT="https://<accountid>.r2.cloudflarestorage.com"
export AWS_ACCESS_KEY_ID="..."
export AWS_SECRET_ACCESS_KEY="..."
export UPDATE_BASE_PREFIX="updates"
export UPDATE_ARCHIVE_PREFIX="updates-archive"

bun run upload:updates:r2
```

Esse upload publica em dois caminhos:

- Ativo: `updates/<platform>/<arch>/...`
- Arquivo por versão: `updates-archive/v<version>/<platform>/<arch>/...`

Atalho:

```bash
bun run make:and:upload:updates:r2
```

---

## 8) CI/CD (GitHub Actions)

Workflow: `.github/workflows/publish.yaml`

Ele publica apenas **macOS arm64** via CI. Se você quiser publicar **x64**, faça localmente com `bun run release:updates:r2` no ambiente x64.

Ele:

1. Roda em `macos-latest` (arm64)
2. Instala deps com Bun
3. Executa `bun run make`
4. Executa `bun run upload:updates:r2`

Isso garante publicação dos artefatos de update em cada plataforma/arquitetura.

---

## 9) Como validar em ambiente real

## 9.1 Rodar app empacotado

- Instale/abra o app buildado (não em dev)
- Garanta `UPDATE_BASE_URL` configurada

## 9.2 Forçar testes de update

- Temporariamente reduzir intervalo para `"5 minutes"`
- Publicar uma versão mais nova no R2
- Reiniciar o app e observar checagem

## 9.3 Verificar logs

Com `electron-log`, procure por entradas como:

- URL base resolvida (`[updater] Using static storage URL: ...`)
- erros de conexão/manifest/arquivo

---

## 10) Troubleshooting

## 10.1 App não checa update

- Verifique `app.isPackaged` (em dev não checa)
- Verifique `UPDATE_BASE_URL`
- Verifique se a URL final por plataforma existe

## 10.2 404 no feed

- Confirme pasta correta: `updates/<platform>/<arch>/`
- Confirme presença de `RELEASES` (Win) ou `RELEASES.json` (macOS)

## 10.3 macOS não atualiza

- Verifique assinatura de código
- Confirme `.zip` presente junto do `RELEASES.json`

## 10.4 Windows não atualiza

- Confirme `RELEASES` + `.nupkg`
- Confirme nomes de arquivos sem alteração manual indevida

## 10.5 URL inválida no runtime

- Deve ser HTTPS pública
- Exemplo válido:
  - `https://update.novon.tech/updates`

---

## 11) Checklist final

- [ ] `update-electron-app` instalado
- [ ] `electron-log` instalado
- [ ] `electron-updater` fora do fluxo
- [ ] `main.ts` com `StaticStorage` + `UPDATE_BASE_URL`
- [ ] `forge.config.ts` com `remoteReleases`/`macUpdateManifestBaseUrl`
- [ ] Estrutura R2 em `updates/<platform>/<arch>/`
- [ ] Workflow CI publicando para R2
- [ ] Teste de update feito com app empacotado

---

## 12) Resumo rápido do fluxo

`bun run make` → gera artefatos e manifests → upload para R2 (`updates/<platform>/<arch>/`) → app em produção monta URL por `platform/arch` → `update-electron-app` checa/baixa update automaticamente.
