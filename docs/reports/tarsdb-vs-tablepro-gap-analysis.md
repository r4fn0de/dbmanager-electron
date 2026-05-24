# TarsDB vs TablePro — Análise Comparativa

> **Data:** 24/05/2026
> **Objetivo:** Comparar o TarsDB com o TablePro, identificando o que já existe e o que pode ser implementado.

---

## ✅ Features que JÁ EXISTEM no TarsDB

### Database Engines
- PostgreSQL, MySQL, MariaDB, ClickHouse, SQLite, Redis

### SQL Editor
- Monaco-based com multi-tabs, formatação, execução de queries
- **Autocomplete schema-aware** ✅ — `src/lib/monaco-sql-setup.ts` com completions de tabelas, colunas (dot-triggered), schemas, +90 keywords SQL, 14 snippets
- **Query History** ✅ — `useSqlWorkspace.ts` com persistência localStorage, busca full-text, filtro por conexão, re-execução (atalho Cmd+Y)
- **SQL Favorites (Saved SQL)** ✅ — `useSqlWorkspace.ts` + `SqlEditor.tsx`: queries salvas por conexão com CRUD, sidebar com abas Saved/History/Items, atalho Cmd+S
- **Vim Mode** ✅ — `src/lib/stores/editor-preferences.ts` + integração `monaco-vim` no `SqlEditor.tsx` com toggle na toolbar e status bar

### Data Grid
- Inline editing, change tracking, sorting, filtering, paginação, FK lookup
- **Hide/show columns** ✅ — `TableDataEditor.tsx` com `visibleColumns` state, DropdownMenu, persistência por tabela
- **Copy formats** — Copy básico existe; TSV/JSON formatado não implementado

### Schema Management
- Visual DDL (create/alter/drop tables, columns, indexes), estrutura de tabelas

### ER Diagram
- Schema Visualizer com ReactFlow, layout automático, mini-map

### AI Assistant
- Chat com streaming, fix/update/enhance SQL, múltiplos providers (OpenAI, Claude, Ollama etc.)
- **Inline AI suggestions** ✅ — `AiInlineSuggestion.tsx` + `useAiInlineCompletion.ts` (Copilot-style)

### Import/Export
- CSV import/export, JSON export, SQL export
- **Import XLSX** ✅ — `data-import.ts` com `parseExcelBuffer()`, `ImportDataDialog` já aceita `.xlsx,.xls`
- **Export XLSX** ✅ — `data-export.ts` com `serializeExportToXlsx()`, `ExportDataDialog` e `QueryResults` com botão XLSX

### Definitions Browser
- Enums, functions, constraints, indexes, triggers

### Local DB
- Branching estilo Git (PostgreSQL), merge de schemas

### SSH Tunneling
- Suporte a SSH

### Theming
- Dark/light mode

### i18n
- Multi-idioma

---

## 🚀 Features a Implementar

### 🔥 Prioridade Alta (médio esforço, alto valor)

| # | Feature | Status | O que fazer |
|---|---|---|---|
| 1 | **Server Dashboard UI** | Dados existem via IPC | Criar painel com sessões ativas, métricas (conexões, cache hit ratio, tamanho DB, slow queries), kill/cancel query |
| 2 | **Safe Mode completo** | ✅ **Implementado** | Níveis: Off → Silent → Alert → Read-only. Store por conexão (`safe-mode.ts`), seletor na toolbar do SQL Editor, bloqueio de queries destrutivas em modo Read-only |
| 3 | **JSON Tree Viewer** | ✅ **Implementado** | Componente tree collapsible para células JSON com toggle Tree/Text |
| 4 | **Type-specific cell editors** | ✅ **Implementado** | Color picker, boolean checkbox, date picker melhorado |

### ⚡ Prioridade Média (baixo esforço, bom valor)

| # | Feature | Descrição |
|---|---|---|
| 5 | **Vim Mode** | ✅ **Implementado** | Toggle na toolbar do SQL Editor, `monaco-vim` com status bar, store persistente (`editor-preferences.ts`) |
| 6 | **Import XLSX** | ✅ **Implementado** | `data-import.ts` com `parseExcelBuffer()`, suporte a `.xlsx,.xls` no `ImportDataDialog` |
| 7 | **Export XLSX** | ✅ **Implementado** | `serializeExportToXlsx()` no `data-export.ts`, botão XLSX no `ExportDataDialog` e `QueryResults` |
| 8 | **Copy TSV/JSON** | Opções no menu de contexto da grid: "Copy as TSV", "Copy as JSON" |
| 9 | **View modes (Data/Structure/JSON)** | Adicionar toggle "JSON View" nas abas de visualização |

### 🧠 Prioridade Média-Alta (AI)

| # | Feature | Descrição |
|---|---|---|
| 10 | **AI Agent mode** | Modo onde a AI pode executar queries e explorar schema autonomamente |
| 11 | **MCP Server** | Expor o banco como ferramenta MCP para Claude Desktop, Cursor etc. |

### 💎 Prioridade Baixa (diferenciais premium)

| # | Feature | Descrição |
|---|---|---|
| 12 | **Built-in CLI** | Botão que abre terminal com `psql`/`mysql`/`redis-cli` |
| 13 | **Backup & Restore** | Dumps completos com schedule |
| 14 | **Sample database (Chinook)** | Banco de testes 1-click |
| 15 | **URL Scheme** | Deep links `tarsdb://connect/...` |
| 16 | **Connection Sharing** | Compartilhar conexões via time |
| 17 | **Plugin system** | Drivers instaláveis como plugins |
| 18 | **iCloud Sync** | Sincronizar conexões/config entre dispositivos |
| 19 | **Raycast Extension** | Buscar conexões e executar queries do Raycast |

---

## Resumo

| Categoria | Total | Existentes | Novos |
|-----------|-------|------------|-------|
| Features listadas | 25 | 12 (parcial/total) | 13 |

**Top 5 recomendados para implementar:**

1. ~~**Server Dashboard UI** — Dados já existem no IPC, só falta UI~~
2. ✅ **Safe Mode completo** — Implementado com níveis Off → Silent → Alert → Read-only
3. ✅ **JSON Tree Viewer** — Implementado
4. ~~**SQL Favorites** — Já existe como Saved SQL ✅~~
5. ✅ **Type-specific cell editors** — Implementado
