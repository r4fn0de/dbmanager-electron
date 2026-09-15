# MEMORY.md — TarsDB (notas de longo prazo)

## Ambiente

- **Vitest não roda neste ambiente.** Qualquer arquivo de teste falha com
  `[vitest-pool]: Failed to start threads worker` / `Timeout waiting for worker
  to respond` (~60s por arquivo). Ocorre tanto com `--pool=forks` quanto
  `--pool=threads`, inclusive em testes pré-existentes sem relação com a mudança.
  Verificado em 2026-09-11 com `connection-tabs.test.ts`. Não é bug do código —
  é limitação de spawn de worker. Validação confiável aqui: `tsc --noEmit` e
  `biome check`.
- `bun run test:unit` roda **`vitest` em watch mode** (não sai nunca). Para rodar
  uma vez, use `bun run test` ou `bun x vitest run <arquivo>`.

## Lint

- Linter: **Biome** via preset **Ultracite** (`biome.jsonc`).
- `src/components/ui` está **excluído** do Biome (`"includes": ["!src/components/ui"]`).
- O repo tem dívida de lint grande (8491 erros em 2026-09-11 antes da limpeza).
- `AGENTS.md` está desatualizado: diz que `bun run check` roda `ultracite check`
  + `check:db-boundaries`, mas o `package.json` só roda o Ultracite. O
  `check:db-boundaries` não está encadeado em `check` nem em `verify`.

## Verificar se uma classe Tailwind v4 compila (sem rodar o build)

Tailwind 4.3.3 aqui é CSS-first (`@theme` em `src/styles/global.css`), sem
`tailwind.config.js`. Dá para validar uma classe arbitrária programaticamente
usando `@tailwindcss/node`:

```js
import { __unstable__loadDesignSystem } from "<repo>/node_modules/@tailwindcss/node/dist/index.mjs";
import { readFile } from "node:fs/promises";

const src = await readFile("<repo>/src/styles/global.css", "utf-8");
const ds = await __unstable__loadDesignSystem(src, {
  base: "<repo>/src/styles",
  onDependency: () => {},   // obrigatório, senão lança "t is not a function"
});
console.log(ds.candidatesToCss(["has-[>table:focus-visible]:ring-2"]));
```

Pontos de atenção:

- Use `__unstable__loadDesignSystem` + `candidatesToCss`. O `compile(...).build()`
  devolve só as camadas de `@layer properties`, sem as utilities.
- Precisa carregar o **`global.css` real**, não `@import "tailwindcss"` puro: sem
  o `@theme inline` do app, `ring-ring/40` e `ring-primary/40` dão `null`
  (falso negativo), porque `--color-ring`/`--color-primary` não existem no tema
  default.
- Confirmado nesta versão: `has-[>table:focus-visible]:ring-2` gera
  `:has( > table:focus-visible)`.

## Medir delta de lint por arquivo: como fazer direito

Para saber se uma mudança adicionou erro de lint, o baseline precisa rodar
**dentro do projeto** (com tsconfig presente). Copiar o arquivo de
`git show HEAD:<path>` para `/tmp` dá número errado para toda regra com
inferência de tipo (`noUnnecessaryConditions`, parte de `noLeakedRender`, …) —
elas simplesmente não rodam sem tsconfig.

Receita que funciona:

```bash
cp <arquivo-de-HEAD> <mesmo-diretório>/__baseline_probe.<ext>
bun x biome check --max-diagnostics=3000 <mesmo-diretório>/__baseline_probe.<ext>
rm -f <mesmo-diretório>/__baseline_probe.<ext>
```

Exemplo real: `TableDataEditor.tsx` acusou 106 no `/tmp` e 123 dentro do projeto
— os 17 de diferença eram só artefato do baseline.

## Convenção: `user-select` (chrome não seleciona, conteúdo sim)

Desde 2026-09-15 o default é **não selecionável**, definido em
`src/styles/global.css` num `@layer base`:

```css
html { user-select: none }
input, textarea, select, [contenteditable="true"], pre, code { user-select: text }
```

Regras práticas ao criar UI nova:

- **Conteúdo que o usuário precisa copiar** (valores de célula, SQL, DDL,
  connection string, mensagens do chat) → adicione `select-text`.
- `<pre>` e `<code>` já são liberados automaticamente — é por isso que todos os
  diálogos de DDL/RLS/export e o `JsonTreeViewer` (que usa `<pre>`) funcionam sem
  anotação extra.
- `JsonTreeViewer` e `Markdown` são `components/ui` (não editar direto): o
  `select-text` vai no **wrapper** do call site. O viewer de JSON tem os spans da
  árvore fora de `<pre>`, então precisa disso.
- **Monaco é imune**: o CSS dele é não-layered (e usa `!important` em vários
  pontos), então vence o `@layer base`. Nada a fazer em `LazyMonacoEditor`.
- Antes eram 42 marcadores `select-text` "soltos"; agora eles são o opt-in de
  verdade contra um default `none`.

## Driver pg devolve `Date`, não string

