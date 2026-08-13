# Conexões de IA e agentes integrados — Design

## Objetivo

Transformar o assistente de IA do TarsDB em um hub de conexões capaz de trabalhar com providers de API e agentes locais — Claude Code, Codex, Pi, Oh My Pi e OpenCode — permitindo selecionar vários modelos no input e interagir com banco de dados, editor SQL, arquivos, workspace e terminal com permissões explícitas.

## Contexto atual

O TarsDB já possui:

- streaming de chat por IPC bruto, separado do oRPC;
- AI SDK para OpenAI, Anthropic, Google, OpenAI-compatible e Ollama;
- configuração global de um provider e um modelo em `src/ipc/ai/config.ts`;
- descoberta e modelos customizados;
- aprovação de tool calls;
- contexto de schema/conexões e menções inline no chat;
- armazenamento local de configurações e chaves.

A limitação principal é que o streaming usa sempre `getCurrentModel()`. Portanto, a escolha feita no input ainda não identifica uma conexão/modelo por conversa e não existe um runtime comum para agentes CLI.

## Arquitetura aprovada

Criar um `AiConnectionHub` no processo principal, preservando o pipeline de streaming atual e adicionando adaptadores:

```text
Renderer
  ├─ seletor de conexão/modelo
  └─ chat
       └─ oRPC + streaming IPC
            └─ AiConnectionHub
                 ├─ ApiProviderAdapter
                 ├─ ClaudeCodeAdapter
                 ├─ CodexAdapter
                 ├─ PiAdapter
                 ├─ OhMyPiAdapter
                 └─ OpenCodeAdapter
                      └─ AppToolRegistry
```

Cada conexão é um perfil independente:

```ts
interface AiConnection {
  id: string;
  name: string;
  type: "api" | "cli-agent";
  provider:
    | "openai"
    | "anthropic"
    | "openai-compatible"
    | "ollama"
    | "claude-code"
    | "codex"
    | "pi"
    | "oh-my-pi"
    | "opencode";
  models: AiModel[];
  defaultModelId?: string;
  authStatus: "authenticated" | "not-configured" | "error";
  capabilities: {
    tools: boolean;
    terminal: boolean;
    files: boolean;
    reasoning: boolean;
  };
}
```

As configurações persistem localmente. Tokens e API keys ficam no processo principal. Cada conversa referencia `connectionId` e `modelId`, sem alterar um provider global ao trocar a opção do input.

## Autenticação e descoberta

A interface comum dos adaptadores será:

```ts
interface AiAgentAdapter {
  detect(): Promise<AgentInstallation>;
  authenticate(connectionId: string): Promise<AuthResult>;
  listModels(connectionId: string): Promise<AiModel[]>;
  startSession(input: StartSessionInput): Promise<AgentSession>;
  send(sessionId: string, input: AgentMessage): Promise<void>;
  abort(sessionId: string): Promise<void>;
  dispose(sessionId: string): Promise<void>;
}
```

- Providers API usam API keys armazenadas no processo principal.
- Claude Code será detectado e consultará o status/fluxo de autenticação próprio ou ACP.
- Codex suportará login ChatGPT, `OPENAI_API_KEY` e `CODEX_API_KEY` quando anunciados pelo runtime.
- Pi e Oh My Pi respeitarão a instalação e configuração local existente.
- OpenCode poderá usar configuração local, servidor já iniciado ou processo gerenciado pelo TarsDB.
- O renderer só recebe status e dados mascarados, nunca tokens completos.
- APIs compatíveis com OpenAI usam `/models`.
- Agentes ACP usam os modelos anunciados por `session/new`.
- Pi, OMP e OpenCode usam o runtime/configuração disponível, com fallback para modelos adicionados manualmente.
- Catálogos são cacheados por conexão, com atualização manual e automática.

As sessões são isoladas por conversa, conexão, modelo e workspace:

```ts
{
  connectionId: string;
  modelId: string;
  workspacePath?: string;
  agentSessionId?: string;
}
```

## Ferramentas e interação com o app

O `AppToolRegistry` terá contratos únicos para providers API e agentes CLI:

```text
database.listConnections
database.openConnection
database.getSchema
database.inspectTable
database.executeSelect
database.previewMutation
database.executeMutation

editor.getActiveFile
editor.getSelection
editor.insertSql
editor.replaceSelection
editor.openSqlTab
editor.runCurrentQuery

workspace.listFiles
workspace.readFile
workspace.search
workspace.writeFile
workspace.applyPatch

terminal.execute
terminal.listProcesses
terminal.killProcess

app.getState
app.openPanel
app.selectConnection
app.selectTab
```

