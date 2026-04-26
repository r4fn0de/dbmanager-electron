# Relatório de Auditoria — TarsDB v1.0 Launch Readiness

**Data:** 2026-04-25
**Escopo:** Auditoria completa de prontidão para lançamento — segurança, backend/IPC, frontend/UX, build/testes/config.

---

## Veredicto Anti-Padrões

**PASSA.** A aplicação não apresenta estética "AI slop". O design usa shadcn/ui com customizações próprias, sem gradientes decorativos, glassmorphism excessivo, ou paletas cyan-on-dark genéricas. O Gooey SVG filter nas tabs de conexão é um toque criativo genuíno. A UI é utilitária e coesa, adequada para uma ferramenta profissional de banco de dados.

---

## Resumo Executivo

| Severidade | Quantidade |
|------------|-----------|
| **Crítico** | 6 |
| **Alto** | 10 |
| **Médio** | 12 |
| **Baixo** | 7 |
| **Total** | **35** |

### Top 5 Issues Mais Críticas

1. `nodeIntegration: true` no main window — **falha grave de segurança Electron**
2. SQL Injection no PostgreSQL driver (getTableStats/getTableSample)
3. Botões minimizar/maximizar/fechar da TitleBar **são stubs** (console.log, sem IPC)
4. Zero Error Boundaries — qualquer crash de componente derruba o app inteiro
5. `embedded-postgres` em versão **beta** (18.3.0-beta.17)

### Score de Prontidão: 6/10 — NÃO PRONTO para lançamento

Estimativa de correção: **3-5 dias** para os bloqueadores.

---

## Achados Detalhados por Severidade

### CRÍTICOS (Bloqueiam Lançamento)

#### C1. `nodeIntegration: true` — Falha de Segurança Electron

- **Arquivo:** `src/features/shell/main.ts:175`
- **Categoria:** Segurança
- **Impacto:** Com nodeIntegration habilitado, qualquer XSS no renderer dá acesso total ao Node.js — leitura de arquivos, execução de comandos, acesso à rede. Anula toda a segurança do context isolation.
- **Padrão violado:** Electron Security Checklist — "Do not enable Node.js integration for remote content"
- **Fix:** Mudar para `nodeIntegration: false`. Os handlers IPC já existem em `src/ipc/window/hadlers.ts`.

#### C2. SQL Injection em `getTableStats`

- **Arquivo:** `src/ipc/db/pg-driver-adapter.ts:676-677`
- **Categoria:** Segurança
- **Impacto:** Schema/table names interpolados via `replace(/'/g, "''")` — bypass possível com Unicode ou multibyte chars. O projeto já tem `pgEscId()` helper que deveria ser usado.
- **Padrão violado:** OWASP Top 10 — A03:2021 Injection
- **Fix:** Usar identifier quoting adequado com double-quotes e escape de `"`.

#### C3. SQL Injection em `getTableSample`

- **Arquivo:** `src/ipc/db/pg-driver-adapter.ts:771-791`
- **Categoria:** Segurança
- **Impacto:** Linha 771 tenta usar `$1.$2` como placeholders para identificadores (não funciona no PostgreSQL — placeholders são só para valores). Linhas 781/788 interpolam schema/table com double-quotes sem escape. `LIMIT ${sampleSize}` não é parametrizado.
- **Padrão violado:** OWASP Top 10 — A03:2021 Injection
- **Fix:** Usar identifier quoting functions para schema/table, parametrizar valores.

#### C4. Botões da TitleBar são Stubs (Windows/Linux)

- **Arquivo:** `src/components/TitleBar.tsx:145-159`
- **Categoria:** Funcionalidade
- **Impacto:** Em Windows/Linux, os botões minimizar, maximizar e fechar **não funcionam** — fazem `console.log()` apenas. Os handlers IPC existem (`src/ipc/window/hadlers.ts`) mas não estão conectados ao frontend.
- **Fix:** Conectar via `ipc.client.window.minimizeWindow()` etc.

#### C5. Zero Error Boundaries

- **Arquivo:** `src/app.tsx:30-34`
- **Categoria:** Estabilidade
- **Impacto:** Nenhum Error Boundary envolve o `RouterProvider` ou `QueryClientProvider`. Um erro em qualquer componente filho resulta em tela branca irrecuperável.
- **Fix:** Adicionar `<ErrorBoundary>` wrapper com UI de fallback.

