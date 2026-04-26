# Plano de Evolução de Tools da AI (TarsDB)

## Objetivo
Evoluir a AI para atuar como copiloto de banco de dados com foco em:
- descoberta rápida de schema;
- segurança na execução;
- otimização de queries;
- suporte a mudanças estruturais com menor risco.

## Princípios
- Preferir ferramentas de leitura e análise antes de permitir execução com impacto.
- Todo tool deve ter validação de entrada com Zod e limites explícitos (`limit`, `timeout`).
- Separar claramente: `read-only`, `diagnóstico`, `planejamento de mudança`, `execução controlada`.
- Respeitar boundaries atuais (`src/ipc/ai/` e `src/ipc/db/`).

## Fase 1 — Quick Wins (Descoberta de Schema)
### 1) `listSchemas`
- Finalidade: listar schemas disponíveis por conexão.
- Entrada: `{}`.
- Saída: `[{ name, tableCount? }]`.
- Pronto quando: AI consegue escolher schema sem suposição fixa (`public`).

### 2) `searchSchema`
- Finalidade: buscar tabelas e colunas por termo.
- Entrada: `{ query: string, schemaName?: string, limit?: number }`.
- Saída: `[{ schema, table, column?, matchType }]`.
- Pronto quando: AI encontra entidades relevantes em bases grandes.

### 3) `getRelationsGraph`
- Finalidade: mapear relacionamentos FK para melhorar JOINs.
- Entrada: `{ schemaName?: string, tables?: string[] }`.
- Saída: `[{ fromTable, fromColumn, toTable, toColumn, constraintName }]`.
- Pronto quando: AI sugere JOIN com base em relacionamento real.

## Fase 2 — Segurança e Governança
### 4) `runReadOnlySql`
- Finalidade: executar SQL apenas leitura.
- Entrada: `{ sql: string, limit?: number, timeoutMs?: number }`.
- Regras: aceitar somente `SELECT/WITH/EXPLAIN`; bloquear DDL/DML.
- Pronto quando: execução segura com limites forçados.

### 5) `validateSqlSafety`
- Finalidade: classificar risco da query.
- Entrada: `{ sql: string, dbType: DatabaseType }`.
- Saída: `{ classification: "safe" | "risky" | "blocked", reasons: string[] }`.
- Pronto quando: AI explica por que uma query é perigosa.

### 6) `dryRunMutation`
- Finalidade: estimar impacto de `UPDATE/DELETE` antes da execução.
- Entrada: `{ sql: string, sampleSize?: number }`.
- Saída: `{ estimatedAffectedRows, samplePreview?, warnings[] }`.
- Pronto quando: usuário recebe prévia antes de aplicar mutações.

## Fase 3 — Performance e Qualidade de Dados
### 7) `suggestIndexes`
- Finalidade: sugerir índices a partir de SQL + plano.
- Entrada: `{ sql: string, analyze?: boolean }`.
- Saída: `[{ statement, rationale, confidence }]`.
- Pronto quando: AI recomenda índice com justificativa objetiva.

### 8) `analyzeQueryAntiPatterns`
- Finalidade: detectar anti-patterns comuns em SQL.
- Entrada: `{ sql: string, dbType: DatabaseType }`.
- Saída: `[{ type, severity, message, fixSuggestion }]`.
- Pronto quando: AI retorna diagnóstico acionável.

### 9) `profileTableQuality`
- Finalidade: gerar perfil de qualidade de dados por tabela.
- Entrada: `{ schemaName: string, tableName: string, sampleSize?: number }`.
- Saída: métricas de nulls, cardinalidade, duplicidade potencial e distribuição.
- Pronto quando: AI consegue recomendar limpeza/normalização.

## Fase 4 — Mudanças Estruturais e Operação
### 10) `generateMigrationDraft`
- Finalidade: gerar rascunho de migration com rollback.
- Entrada: `{ objective: string, dbType: DatabaseType, context?: string }`.
- Saída: `{ upSql, downSql, checklist[] }`.
- Pronto quando: AI produz migração revisável sem executar automaticamente.

### 11) `compareSchemas`
- Finalidade: comparar dois ambientes/conexões.
- Entrada: `{ sourceConnectionId, targetConnectionId, schemaName?: string }`.
- Saída: diferenças de tabelas, colunas, constraints e índices.
- Pronto quando: AI sugere plano de sincronização.

### 12) `dbHealthCheck`
- Finalidade: relatório geral de saúde do banco.
- Entrada: `{ schemaName?: string, depth?: "quick" | "full" }`.
- Saída: `{ status, checks: [{ name, status, details }] }`.
- Pronto quando: há checklist consolidado de operação e manutenção.

## Ordem Recomendada de Implementação
1. `listSchemas`
2. `searchSchema`
3. `getRelationsGraph`
4. `validateSqlSafety`
5. `runReadOnlySql`
6. `dryRunMutation`
7. `analyzeQueryAntiPatterns`
8. `suggestIndexes`
9. `profileTableQuality`
10. `generateMigrationDraft`
11. `compareSchemas`
12. `dbHealthCheck`

## Notas Técnicas (AI SDK)
- Manter `tool({ inputSchema, execute })` em `src/ipc/ai/tools.ts`.
- Para fluxo multi-step, continuar com `stopWhen` (já usado em streaming).
- Quando fizer sentido, usar `prepareStep` para forçar inspeção de schema antes da resposta final.

## Critério de Sucesso
- AI reduz consultas manuais ao schema.
- Menos erros de SQL gerado.
- Menor risco de execução acidental de queries perigosas.
- Melhor guidance de performance e manutenção para o usuário.
