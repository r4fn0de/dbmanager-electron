# Menções inline no PromptInput — Design

## Objetivo

Fazer as menções de conexões aparecerem no meio do texto do prompt, como chips inline, em vez de serem renderizadas em uma linha separada acima do campo.

## Abordagem aprovada

Substituir internamente o `<textarea>` usado pelo `PromptInputTextarea` por um editor `contentEditable` quando o recurso de menções inline estiver habilitado. O editor continuará expondo e recebendo o prompt como uma string serializada, sem adicionar Lexical ou outra dependência.

A representação serializada mantém o token original (`@NomeDaConexão`). Na apresentação, o editor divide o valor em texto editável e menções selecionadas, renderizando cada menção como um `<span contenteditable="false">` inline. O texto antes e depois permanece no mesmo fluxo visual, permitindo que a menção fique no meio da frase e quebras de linha naturais.

## Fluxo de dados

1. O usuário digita no editor e o componente converte o DOM em texto serializado e em um offset de cursor.
2. `AiChatPanel` continua encaminhando o texto para `handleTextChange`, que abre e filtra a dropdown de menções.
3. Ao selecionar uma conexão, `useMentions` substitui o token incompleto pelo token completo (`@NomeDaConexão`), preserva a posição no texto e registra a conexão no `selectedMentions`.
4. O editor re-renderiza apenas a estrutura visual do valor, mantendo a menção inline no ponto correto.
5. Ao enviar, o prompt serializado continua sendo enviado ao fluxo atual e a conexão selecionada continua sendo resolvida pelo `selectedMentions`.

## Interação e compatibilidade

- Digitação antes, depois e no meio da menção deve funcionar.
- Backspace/Delete adjacente ao chip remove a menção inteira e atualiza o mapa de menções.
- Setas devem atravessar o chip sem permitir edição parcial do seu conteúdo.
- Enter continua enviando; Shift+Enter continua inserindo nova linha.
- Autosize, foco, placeholder, estado disabled e dropdown existente devem ser preservados.
- Chips de contexto de seleção/tabela/erro permanecem na linha superior.
- O visual do chip deve reutilizar `MentionChip` ou seu estilo existente, sem criar uma segunda linguagem visual.

## Limites

A primeira versão cobre somente menções de conexões selecionadas. Não serão incluídos links, skills, slash commands, terminal context ou Lexical.

## Tratamento de casos extremos

- Valores controlados que mudam externamente devem reconstruir o conteúdo sem duplicar nós.
- Menções removidas da lista de conexões devem continuar sendo texto legível e não quebrar o editor.
- Seleções não colapsadas devem ser normalizadas com segurança antes da edição.
- O editor deve evitar loops entre atualizações controladas e eventos nativos de input.

## Verificação

Adicionar testes para as funções puras de serialização, segmentação e cálculo de cursor. Rodar o typecheck, os testes unitários relacionados e o check do projeto. Validar manualmente no chat: menção no início, meio e fim; múltiplas menções; backspace/delete; Enter/Shift+Enter; texto em múltiplas linhas.