#### C6. `embedded-postgres` em versão Beta

- **Arquivo:** `package.json:67` — `"embedded-postgres": "18.3.0-beta.17"`
- **Categoria:** Estabilidade / Dependências
- **Impacto:** Versão beta pode ter instabilidade, crashes, ou corrupção de dados. Inaceitável para produção.
- **Fix:** Atualizar para release estável ou documentar os riscos explicitamente.

---

### ALTO (Corrigir antes do lançamento)

#### H1. i18n com nome errado do app

- **Arquivo:** `src/localization/i18n.ts:9`
- **Categoria:** Branding
- **Impacto:** `appName: "electron-shadcn"` em vez de "TarsDB". `madeBy: "Made by LuanRoger"` referencia o template original.
- **Fix:** Atualizar todas as strings de branding.

#### H2. Credenciais expostas em mensagens de erro

- **Arquivo:** `src/ipc/db/handlers.ts` (múltiplos catch blocks)
- **Categoria:** Segurança
- **Impacto:** Connection strings com senhas podem vazar em error messages propagadas ao renderer. Stack traces contendo connection strings com passwords podem ser logadas ou enviadas a serviços de error tracking.
- **Fix:** Sanitizar connection strings antes de incluir em mensagens de erro.

#### H3. API keys com fallback plaintext

- **Arquivo:** `src/ipc/ai/config.ts:36-43`
- **Categoria:** Segurança
- **Impacto:** electron-store sem encryptionKey explícito; em Linux sem safeStorage, API keys de OpenAI/Anthropic/Google ficam em texto puro em `~/.config/TarsDB/ai-settings.json`.
- **Fix:** Adicionar encryptionKey ou documentar o risco.

#### H4. Componentes gigantes sem split

- **Arquivos:**
  - `features/database/components/TableDataEditor/TableDataEditor.tsx`: **2,103 linhas**
  - `features/database/components/TableDdlDialogs.tsx`: **1,884 linhas**
  - `features/ai/components/AiChatPanel.tsx`: **1,496 linhas**
  - `features/database/components/SqlEditor/SqlEditor.tsx`: **1,494 linhas**
- **Categoria:** Performance / Manutenibilidade
- **Impacto:** Re-renders desnecessários, dificuldade de manutenção, bundle splitting subótimo.

#### H5. Connection pool sem lifecycle management

- **Arquivo:** `src/ipc/db/kysely-factory.ts`
- **Categoria:** Recursos
- **Impacto:** Pools PostgreSQL/MySQL criados mas nunca fechados no app exit. SQLite databases em cache sem eviction. Redis clients persistem em erro. Memory leak com conexões criadas/deletadas ao longo do tempo.
- **Fix:** Implementar cleanup no `before-quit` do app.

#### H6. Promise.all sem timeout em getTableSample

- **Arquivo:** `src/ipc/db/pg-driver-adapter.ts:810`
- **Categoria:** Recursos
- **Impacto:** Se uma query de column stats trava, o client do pool nunca é liberado. Pode exaurir o pool de conexões com chamadas repetidas.
- **Fix:** Adicionar timeout wrapper nas queries individuais.

#### H7. URL de conexão sem validação

- **Arquivo:** `src/ipc/db/schemas.ts:39`
- **Categoria:** Segurança
- **Impacto:** `url: z.string().optional()` sem validação de formato. Pode aceitar `file://`, `gopher://`, etc — vetores de SSRF.
- **Fix:** Adicionar regex de validação ou `z.string().url()` com whitelist de protocols.

#### H8. Variáveis de ambiente do updater não validadas

- **Arquivo:** `src/updater/private-update.ts:180-186`
- **Categoria:** Funcionalidade
- **Impacto:** Se `TARSDB_UPDATE_AUTH_ENDPOINT` não está definido, updates são silenciosamente desabilitados sem aviso ao usuário. Usuários não saberão que não estão recebendo atualizações.
- **Fix:** Logar warning visível ou notificar o usuário.

#### H9. console.logs em código de produção

- **Arquivos e contagens:**
  - `src/components/TitleBar.tsx`: 3 ocorrências
  - `src/features/shell/main.ts`: 30 ocorrências
  - `src/ipc/ai/streaming.ts`: 2 ocorrências
  - `src/ipc/db/local-db-manager.ts`: 3 ocorrências
