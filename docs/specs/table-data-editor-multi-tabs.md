# TableDataEditor Multi-Tabs (v1)

## Objetivo
Adicionar suporte a múltiplas abas de tabela na seção **Tables** por conexão, com:
- restauração entre sessões
- prevenção de abas duplicadas
- preservação de estado por tabela
- proteção para fechamento com alterações pendentes
- ação global de **Save all**

---

## Arquitetura

### 1) Store de abas por conexão
Arquivo: `src/lib/stores/table-editor-tabs.ts`

- Store Zustand com `persist` (`name: "table-editor-tabs"`).
- Estado por `connectionId`:
  - `openTabs: TableEditorTab[]`
  - `activeTabKey: string | null`
- `TableEditorTab`:
  - `key` (`schema.table`)
  - `schema`
  - `table`
  - `label`

Operações:
- `openTab(connectionId, tab)`:
  - adiciona se não existir
  - sempre ativa a aba
- `activateTab(connectionId, key)`
- `closeTab(connectionId, key)`:
  - se aba ativa fechar, fallback para próxima, senão anterior
- `closeOthers(connectionId, keepKey)`
- `closeAll(connectionId)`
- `reorderTabs(connectionId, fromIndex, toIndex)` (estrutura pronta, UI de drag fica para fase futura)
- `replaceTabKey(connectionId, oldKey, nextTab)` (rename de tabela)
- `removeMissingTabs(connectionId, existingKeys)` (limpeza pós-refresh/schema)

---

### 2) Integração na página de database
Arquivo: `src/routes/database/-DatabasePageContent.tsx`

Mudanças principais:
- `selectedTableKey` deixou de ser `useState` local e passou a vir da store de tabs.
- `changeTable(tableKey)` agora:
  - abre/ativa aba via store
  - sincroniza `setTabNavState` (`lastTable`) para compatibilidade com navegação existente.

Comportamento de abertura:
- Clique em tabela abre nova aba apenas se não existir.
- Se já aberta, só ativa.

Barra de abas (topo do painel de tabelas):
- botão por aba com `schema.table`
- indicador de dirty (`•`)
- botão de fechar por aba
- ações:
  - `Save all`
  - `Close others`
  - `Close all`

Fechamento com alterações:
- Ao fechar aba dirty, abre `AlertDialog` com:
  - `Save and close`
  - `Discard`
  - `Cancel`

Consistência com DDL/schema:
- **Drop table**: remove aba correspondente.
- **Rename table**: atualiza chave/label da aba.
- **Schema refresh**: fecha abas órfãs (tabelas inexistentes) e mostra aviso (`toast.info`).

---

### 3) Preservação de draft e estado por tabela
Arquivo: `src/features/database/components/TableDataEditor/TableDataEditor.tsx`

Estado preservado por `tableKey`:
- já existia para view state (page, pageSize, sort, filter, colunas visíveis, larguras)
- agora também preserva drafts:
  - inserts
  - updates
  - deletes

Isso permite alternar entre abas sem perder alterações locais de cada tabela.

---

### 4) API imperativa do editor (para orquestração externa)
Arquivos:
- `src/features/database/components/TableDataEditor/TableDataEditor.tsx`
- `src/features/database/components/TableDataEditor/types.ts`

`TableDataEditor` agora usa `forwardRef` e expõe:
- `saveAllChanges()`
- `saveAllDraftsAcrossTabs()`
- `discardAllChanges()`
- `hasDraftChanges()`

Props novos:
- `tableKey?: string`
- `onDirtyChange?: (tableKey: string, dirty: boolean) => void`
- `disableWindowUnsavedTracking?: boolean`

Observação:
- A página pai (`DatabasePageContent`) consolida o dirty por aba via `onDirtyChange`.
- O indicador de janela com mudanças pendentes passa a considerar o agregado da conexão (`table-tabs:${connectionId}`).

---

## Save All (v1)

`Save all` executa save sequencial nos drafts conhecidos (snapshot por `tableKey`), invalidando cache de linhas por tabela salva.

Em falha:
- mantém estado dirty onde falhou
- exibe erro via toast

---

## Testes

### Unit implementado
Arquivo: `src/tests/unit/table-editor-tabs-store.test.ts`

Cobre:
- abrir/focar sem duplicar
- fechamento da aba ativa com fallback de foco
- `closeOthers` e `closeAll`

Comando:
`bun run test:unit -- src/tests/unit/table-editor-tabs-store.test.ts`

---

## Limitações conhecidas (v1)

- Reorder visual por drag ainda não foi ligado na UI (store já suporta).
- `Save all` é sequencial por previsibilidade (não paralelo).
- Integração E2E completa de multi-tabs ainda não foi adicionada.

---

## Próximos passos recomendados

1. Adicionar testes de integração para `DatabasePageContent` (fluxo de abrir/trocar/fechar/salvar).
2. Adicionar E2E Playwright cobrindo persistência e cenários de dirty.
3. Habilitar reorder por drag na barra de abas.
4. Melhorar feedback de `Save all` com resumo por tabela (ok/falha).
