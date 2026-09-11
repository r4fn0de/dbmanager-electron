/**
 * Table Search — fuzzy matching utilities for the Explorer sidebar.
 *
 * Provides instant local matching that runs on every keystroke:
 * - Substring match (current behavior)
 * - Prefix match ("usr" → "users")
 * - Snake_case / camelCase segment match ("order" → "order_items")
 * - Accent-insensitive matching ("produto" → "produtos")
 * - Common synonym/alias map ("user" ↔ "usr", "produto" ↔ "product")
 */

// ── Accent normalization ──────────────────────────────────────────────

const ACCENT_MAP: Record<string, string> = {
  à: "a",
  á: "a",
  â: "a",
  ã: "a",
  ä: "a",
  ç: "c",
  è: "e",
  é: "e",
  ê: "e",
  ë: "e",
  ì: "i",
  í: "i",
  î: "i",
  ï: "i",
  ñ: "n",
  ò: "o",
  ó: "o",
  ô: "o",
  õ: "o",
  ö: "o",
  ù: "u",
  ú: "u",
  û: "u",
  ü: "u",
};

/** Remove diacritics for accent-insensitive comparison. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[áàãâäéèêëíìîïóòõôöúùûüçñ]/g, (ch) => ACCENT_MAP[ch] ?? ch);
}

// ── Synonym map ────────────────────────────────────────────────────────

/** Common abbreviations and translations for table name matching. */
const SYNONYMS: Record<string, string[]> = {
  address: ["endereco", "enderecos", "location", "locations", "local"],
  audit: ["auditoria", "auditorias", "audit_log", "audit_trail"],
  auditoria: ["audit", "audits", "audit_log", "audit_trail"],
  autenticacao: ["auth", "authentication", "login"],
  auth: ["authentication", "autenticacao", "autenticação", "login", "logins"],
  categoria: ["category", "categories", "cat", "group"],
  category: ["categoria", "categorias", "cat", "cats", "group", "groups"],
  cliente: ["customer", "customers", "client", "clients"],
  comentario: ["comment", "comments", "review"],
  comment: ["comentario", "comentarios", "comentário", "review", "reviews"],
  config: [
    "configuration",
    "configuracao",
    "configuração",
    "setting",
    "settings",
  ],
  configuracao: ["config", "configuration", "setting"],
  customer: ["cliente", "clientes", "client", "clients"],
  document: ["documento", "documentos", "doc", "docs", "arquivo", "file"],
  documento: ["document", "documents", "doc", "arquivo", "file"],
  employee: [
    "funcionario",
    "funcionarios",
    "staff",
    "worker",
    "workers",
    "trabalhador",
  ],
  endereco: ["address", "addresses", "location", "local"],
  estoque: ["stock", "stocks", "inventory", "inventario"],
  etiqueta: ["tag", "tags", "label", "marca"],
  fatura: ["invoice", "invoices", "nota", "receipt", "bill"],
  funcionario: ["employee", "employees", "staff", "worker", "trabalhador"],
  image: ["imagem", "imagens", "photo", "photos", "foto", "fotos", "picture"],
  imagem: ["image", "images", "photo", "foto", "picture"],
  invoice: [
    "fatura",
    "faturas",
    "nota",
    "notas",
    "receipt",
    "receipts",
    "bill",
  ],
  log: ["logs", "registro", "registros", "audit", "auditoria"],
  loja: ["store", "stores", "shop", "warehouse"],
  mensagem: ["message", "messages", "msg", "chat", "notification"],
  message: [
    "mensagem",
    "mensagens",
    "msg",
    "chat",
    "notification",
    "notificacao",
  ],
  notificacao: ["notification", "notifications", "alert", "aviso"],
  notification: [
    "notificacao",
    "notificacoes",
    "notificação",
    "alert",
    "alerts",
    "aviso",
  ],
  order: [
    "pedido",
    "pedidos",
    "venda",
    "vendas",
    "purchase",
    "purchases",
    "ordem",
  ],
  pagamento: ["payment", "payments", "pay"],
  payment: ["pagamento", "pagamentos", "pay", "pays"],
  pedido: ["order", "orders", "venda", "purchase", "ordem"],
  permissao: ["permission", "permissions", "role", "acesso"],
  permission: [
    "permissao",
    "permissoes",
    "permissão",
    "role",
    "roles",
    "acesso",
  ],
  preco: ["price", "prices", "valor", "cost"],
  price: ["preco", "precos", "preço", "valor", "valores", "cost"],
  product: ["produto", "produtos", "prod", "item", "items", "artigo"],
  produto: ["product", "products", "prod", "item", "artigo"],
  project: ["projeto", "projetos", "projecto"],
  projeto: ["project", "projects"],
  registro: ["log", "logs", "record", "records", "audit"],
  relatorio: ["report", "reports"],
  report: ["relatorio", "relatorios", "relatório"],
  sale: ["venda", "vendas", "order", "orders", "pedido"],
  sessao: ["session", "sessions"],
  session: ["sessao", "sessoes", "sessão"],
  stock: ["estoque", "inventory", "inventario", "estoques"],
  store: ["loja", "lojas", "shop", "shops", "warehouse"],
  tag: ["tags", "label", "labels", "etiqueta", "etiquetas", "marca"],
  tarefa: ["task", "tasks", "todo", "job"],
  task: ["tarefa", "tarefas", "todo", "todos", "job", "jobs"],
  token: ["tokens", "chave", "chaves"],
  user: ["usr", "account", "profile", "usuario", "usuarios", "conta"],
  usr: ["user", "users", "usuario"],
  venda: ["order", "orders", "sale", "sales", "pedido", "vendas"],
};

