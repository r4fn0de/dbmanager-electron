import type {
  DOMConversionMap,
  DOMConversionOutput,
  DOMExportOutput,
  EditorConfig,
  LexicalEditor,
  LexicalNode,
  NodeKey,
  SerializedLexicalNode,
  Spread,
} from "lexical";
import { $applyNodeReplacement, DecoratorNode } from "lexical";
import type { JSX } from "react";
import { ConnectionMentionPill } from "@/components/ui/connection-mention-pill";
import type { Connection } from "@/ipc/db/types";

export type SerializedConnectionMentionNode = Spread<
  {
    connectionId: string;
    connectionLabel: string;
    mentionToken: string;
    provider: ConnectionMentionProvider;
    type: "connection-mention";
    version: 1;
  },
  SerializedLexicalNode
>;

export type ConnectionMentionProvider =
  | "neon"
  | "supabase"
  | "mysql"
  | "mariadb"
  | "clickhouse"
  | "redis"
  | "postgresql"
  | "sqlite"
  | "generic";

export function $createConnectionMentionNode(input: {
  connectionId: string;
  connectionLabel: string;
  provider: ConnectionMentionProvider;
}): ConnectionMentionNode {
  return $applyNodeReplacement(
    new ConnectionMentionNode(
      input.connectionId,
      input.connectionLabel,
      input.provider
    )
  );
}

export function $isConnectionMentionNode(
  node: LexicalNode | null | undefined
): node is ConnectionMentionNode {
  return node instanceof ConnectionMentionNode;
}

function mentionDomConversion(): DOMConversionMap {
  return {
    span: () => ({
      conversion: (domNode: HTMLElement): DOMConversionOutput | null => {
        if (!domNode.hasAttribute("data-connection-mention-id")) {
          return null;
        }
        const connectionId =
          domNode.getAttribute("data-connection-mention-id") ?? "";
        const connectionLabel =
          domNode.getAttribute("data-connection-mention-label") ??
          domNode.textContent?.replace(/^@/, "") ??
          "";
        const provider =
          (domNode.getAttribute(
            "data-connection-mention-provider"
          ) as ConnectionMentionProvider) ?? "generic";
        const mentionToken =
          domNode.getAttribute("data-connection-mention-token") ??
          `@${connectionLabel}`;
        return {
          node: $createConnectionMentionNode({
            connectionId,
            connectionLabel,
            provider,
          }).__withMentionToken(mentionToken),
        };
      },
    }),
  };
}

export class ConnectionMentionNode extends DecoratorNode<JSX.Element> {
  __connectionId: string;
  __connectionLabel: string;
  __provider: ConnectionMentionProvider;
  __mentionToken: string;

  static getType(): string {
    return "connection-mention";
  }

  static clone(node: ConnectionMentionNode): ConnectionMentionNode {
    return new ConnectionMentionNode(
      node.__connectionId,
      node.__connectionLabel,
      node.__provider,
      node.__key
    ).__withMentionToken(node.__mentionToken);
  }

  static importJSON(
    serializedNode: SerializedConnectionMentionNode
  ): ConnectionMentionNode {
    return $createConnectionMentionNode({
      connectionId: serializedNode.connectionId,
      connectionLabel: serializedNode.connectionLabel,
      provider: serializedNode.provider,
    }).__withMentionToken(serializedNode.mentionToken);
  }

  static importDOM(): DOMConversionMap {
    return mentionDomConversion();
  }

  constructor(
    connectionId: string,
    connectionLabel: string,
    provider: ConnectionMentionProvider,
    key?: NodeKey
  ) {
    super(key);
    this.__connectionId = connectionId;
    this.__connectionLabel = connectionLabel;
    this.__provider = provider;
    this.__mentionToken = `@${connectionLabel}`;
  }

  __withMentionToken(token: string): this {
    const writable = this.getWritable();
    writable.__mentionToken = token;
    return writable;
  }

  getConnectionId(): string {
    return this.getLatest().__connectionId;
  }

  getConnectionLabel(): string {
    return this.getLatest().__connectionLabel;
  }

  getMentionToken(): string {
    return this.getLatest().__mentionToken;
  }

  getTextContent(): string {
    return this.getLatest().__mentionToken;
  }

  isInline(): boolean {
    return true;
  }

  isIsolated(): boolean {
    return false;
  }

  isKeyboardSelectable(): boolean {
    return true;
  }

  createDOM(config: EditorConfig): HTMLElement {
    const element = document.createElement("span");
    const themeClass = config.theme["connection-mention"];
    if (typeof themeClass === "string" && themeClass.length > 0) {
      element.className = themeClass;
    }
    return element;
  }

  updateDOM(): boolean {
    return false;
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement("span");
    element.setAttribute(
      "data-connection-mention-id",
      this.getLatest().__connectionId
    );
    element.setAttribute(
      "data-connection-mention-label",
      this.getLatest().__connectionLabel
    );
    element.setAttribute(
      "data-connection-mention-provider",
      this.getLatest().__provider
    );
    element.setAttribute(
      "data-connection-mention-token",
      this.getLatest().__mentionToken
    );
    element.textContent = this.getLatest().__mentionToken;
    return { element };
  }

  exportJSON(): SerializedConnectionMentionNode {
    const latest = this.getLatest();
    return {
      connectionId: latest.__connectionId,
      connectionLabel: latest.__connectionLabel,
      mentionToken: latest.__mentionToken,
      provider: latest.__provider,
      type: "connection-mention",
      version: 1,
    };
  }

  decorate(_editor: LexicalEditor): JSX.Element {
    const latest = this.getLatest();
    return (
      <ConnectionMentionPill
        label={latest.__connectionLabel}
        provider={latest.__provider}
      />
    );
  }
}

export function connectionToMentionProvider(
  connection: Pick<Connection, "db_type"> & {
    provider?: string;
  }
): ConnectionMentionProvider {
  switch (connection.provider) {
    case "neon":
    case "supabase":
    case "mysql":
    case "mariadb":
    case "clickhouse":
    case "redis":
      return connection.provider;
    default:
      break;
  }
  switch (connection.db_type) {
    case "postgresql":
      return "postgresql";
    case "mysql":
      return "mysql";
    case "mariadb":
      return "mariadb";
    case "clickhouse":
      return "clickhouse";
    case "sqlite":
      return "sqlite";
    case "redis":
      return "redis";
    default:
      return "generic";
  }
}
