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
  á: "a", à: "a", ã: "a", â: "a", ä: "a",
  é: "e", è: "e", ê: "e", ë: "e",
  í: "i", ì: "i", î: "i", ï: "i",
  ó: "o", ò: "o", õ: "o", ô: "o", ö: "o",
  ú: "u", ù: "u", û: "u", ü: "u",
  ç: "c",
  ñ: "n",
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
  user: ["usr", "account", "profile", "usuario", "usuarios", "conta"],
  usr: ["user", "users", "usuario"],
  product: ["produto", "produtos", "prod", "item", "items", "artigo"],
  produto: ["product", "products", "prod", "item", "artigo"],
  order: ["pedido", "pedidos", "venda", "vendas", "purchase", "purchases", "ordem"],
  pedido: ["order", "orders", "venda", "purchase", "ordem"],
  venda: ["order", "orders", "sale", "sales", "pedido", "vendas"],
  sale: ["venda", "vendas", "order", "orders", "pedido"],
  customer: ["cliente", "clientes", "client", "clients"],
  cliente: ["customer", "customers", "client", "clients"],
  invoice: ["fatura", "faturas", "nota", "notas", "receipt", "receipts", "bill"],
  fatura: ["invoice", "invoices", "nota", "receipt", "bill"],
  payment: ["pagamento", "pagamentos", "pay", "pays"],
  pagamento: ["payment", "payments", "pay"],
  category: ["categoria", "categorias", "cat", "cats", "group", "groups"],
  categoria: ["category", "categories", "cat", "group"],
  employee: ["funcionario", "funcionarios", "staff", "worker", "workers", "trabalhador"],
  funcionario: ["employee", "employees", "staff", "worker", "trabalhador"],
  address: ["endereco", "enderecos", "location", "locations", "local"],
  endereco: ["address", "addresses", "location", "local"],
  session: ["sessao", "sessoes", "sessão"],
  sessao: ["session", "sessions"],
  token: ["tokens", "chave", "chaves"],
  auth: ["authentication", "autenticacao", "autenticação", "login", "logins"],
  autenticacao: ["auth", "authentication", "login"],
  log: ["logs", "registro", "registros", "audit", "auditoria"],
  registro: ["log", "logs", "record", "records", "audit"],
  config: ["configuration", "configuracao", "configuração", "setting", "settings"],
  configuracao: ["config", "configuration", "setting"],
  permission: ["permissao", "permissoes", "permissão", "role", "roles", "acesso"],
  permissao: ["permission", "permissions", "role", "acesso"],
  image: ["imagem", "imagens", "photo", "photos", "foto", "fotos", "picture"],
  imagem: ["image", "images", "photo", "foto", "picture"],
  document: ["documento", "documentos", "doc", "docs", "arquivo", "file"],
  documento: ["document", "documents", "doc", "arquivo", "file"],
  stock: ["estoque", "inventory", "inventario", "estoques"],
  estoque: ["stock", "stocks", "inventory", "inventario"],
  price: ["preco", "precos", "preço", "valor", "valores", "cost"],
  preco: ["price", "prices", "valor", "cost"],
  store: ["loja", "lojas", "shop", "shops", "warehouse"],
  loja: ["store", "stores", "shop", "warehouse"],
  report: ["relatorio", "relatorios", "relatório"],
  relatorio: ["report", "reports"],
  task: ["tarefa", "tarefas", "todo", "todos", "job", "jobs"],
  tarefa: ["task", "tasks", "todo", "job"],
  project: ["projeto", "projetos", "projecto"],
  projeto: ["project", "projects"],
  message: ["mensagem", "mensagens", "msg", "chat", "notification", "notificacao"],
  mensagem: ["message", "messages", "msg", "chat", "notification"],
  notification: ["notificacao", "notificacoes", "notificação", "alert", "alerts", "aviso"],
  notificacao: ["notification", "notifications", "alert", "aviso"],
  comment: ["comentario", "comentarios", "comentário", "review", "reviews"],
  comentario: ["comment", "comments", "review"],
  tag: ["tags", "label", "labels", "etiqueta", "etiquetas", "marca"],
  etiqueta: ["tag", "tags", "label", "marca"],
  audit: ["auditoria", "auditorias", "audit_log", "audit_trail"],
  auditoria: ["audit", "audits", "audit_log", "audit_trail"],
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
  name: string;
  score: number;
  matchType: "exact" | "substring" | "prefix" | "segment" | "synonym";
}

/**
 * Score a table name against a search query.
 * Higher score = better match. Returns 0 if no match.
 */
function scoreMatch(tableName: string, query: string): TableSearchMatch | null {
  const normalizedName = normalize(tableName);
  const normalizedQuery = normalize(query.trim());

  if (!normalizedQuery) return null;

  // Exact match
  if (normalizedName === normalizedQuery) {
    return { name: tableName, score: 100, matchType: "exact" };
  }

  // Prefix match (query matches start of table name)
  if (normalizedName.startsWith(normalizedQuery)) {
    return { name: tableName, score: 80, matchType: "prefix" };
  }

  // Substring match
  if (normalizedName.includes(normalizedQuery)) {
    return { name: tableName, score: 60, matchType: "substring" };
  }

  // Segment match — check if query matches any segment of the table name
  const segments = extractSegments(tableName);
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (segment === normalizedQuery) {
      return { name: tableName, score: 70, matchType: "segment" };
    }
    if (segment.startsWith(normalizedQuery)) {
      return { name: tableName, score: 50, matchType: "segment" };
    }
    if (segment.includes(normalizedQuery)) {
      return { name: tableName, score: 40, matchType: "segment" };
    }
  }

  // Synonym match — expand query words and check against table name segments
  const queryWords = normalizedQuery.split(/\s+/);
  const expandedWords = queryWords.flatMap(expandSynonyms);
  for (const expanded of expandedWords) {
    // Check if expanded synonym matches a segment
    for (const segment of segments) {
      if (segment === expanded) {
        return { name: tableName, score: 30, matchType: "synonym" };
      }
      if (segment.startsWith(expanded) || expanded.startsWith(segment)) {
        return { name: tableName, score: 20, matchType: "synonym" };
      }
    }
    // Also check if expanded synonym is a substring of the full name
    if (normalizedName.includes(expanded)) {
      return { name: tableName, score: 15, matchType: "synonym" };
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
  query: string,
): TableSearchMatch[] {
  if (!query.trim()) return [];

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
  tableNames: string[],
): boolean {
  const trimmed = query.trim();
  if (!trimmed) return false;

  const words = normalize(trimmed).split(/\s+/);
  if (words.length >= 3) return true;

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
    (word) => word.length > 2 && !allSegments.has(word),
  );
  return hasNonTableWord;
}