`src/ipc/db/` não configura `setTypeParser`, e `listPgRowsRaw` retorna
`rowsResult.rows` cru. Logo `date`/`timestamp`/`timestamptz` chegam ao renderer
como **objetos `Date`** (e `bytea` como `Buffer`, `interval` como objeto).

Consequência: qualquer `JSON.stringify(value)` num `Date` produz string **com
aspas**, que não volta por `Date.parse`/`new Date`. `normalizeDisplay` tratava
isso como objeto genérico — corrigido em
`TableDataEditor/utils/valueParsers.ts` com branch de `Date` → `toISOString()`.

Ainda **não** round-tripam: `bytea` e `interval` (mesmo com o fix do `Date`).
Por isso `persistEditing` tem a guarda `editStartValueRef` (sai sem persistir se
o draft não mudou), que é type-agnóstica.

## Gotcha importante: `useSortedKeys` vs TanStack Query

A assist rule `assist/source/useSortedKeys` do Biome reordena as chaves de
`useMutation({...})` para ordem alfabética, o que move `onError` **antes** de
`onMutate`. TanStack Query infere o tipo do `context` a partir do `onMutate`, e
essa inferência depende da ordem — o resultado é `context` virando `{}` e erros
`TS2339: Property 'previous' does not exist on type '{}'`.

Corrigido em `src/features/localDb/hooks/useLocalDatabases.ts` mantendo `onMutate`
antes de `onError` + supressão local:

```ts
const { mutateAsync: x } = useMutation(
  // biome-ignore assist/source/useSortedKeys: TanStack Query infers the mutation context type from `onMutate`, so `onError` must not be hoisted above it.
  { ... }
);
```

Regra geral: **não aplicar `useSortedKeys` cegamente em objetos de options do
TanStack Query.**

## Limpeza de lint: como fazer com segurança

Técnica para mirar uma regra específica (Biome 2.x):

```bash
bun x biome lint --write --unsafe --only=<rule> --reporter=summary
```

`--reporter=summary` é o que permite saber se a regra realmente tem fix
(`Fixed N files`) ou é manual (`Found N errors` sem "Fixed"). O reporter `json`
**não** expõe informação de fix (`advices` vem vazio).

Ordem correta de trabalho:
1. `bun run fix` (fixes *safe* apenas; pula os *unsafe*).
2. `tsc --noEmit` — a inferência do TanStack Query é o ponto frágil.
3. Só então aplicar `--unsafe --only=<rule>` regra por regra.

### Regras SEGURAS neste repo (aplicadas, typecheck limpo)

`noUnusedFunctionParameters` · `useConsistentArrayType` · `useConsistentTypeDefinitions` ·
`useNodejsImportProtocol` · `useTemplate` · `noUselessSwitchCase` · `useOptionalChain` ·
`useReadonlyClassProperties` · `noUnusedVariables` · `noUselessTernary` · `useLiteralKeys` ·
`noUselessFragments`

Os fixes são: rename para `_nome`, `Array<T>` → `T[]`, `readonly` em campo de classe,
`a && a.b` → `a?.b`. Nenhum remove efeito colateral.

### Regras PROIBIDAS (quebram o build ou o comportamento)

| Regra | O que faz | Por que não |
|---|---|---|
| `useAtIndex` | `arr[arr.length-1]` → `arr.at(-1)` | `.at()` retorna `T \| undefined` → 3 erros TS2532 |
| `noEqualsToNull` | `== null` → `=== null` | perde o match de `undefined` |
| `noNonNullAssertion` | remove `!` | vira `possibly null/undefined` |
| `useExhaustiveDependencies` | injeta deps em hooks | pode causar loop infinito |
| `noReactForwardRef` | ref-as-prop do React 19 | muda a API do componente |
| `noSkippedTests` | remove `.skip` | faz testes pulados rodarem no CI |
| `noVoid` | remove `void` | descarta o descarte explícito de promise |
| `useAwait` | remove `async` | muda o tipo de retorno |

`noLeakedRender` (148), `noUnnecessaryConditions` (201), `useDestructuring` (88),
`noIncrementDecrement` (53), `noEmptyBlockStatements` (19), `useErrorCause` (157),
`noForEach`/`useForOf` **não têm fix** nesta versão — são manuais.

## Ícones

- `src/components/ui/Icon.tsx` — abstração central sobre **Tabler** (`@tabler/icons-react`),
  union `IconName` em kebab-case (~110 nomes), `ICON_MAP` estático. Usado em ~62 arquivos.
- `src/components/ui/ReIcon.tsx` — wrapper sobre **Reicon** (`reicon-react`), isolado do
  `Icon`. Mesma convenção kebab-case, ~85 nomes mapeados. Suporta `weight`
  (`"Outline" | "Filled"`), `size`, `color`, `strokeWidth`.
- `src/components/icons/*` — ícones SVG **escritos à mão**, e são **filled**
  (`fill="currentColor"`), não stroked. Ao trocar por Reicon nesse contexto, usar
  `weight="Filled"` para manter a linguagem visual.
- `bun run bump-ui` enumera **todo** `.tsx` de `src/components/ui` e roda
  `shadcn add <nome>` — ou seja, tenta `icon`, `reicon` etc. Cuidado ao adicionar
  arquivos não-shadcn nesse diretório.
