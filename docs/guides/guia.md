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

---

## 13) Diretrizes de UI/UX (Design System)

Convenções visuais adotadas no projeto para consistência entre componentes.

### 13.1 Fontes

- **Body/UI**: `Mona Sans Variable` (fonte principal da interface)
- **Mono/Código**: `IBM Plex Mono` (SQL editor, connection strings, campos técnicos)
- **Heading**: `Mona Sans Variable` (mesma do body, peso diferenciado)
- Caracteres técnicos (0/O, l/1/I) bem diferenciados — ideal para database tools
- Nunca usar `Geist`, `Inter`, `Manrope` ou `IBM Plex Sans` (fontes antigas removidas)

### 13.2 Tipografia de labels

- **Nunca** usar `uppercase tracking-wider` em labels de formulário
- Labels padrão: `text-xs font-medium text-muted-foreground`
- Seções com ícone: ícone `size-3 text-muted-foreground/40` + label `text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider`

### 13.2 Inputs e grids

- Altura padrão: `h-8` (32px)
- Fonte mono em campos técnicos: `font-mono text-xs` (IBM Plex Mono)
- Grid de host + port: `grid-cols-[1fr_110px] gap-3`
- Grid de username + password: `grid-cols-2 gap-3`

### 13.3 Tags e chips

- Formato: pills arredondadas (`rounded-full`)
- Padding: `px-3 py-1`
- Tamanho do texto: `text-[11px] font-medium`
- Estado ativo: `border-primary/40 bg-primary/10 text-primary shadow-sm`
- Estado inativo: `border-border/60 text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground hover:bg-muted/30`
- Transição: `transition-colors duration-150`
- Press feedback: `active:scale-[0.97]`

### 13.4 Seletor de cor

- Tamanho: `size-5`
- Bordas: `ring-2 ring-offset-2 ring-offset-background ring-primary/50`
- Hover: `hover:scale-110 hover:shadow-md`
- Transição: `transition-transform duration-200 ease-out`
- Tooltip com hex: `title={colorOption}`

### 13.5 Cards de engine/provider

- Formato: cards verticais com ícone em container
- Container do ícone: `h-9 w-9 rounded-lg border`
- Ativo: `border-primary/20 bg-primary/10`
- Inativo: `border-border bg-muted/40`
- Card ativo: `border-primary/30 bg-primary/5 text-primary shadow-sm`
- Card inativo: `border-border hover:border-muted-foreground/30 hover:bg-muted/20`
- Transição: `transition-colors duration-150 ease-out`
- Press: `active:scale-[0.98]`

### 13.6 Botões

- Padrão: `h-8 px-5 text-xs gap-1.5 shadow-sm`
- Secundário/ghost: `h-8 px-3 text-xs`
- Icon-only: `transition-transform duration-150 ease-out active:scale-[0.97]`
- Loading: ícone `size-3.5 animate-spin`

### 13.7 Dialogs e footers

- Footer: `gap-2.5 border-t bg-muted/30 px-5 py-3.5`
- Botão primário: `h-8 px-5 text-xs gap-1.5 shadow-sm`
- Botão secundário (ghost): `h-8 px-3 text-xs`
- Título do dialog: `flex items-center gap-2 text-sm` com ícone contextual

### 13.8 Badges de status

- Tag: pill arredondada `rounded-full border border-border/60 bg-muted/30`
- Branch ativo: `rounded-full border border-primary/30 bg-primary/5 text-primary`
- Running: `rounded-full border border-emerald-500/20 bg-emerald-500/5 text-emerald-600`
- Stopped: `rounded-full border border-border/40 bg-muted/30 text-muted-foreground`

### 13.9 Connection cards

- Container: `rounded-xl px-3.5 py-2.5 border border-transparent hover:border-border/30`
- Hover: `hover:bg-muted/50`
- Ações: `opacity-0 group-hover:opacity-100 transition-opacity duration-150`

### 13.10 Animações (princípios Emil Kowalski)

- **Nunca** usar `transition: all` — especificar propriedades exatas
- **Nunca** usar `ease-in` em UI — sempre `ease-out` ou curva customizada
- Press feedback: `active:scale-[0.97]` (0.95-0.98 é o range aceitável)
- Durações: 150ms para colors/borders, 200ms para transform, 180ms para modais
- Easing padrão: `[0.23, 1, 0.32, 1]` (ease-out forte)
- Ícones não animam de `scale(0)` — mínimo `scale(0.85)` com `opacity: 0`

### 13.11 Stepper/wizard

- Círculos: `h-6 w-6 rounded-full text-[10px] font-semibold`
- Ativo: `bg-primary text-primary-foreground border-primary shadow-sm`
- Completado: `bg-primary/10 text-primary border-primary/30` com checkmark
- Pendente: `bg-muted text-muted-foreground border-border`
- Linha conectora: `h-px w-6` que muda de cor conforme progresso
