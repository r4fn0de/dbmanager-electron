# Guia completo de Auto-Update (Electron Forge + update-electron-app + Cloudflare R2)

Este guia documenta o fluxo completo de atualização automática do app usando **apenas**:

- `update-electron-app`
- `UpdateSourceType.StaticStorage`
- Cloudflare R2 exposto por HTTP (domínio próprio)

> **Não usa GitHub Releases como fonte de update** e **não usa `electron-updater`**.

---

## 1) Visão geral da arquitetura

Fluxo (manual via `latest.json`):

1. CI/local gera builds com `bun run make` (Electron Forge).
2. Artefatos são enviados ao R2 em `updates/<platform>/<arch>/`.
3. Publica `updates/latest.json` com versão e `downloadUrl`.
4. App consulta `latest.json` (via oRPC), compara versão e mostra CTA.
5. Usuário clica em **Download latest version** e instala manualmente.

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

## 7) Disparo de release (CI-only) — recomendado

O fluxo de update agora é **somente via CI**.

Use:

```bash
bun run release:updates:r2
```

Esse comando executa `scripts/release-r2-ci-dispatch.sh`, que:

- valida `gh` autenticado
- exige working tree limpo
- dispara o workflow `.github/workflows/publish.yaml`

### 7.1 Execução direta pelo GitHub Actions

- Actions → **Publish Manual Updates (latest.json)**
- Clique em **Run workflow**
- (Opcional) preencha `release_notes`

### 7.2 Scripts locais de update (bloqueados por padrão)

Os scripts abaixo continuam existindo, mas bloqueiam execução local:

- `scripts/upload-r2-updates.sh`
- `scripts/publish-latest-json.sh`
- `scripts/cleanup-r2-old-updates.sh`

Para uso emergencial local, habilite explicitamente:

```bash
ALLOW_LOCAL_UPDATE_SCRIPTS=1 <comando>
```

Exemplo:

```bash
ALLOW_LOCAL_UPDATE_SCRIPTS=1 bun run upload:updates:r2
```

---

## 8) CI/CD (GitHub Actions)

Workflow: `.github/workflows/publish.yaml`

Ele:

1. Roda em `macos-13` para **x64**
2. Roda em `macos-14` para **arm64**
3. Instala deps com Bun
4. Executa `bun run make -- --arch=<arch>`
5. Executa `bun run upload:updates:r2` em cada job
6. Publica `latest.json` no job final, incluindo os dois `download_path` (x64 + arm64)

Isso garante publicação consistente de artefatos para as duas arquiteturas no mesmo fluxo.

---

## 9) Passo a passo para lançar uma nova atualização

### Formato recomendado do `latest.json` (com arquitetura)

```json
{
  "version": "0.1.4",
  "downloadUrl": "https://update.novon.tech/updates/darwin/arm64/TarsDB-0.1.4-arm64.zip",
  "downloads": {
    "darwin": {
      "arm64": "https://update.novon.tech/updates/darwin/arm64/TarsDB-0.1.4-arm64.zip",
      "x64": "https://update.novon.tech/updates/darwin/x64/TarsDB-0.1.4-x64.zip"
    }
  },
  "notes": "Bug fixes and stability improvements.",
  "publishedAt": "2026-05-06T00:00:00Z"
}
```

O app detecta `platform` + `arch` e prioriza `downloads[platform][arch]`.

### 9.1 Pré-requisitos

- Secrets/vars do workflow configurados (`R2_BUCKET`, `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `UPDATE_BASE_URL`, etc.)
- `gh auth login` (se for disparar via CLI)
- Versão já atualizada no `package.json` quando necessário

### 9.2 Lançamento (recomendado via CLI)

```bash
bun run release:updates:r2
```

### 9.3 Lançamento via UI (alternativo)

- Actions → **Publish Manual Updates (latest.json)**
- Clique em **Run workflow**
- (Opcional) preencha `release_notes`

### 9.4 Commit da release (quando houver bump de versão)

```bash
git add package.json bun.lock
git commit -m "chore(release): vX.Y.Z"
git push
```

### 9.5 Verificação pós-release

- Verificar `updates/latest.json` publicado
- Verificar artefatos em `updates/darwin/arm64/` e `updates/darwin/x64/`
- Abrir app → Settings → Updates → **Check latest release**
- Confirmar que mostra `latestVersion` e habilita **Download latest version**

---

### 9.6 Limpeza de versões antigas (economizar storage)

Via CI (recomendado) ou local em emergência com override:

```bash
# simulação (emergência local)
ALLOW_LOCAL_UPDATE_SCRIPTS=1 DRY_RUN=1 KEEP_VERSIONS=2 bun run cleanup:updates:r2

# execução real (emergência local)
ALLOW_LOCAL_UPDATE_SCRIPTS=1 KEEP_VERSIONS=2 bun run cleanup:updates:r2
```

Isso apaga apenas `updates-archive/v*/...` antigos e mantém as 2 versões mais novas (latest e anterior).

> Recomendado também: configurar Lifecycle Rule no Cloudflare R2 para expirar objetos antigos automaticamente.

## 10) Troubleshooting

## 10.1 Tela de Updates mostra `-`

- Clique em **Check latest release**
- Verifique se `updates/latest.json` existe e está público
- Verifique `UPDATE_BASE_URL` / `UPDATE_META_URL`

## 10.2 Erro ao checar release

- Verifique formato JSON (campos obrigatórios: `version`, `downloadUrl`)
- Verifique URL HTTPS válida no `downloadUrl`

## 10.3 CI falha no publish do latest.json

- Confirme secrets `R2_BUCKET`, `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
- Confirme que os artefatos `.zip` foram gerados em `out/make`

## 10.4 Tentativa de upload local bloqueada

- Comportamento esperado: fluxo oficial é CI-only
- Para emergência, use `ALLOW_LOCAL_UPDATE_SCRIPTS=1`

---

## 11) Checklist final

- [ ] Versão atualizada no `package.json` (quando aplicável)
- [ ] Workflow `publish.yaml` concluído sem erro
- [ ] Artefatos enviados para `updates/<platform>/<arch>/`
- [ ] `updates/latest.json` publicado
- [ ] `downloadUrl` do `latest.json` válido
- [ ] Testado no app: **Check latest release** + **Download latest version**

---

## 12) Resumo rápido do fluxo

`bun run release:updates:r2` → dispatch do workflow CI `publish.yaml` → build/upload x64 + arm64 no R2 → publish de `updates/latest.json` → app consulta `latest.json` → usuário clica em **Download latest version** para atualizar manualmente.
