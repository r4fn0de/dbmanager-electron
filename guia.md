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

## 7) Release local (wizard interativo) — recomendado

Use o wizard para automatizar versão + build + upload:

```bash
bun run release:updates:r2
```

O wizard faz:

- valida dependências (`bun`, `node`, `aws`, `git`)
- alerta se há alterações locais não commitadas
- permite escolher: patch/minor/major/custom/manter versão
- build opcional (`bun run make`)
- upload opcional para R2
- dry-run opcional (simula upload sem enviar)
- validação opcional da listagem remota no R2

### 7.1 Configuração de ambiente para o wizard

Crie um arquivo local (não commitar):

```bash
cp .env.updates.example .env.updates
```

Preencha:

```bash
R2_BUCKET=your-bucket
R2_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
UPDATE_BASE_PREFIX=updates
UPDATE_ARCHIVE_PREFIX=updates-archive
```

> Se alguma variável estiver faltando, o wizard pergunta interativamente.

### 7.2 Upload manual (avançado)

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

Dry-run manual:

```bash
DRY_RUN=1 bun run upload:updates:r2
```

Esse upload publica em dois caminhos:

- Ativo: `updates/<platform>/<arch>/...`
- Arquivo por versão: `updates-archive/v<version>/<platform>/<arch>/...`

Atalho build+upload:

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

## 9) Passo a passo para lançar uma nova atualização

### 9.1 Pré-requisitos (uma vez)

- Configurar `.env.updates` (ou usar prompts do wizard)
- Garantir `UPDATE_BASE_URL=https://update.novon.tech/updates`

### 9.2 Lançamento local (recomendado)

```bash
bun run release:updates:r2
```

No wizard:

1. Escolha bump de versão (`patch/minor/major/custom`)
2. Confirme build (`bun run make`)
3. Confirme upload para R2
4. Confirme publish de `latest.json`
5. (Opcional) adicione release notes
6. (Opcional) escolha interativamente o artefato do `downloadUrl`

### 9.3 Commit da release

```bash
git add package.json bun.lock
git commit -m "chore(release): vX.Y.Z"
git push
```

### 9.4 Lançamento via CI (alternativo)

- Actions → **Publish Manual Updates (latest.json)**
- Clique em **Run workflow**
- (Opcional) preencha `release_notes`

### 9.5 Verificação pós-release

- Verificar `updates/latest.json` publicado
- Verificar artefatos em `updates/darwin/arm64/` (e x64 se aplicável)
- Abrir app → Settings → Updates → **Check latest release**
- Confirmar que mostra `latestVersion` e habilita **Download latest version**

---

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

## 10.4 Download abre URL errada

- Refaça release e, no wizard, escolha manualmente o artefato de download
- Ou defina `LATEST_DOWNLOAD_PATH` explicitamente

---

## 11) Checklist final

- [ ] Versão atualizada no `package.json`
- [ ] Artefatos enviados para `updates/<platform>/<arch>/`
- [ ] `updates/latest.json` publicado
- [ ] `downloadUrl` do `latest.json` válido
- [ ] Workflow CI/manual concluído sem erro
- [ ] Testado no app: **Check latest release** + **Download latest version**

---

## 12) Resumo rápido do fluxo

`bun run release:updates:r2` → build + upload de artefatos no R2 + publish de `updates/latest.json` → app consulta `latest.json` → usuário clica em **Download latest version** para atualizar manualmente.
