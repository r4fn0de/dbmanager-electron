# GitHub Releases Auto-Update

Sistema de updates automáticos usando GitHub Releases (para repos privados).

## Como funciona

1. **Build**: Electron Forge gera os instaladores
2. **Publish**: Electron Forge publica como GitHub Release
3. **Update**: `electron-updater` verifica e baixa updates automaticamente

## Configuração necessária

### 1. Configurar variáveis no código

Edite `src/updater/github-release-update.ts`:

```typescript
autoUpdater.setFeedURL({
  provider: "github",
  owner: "SEU-USUARIO-OU-ORG",     // ← Troque aqui
  repo: "NOME-DO-REPO",             // ← Troque aqui
  private: true,
  token: githubToken,
});
```

Ou use env vars:
- `TARSDB_GH_OWNER` - Owner do repo
- `TARSDB_GH_REPO` - Nome do repo

### 2. Criar GitHub Personal Access Token (PAT)

1. Acesse: https://github.com/settings/tokens
2. Clique em **Generate new token (classic)**
3. Selecione o scope: `repo` (acesso completo ao repositório privado)
4. Copie o token gerado

### 3. Configurar secrets no GitHub

Vá em **Settings → Secrets and variables → Actions** e adicione:

| Secret | Valor |
|--------|-------|
| `GH_PAT` | O token PAT criado acima |

### 4. Configurar variáveis de ambiente (opcional)

Para o app instalado, configure env vars:

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `TARSDB_GH_TOKEN` | GitHub PAT para acessar releases privados | - |
| `TARSDB_GH_OWNER` | Owner do repositório | "your-username" |
| `TARSDB_GH_REPO` | Nome do repositório | "your-repo-name" |
| `TARSDB_UPDATE_CHECK_INTERVAL_MS` | Intervalo entre verificações (ms) | 600000 (10min) |

## Fluxo de trabalho

### 1. Criar uma nova release

```bash
# Bump version no package.json
npm version patch  # ou minor, major

# Push a tag (dispara o workflow)
git push origin main --tags
```

### 2. Ou publish manual

```bash
export GITHUB_TOKEN=seu_token_aqui
export GH_OWNER=seu_usuario
export GH_REPO=seu_repo

bun run publish
```

## Estrutura do código

```
src/updater/
├── github-release-update.ts   # Novo updater com electron-updater
├── private-update.ts          # Antigo (S3 + CloudFront) - pode remover
└── contracts.ts               # Tipos do antigo - pode remover
```

## Verificação local

Para testar o fluxo de update (não baixa realmente em dev):

```bash
# Build para produção
bun run make

# Verificar se o feed URL está configurado corretamente
# (logs aparecerão no console)
```

## Troubleshooting

### "Cannot find latest.yml" / "Cannot find latest-mac.yml"
- Certifique-se de que o publish foi bem-sucedido
- O arquivo `latest.yml` (Windows) ou `latest-mac.yml` (macOS) deve estar no release

### "Private repository requires authentication"
- Verifique se `TARSDB_GH_TOKEN` está configurado
- O token precisa ter scope `repo`

### Updates não aparecem
- Verifique se a versão no `package.json` é maior que a instalada
- O electron-updater compara versões, então `0.0.2` > `0.0.1`

## Alternativa: Releases Públicos

Se quiser tornar o repo público, remova:

1. `private: true` do `setFeedURL`
2. A necessidade do token (remova `TARSDB_GH_TOKEN`)

O resto funciona igual!
