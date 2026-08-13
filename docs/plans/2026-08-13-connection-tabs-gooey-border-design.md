# Borda gooey da aba ativa — Design

## Objetivo

Adicionar uma borda à aba ativa no tema default sem interromper o efeito gooey, fazendo com que a borda acompanhe tanto o corpo da aba quanto a ponte inferior durante a troca de abas.

## Abordagem aprovada

A borda não será aplicada ao `Reorder.Item`, pois esse elemento representa apenas o retângulo de layout e não a silhueta gooey final. Em vez disso, `border-border` será aplicado às duas formas internas que já compõem o efeito gooey:

- a camada principal da aba ativa;
- a ponte inferior que conecta a aba ao restante da title bar.

Como essas formas permanecem dentro do mesmo elemento com `filter: url(#titlebar-tabs-gooey)`, a borda será rasterizada e mesclada pelo mesmo filtro SVG. Os `layoutId`s e as transições existentes serão preservados.

## Tema

- Tema default: exibir a borda nas formas filtradas.
- Tema `neo`: preservar o comportamento atual, que já aplica borda no `Reorder.Item`.
- Sem `gooeyFilterId`: não adicionar uma nova borda; o comportamento fora da title bar permanece inalterado.

## Critérios de aceitação

1. A aba ativa default apresenta borda visível no corpo e na ponte gooey.
2. Ao trocar de aba, a borda acompanha a animação e não fica presa ao retângulo antigo.
3. A ponte inferior também participa do contorno visual.
4. O tema `neo` não sofre alteração visual.
5. Abas inativas e o comportamento de hover permanecem inalterados.
6. Typecheck e lint passam sem novos erros.