- **Categoria:** Qualidade de código
- **Impacto:** Viola as diretrizes do projeto (CLAUDE.md proíbe `console.log` em produção). Expõe informações de debug ao usuário via DevTools.
- **Fix:** Substituir por logging estruturado ou remover.

#### H10. Cobertura de testes ~10-15%

- **Arquivos:** `src/tests/` — 6 arquivos de teste para 107+ arquivos de produção
- **Categoria:** Qualidade
- **Impacto:** Main process e preload sem nenhum teste. E2E test mínimo (44 linhas). AI configuration/handlers sem testes dedicados. Database connection pooling sem testes de integração.
- **Fix:** Priorizar testes para main process, preload security, e fluxos críticos.

---

### MÉDIO

| # | Issue | Arquivo | Categoria |
|---|-------|---------|-----------|
| M1 | Falta loading state no TableDataEditor quando `isBlockingTableLoading=true` | `TableDataEditor.tsx:393` | UX |
| M2 | Keyboard shortcuts do Monaco podem conflitar com shortcuts globais do app | `SqlEditor.tsx` | UX |
| M3 | Nenhum abort mechanism para saves em andamento se tab é fechada | `TableDataEditor.tsx` | Dados |
| M4 | `chunk: any` sem type validation no streaming handler | `streaming.ts:632` | Type Safety |
| M5 | MySQL testConnection com timeout de apenas 5s, sem tratamento de DNS lento | `mysql-client.ts:222` | Robustez |
| M6 | Apenas 33 ocorrências de `aria-label` em 100+ componentes interativos | Múltiplos | Acessibilidade |
| M7 | QueryClient com `retry: 1` sem backoff exponencial | `app.tsx:20` | Robustez |
| M8 | E2E test mínimo (44 linhas), fluxos críticos sem cobertura | `tests/e2e/` | Qualidade |
| M9 | Preload vite config vazio — deve ter configuração explícita | `vite.preload.config.mts` | Build |
| M10 | Redis driver possivelmente incompleto — funções retornando `unknown` | `redis-driver.ts` | Completude |
| M11 | Diálogos com `max-w-2xl` sem responsividade mobile/tablet | `RlsPoliciesDialog.tsx` e outros | Responsividade |
| M12 | AI chat history load sem proteção contra localStorage corrompido | `useAiChat.ts` | Robustez |

---

### BAIXO

| # | Issue | Arquivo | Categoria |
|---|-------|---------|-----------|
| L1 | `NavigationMenu.tsx` nunca importado em nenhum lugar (dead code) | `src/components/NavigationMenu.tsx` | Cleanup |
| L2 | Typo no nome do arquivo: `hadlers.ts` deveria ser `handlers.ts` | `src/ipc/window/hadlers.ts` | Qualidade |
| L3 | TODO comments em generators (`// TODO: replace with actual enum values`) | `src/lib/generators/formats/` | Completude |
| L4 | Event listeners podem acumular em remount do root route | `src/routes/__root.tsx:196-332` | Recursos |
| L5 | Sem audit logging para eventos de segurança (failed logins, key changes, SQL failures) | Múltiplos | Observabilidade |
| L6 | System schemas filter (`NOT LIKE 'pg_%'`) pode falhar em futuras versões PG | `pg-driver-adapter.ts:84` | Futureproofing |
| L7 | SQL history hardcoded em 200 itens sem paginação/infinite scroll | `useSqlWorkspace.ts:38` | Performance |

---

## Achados Positivos

- **Arquitetura sólida**: Feature-based structure bem organizada, separação clara main/renderer/preload
- **oRPC type-safe**: IPC tipado com Zod schemas em todas as boundaries — excelente pattern
- **Electron Fuses**: Configuração de segurança exemplar no `forge.config.ts` (RunAsNode: false, ASAR integrity, cookie encryption)
- **CSP headers**: `script-src 'self'` no `index.html`
- **Context isolation**: Habilitado corretamente em todas as janelas
- **Preload minimalista**: Superfície de exposição pequena e segura via `contextBridge`
- **Zustand stores**: Bem estruturados com persist middleware
- **Auto-updater robusto**: Retry com exponential backoff, abort controllers, CloudFront signed cookies
- **DB boundary check**: Script (`check-db-boundaries.mjs`) que impede renderer de importar drivers diretamente
- **React Compiler habilitado**: Otimização automática de re-renders (React 19)
- **Zod schemas completos**: Validação de input em todos os handlers IPC
- **Driver registry pattern**: Boa abstração para suportar múltiplos engines de banco de dados