/** Expand a single word into its synonyms (including the word itself). */
function expandSynonyms(word: string): string[] {
  const normalized = normalize(word);
  const result = new Set<string>([normalized]);
  const synonyms = SYNONYMS[normalized];
  if (synonyms) {
    for (const syn of synonyms) {
      result.add(normalize(syn));
    }
  }
  return Array.from(result);
}

// ── Segment extraction ─────────────────────────────────────────────────

/** Split a table name into searchable segments.
 *  e.g. "order_items" → ["order", "items"]
 *       "UserProfile" → ["user", "profile"]
 *       "tblOrderItems" → ["tbl", "order", "items"]
 */
function extractSegments(name: string): string[] {
  // Split on underscores, then split camelCase within each part
  const parts = name.split("_");
  const segments: string[] = [];
  for (const part of parts) {
    // Split camelCase: "UserProfile" → ["User", "Profile"]
    const camelParts = part.replace(/([a-z])([A-Z])/g, "$1 $2").split(" ");
    segments.push(...camelParts.map((s) => normalize(s)));
  }
  return segments;
}

// ── Match scoring ───────────────────────────────────────────────────────

export interface TableSearchMatch {
  matchType: "exact" | "substring" | "prefix" | "segment" | "synonym";
  name: string;
  score: number;
}

/**
 * Score a table name against a search query.
 * Higher score = better match. Returns 0 if no match.
 */
function scoreMatch(tableName: string, query: string): TableSearchMatch | null {
  const normalizedName = normalize(tableName);
  const normalizedQuery = normalize(query.trim());

  if (!normalizedQuery) {
    return null;
  }

  // Exact match
  if (normalizedName === normalizedQuery) {
    return { matchType: "exact", name: tableName, score: 100 };
  }

  // Prefix match (query matches start of table name)
  if (normalizedName.startsWith(normalizedQuery)) {
    return { matchType: "prefix", name: tableName, score: 80 };
  }

  // Substring match
  if (normalizedName.includes(normalizedQuery)) {
    return { matchType: "substring", name: tableName, score: 60 };
  }

  // Segment match — check if query matches any segment of the table name
  const segments = extractSegments(tableName);
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (segment === normalizedQuery) {
      return { matchType: "segment", name: tableName, score: 70 };
    }
    if (segment.startsWith(normalizedQuery)) {
      return { matchType: "segment", name: tableName, score: 50 };
    }
    if (segment.includes(normalizedQuery)) {
      return { matchType: "segment", name: tableName, score: 40 };
    }
  }

  // Synonym match — expand query words and check against table name segments
  const queryWords = normalizedQuery.split(/\s+/);
  const expandedWords = queryWords.flatMap(expandSynonyms);
  for (const expanded of expandedWords) {
    // Check if expanded synonym matches a segment
    for (const segment of segments) {
      if (segment === expanded) {
        return { matchType: "synonym", name: tableName, score: 30 };
      }
      if (segment.startsWith(expanded) || expanded.startsWith(segment)) {
        return { matchType: "synonym", name: tableName, score: 20 };
      }
    }
    // Also check if expanded synonym is a substring of the full name
    if (normalizedName.includes(expanded)) {
      return { matchType: "synonym", name: tableName, score: 15 };
    }
  }

  return null;
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Fuzzy-search a list of table names against a query string.
 * Returns matches sorted by score (best first).
 */
export function fuzzySearchTables(
  tableNames: string[],
  query: string
): TableSearchMatch[] {
  if (!query.trim()) {
    return [];
  }

  const matches: TableSearchMatch[] = [];
  for (const name of tableNames) {
    const match = scoreMatch(name, query);
    if (match) {
      matches.push(match);
    }
  }

  return matches.sort((a, b) => b.score - a.score);
}

/**
 * Heuristic: determine if a search query looks "descriptive" enough
 * to warrant an AI semantic search call.
 *
 * Returns true if:
 * - The query has 3+ words, OR
 * - The query contains words that don't appear in any table name
 *   (suggesting the user is describing intent, not naming a table)
 */
export function isDescriptiveQuery(
  query: string,
  tableNames: string[]
): boolean {
  const trimmed = query.trim();
  if (!trimmed) {
    return false;
  }

  const words = normalize(trimmed).split(/\s+/);
  if (words.length >= 3) {
    return true;
  }

  // Build a set of all segments from all table names
  const allSegments = new Set<string>();
  for (const name of tableNames) {
    for (const seg of extractSegments(name)) {
      allSegments.add(seg);
    }
    allSegments.add(normalize(name));
  }

  // If any word doesn't appear in table names/segments, it's descriptive
  const hasNonTableWord = words.some(
    (word) => word.length > 2 && !allSegments.has(word)
  );
  return hasNonTableWord;
}