Providers API recebem tools nativas do AI SDK, executadas no processo principal. Agentes CLI recebem as mesmas ferramentas através de um servidor MCP local criado por sessão.

O servidor MCP:

- escuta somente em `127.0.0.1`;
- usa porta aleatória;
- usa token temporário por sessão;
- limita acesso a `connectionId`, `workspacePath`, `sessionId` e tools permitidas;
- revoga o token e encerra o servidor ao finalizar a sessão.

### Política inicial de permissões

| Operação | Política |
|---|---|
| Ler schema e estado do app | Automática |
| Ler arquivos do workspace | Automática |
| `SELECT` | Automática |
| Inserir SQL no editor | Preview antes de aplicar |
| Alterar arquivos | Confirmação |
| `INSERT`, `UPDATE`, `DELETE`, DDL | Confirmação obrigatória |
| Executar terminal | Confirmação obrigatória |
| Acessar credenciais | Nunca permitido diretamente |

As confirmações reutilizam o sistema atual de aprovação, exibindo ferramenta, argumentos, preview e riscos. SQL e arquivos devem oferecer diff/preview antes de aplicar.

## Interface

O input terá um seletor independente das menções de banco:

```text
[ Claude Code · Claude Sonnet ▾ ]   @conexão  escreva seu pedido...
```

O popover agrupa conexões e seus modelos, exibindo status de autenticação, favoritos, busca, capacidades, login/configuração e atualização de modelos. Uma conexão OpenAI-compatible pode ter vários perfis, cada um com base URL, credencial e catálogo próprio de modelos.

A seção atual `AI Settings` evolui para `AI Connections`, com ações para:

- adicionar, editar, duplicar, renomear e remover conexões;
- escolher API ou agente local;
- configurar base URL e credencial;
- detectar e autenticar CLIs;
- adicionar modelos manualmente;
- atualizar modelos;
- escolher modelo padrão;
- testar conexão;
- configurar workspace padrão e permissões.

A seleção é persistida por conversa e há um padrão global para novas conversas. As configurações atuais serão migradas automaticamente para a primeira conexão equivalente.

## Fluxo de mensagem

```text
1. Usuário escolhe conexão/modelo no input.
2. Renderer envia connectionId + modelId.
3. Main resolve o perfil e valida permissões.
4. Hub inicia ou reutiliza a sessão.
5. Agente recebe contexto de banco/workspace.
6. Agente chama tools quando necessário.
7. Hub aplica a política de segurança.
8. Renderer recebe texto, tool calls, previews e aprovações.
9. Sessão e histórico são persistidos.
```

O contrato de streaming será ampliado com `connectionId`, `modelId`, `sessionId` e `source: "api" | "cli-agent"`. Eventos dos diferentes runtimes serão normalizados para texto, reasoning, tools, resultados e erros já consumidos pela UI atual.

## Falhas e recuperação

- CLI ausente: informar e permitir configurar o caminho.
- Não autenticado: abrir login/configuração.
- Modelo indisponível: permitir atualizar ou escolher outro.
- Processo travado: abortar e reiniciar sessão.
- MCP indisponível: bloquear tools, sem fallback silencioso.
- Permissão negada: informar o escopo exato.
- API indisponível: manter histórico e permitir retry com outro modelo.

## Fases de implementação

1. Criar perfis de conexão e migração do provider atual.
2. Permitir múltiplos providers/modelos API.
3. Adicionar seletor no input.
4. Unificar tools de banco e editor.
5. Adicionar workspace e terminal com permissões.
6. Integrar Claude Code, Codex, Pi, OMP e OpenCode.
7. Adicionar MCP local, sessões persistentes e favoritos.

## Testes

- Unitários para schemas, migração, adapters, descoberta, permissões e sanitização.
- Integração para servidor MCP, lifecycle de processos e aprovações.
- E2E para seletor, login, troca de modelo, edição SQL, previews e terminal.
- Segurança para traversal de workspace, tokens inválidos, secrets em logs e comandos destrutivos.
- Smoke tests com CLIs instalados e ausentes.

## Fora do escopo inicial

- Sincronização de credenciais entre dispositivos.
- Execução de agentes remotos em servidores externos.
- Compartilhamento de sessões entre usuários.
- Autoaprovação de operações destrutivas.
- Uso de credenciais de banco diretamente pelos agentes.