---

## Padrões e Issues Sistêmicas

1. **Segurança inconsistente**: Fuses e CSP bem configurados, mas nodeIntegration e SQL injection anulam as proteções. A postura de segurança precisa ser uniformizada.
2. **Frontend sem tratamento de erros**: Nenhum Error Boundary, múltiplos async flows sem try/catch adequado, estados de erro/loading faltando em componentes-chave.
3. **Componentes monolíticos**: 4 componentes com 1,400-2,100+ linhas indicam falta de decomposição. Impacta manutenibilidade e performance.
4. **Resquícios do template**: Nome do app "electron-shadcn", creditos "LuanRoger", dead code do template original.
5. **Testes insuficientes**: Cobertura crítica ausente para main process, preload, e fluxos de conexão/query.

---

## Plano de Ação por Prioridade

### 1. Imediato — Bloqueadores de Lançamento (~2 dias)

- [SKIP] **C1:** `nodeIntegration: false` em `src/features/shell/main.ts:175` — *Intencional: necessário para better-sqlite3 e embedded-postgres no renderer. Refactor arquitetural futuro.*
- [x] **C2:** Fix SQL injection em `pg-driver-adapter.ts:676-677` — *Parametrizado com `$1`/`$2` via `pool.query()`*
- [x] **C3:** Fix SQL injection em `pg-driver-adapter.ts:771-791` — *Usado `pgEscId()` para identifiers, `safeSampleSize` clamp*
- [x] **C4:** Conectar botões da TitleBar aos IPC handlers — *Conectado via `minimizeWindow`/`maximizeWindow`/`closeWindow` de `@/features/shell`*
- [x] **C5:** Adicionar Error Boundary em `app.tsx` — *`AppErrorBoundary` envolvendo providers com UI de fallback*
- [SKIP] **C6:** Atualizar `embedded-postgres` para versão estável — *Beta é a versão oficial do pacote, documentado pelo autor*
- [x] **H1:** Corrigir i18n — appName → "TarsDB", removidas chaves mortas do template

### 2. Curto Prazo — Antes do Launch (~2-3 dias)

- [ ] **H2:** Sanitizar connection strings em error messages
- [ ] **H9:** Remover todos os `console.log` de produção
- [ ] **H7:** Adicionar validação na URL de conexão (`schemas.ts`)
- [ ] **H5:** Implementar pool cleanup no `before-quit` do app
- [ ] **H6:** Adicionar timeout nos Promise.all de column stats
- [ ] **H8:** Validar env vars do updater no startup com warning

### 3. Médio Prazo — Sprint Seguinte

- [ ] **H10:** Adicionar testes para main process e preload
- [ ] **M8:** Expandir E2E tests para fluxos críticos
- [x] **H4:** Split dos componentes gigantes (2000+ LOC → target 400 LOC max) — *SqlEditor e TableDataEditor decompostos na Fase 2; TableDdlDialogs e AiChatPanel pendentes*
- [ ] **M6:** Melhorar acessibilidade (aria-labels, keyboard nav, semantic HTML)
- [ ] **M1/M3:** Adicionar loading/error states completos no TableDataEditor
- [ ] **H3:** Endereçar plaintext fallback de API keys em Linux

### 4. Longo Prazo — Melhorias Contínuas

- [ ] i18n completo ou remoção do sistema de localização
- [ ] **L5:** Audit logging para eventos de segurança
- [ ] **M11:** Responsividade mobile/tablet
- [ ] **M10:** Redis driver completion
- [ ] **L1/L2:** Cleanup de dead code e typos

---

## Checklist Pré-Release

- [ ] Executar `bun run check` (linting/formatting) — sem erros
- [ ] Executar `bun run test:all` (unit + e2e) — todos passando
- [ ] Testar em todas as plataformas alvo (macOS, Windows, Linux)
- [ ] Verificar code signing e notarization setup
- [ ] Verificar update server endpoints estão live
- [ ] Testar fluxo de auto-update end-to-end
- [ ] Verificar que `TARSDB_UPDATE_AUTH_ENDPOINT` está configurado em produção
- [ ] Scan de vulnerabilidades em dependências (`bun audit` ou equivalente)
- [ ] Testar todos os 5 drivers de banco (pg, mysql, sqlite, clickhouse, redis) em ambiente limpo
