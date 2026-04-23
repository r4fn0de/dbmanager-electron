import { cn } from "@/utils/tailwind"
import React, { useEffect, useState } from "react"
import { codeToHtml } from "shiki/bundle/web"

export type CodeBlockProps = {
  children?: React.ReactNode
  className?: string
} & React.HTMLProps<HTMLDivElement>

function CodeBlock({ children, className, ...props }: CodeBlockProps) {
  return (
    <div
      className={cn(
        "not-prose flex w-full flex-col overflow-clip border",
        "border-border bg-card text-card-foreground rounded-xl",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export type CodeBlockCodeProps = {
  code: string
  language?: string
  theme?: string
  className?: string
} & React.HTMLProps<HTMLDivElement>

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}

function buildPlainThemedHtml(code: string, theme: string): string {
  const isDark = theme.toLowerCase().includes("dark")
  const foreground = isDark ? "#D4D4D4" : "#1F2328"
  return `<pre class="shiki" style="color:${foreground};background-color:transparent" tabindex="0"><code>${escapeHtml(code)}</code></pre>`
}

function buildSqlFallbackHtml(code: string, theme: string): string {
  const isDark = theme.toLowerCase().includes("dark")
  const colors = {
    text: isDark ? "#D4D4D4" : "#1F2328",
    keyword: isDark ? "#569CD6" : "#0550AE",
    string: isDark ? "#CE9178" : "#0A3069",
    number: isDark ? "#B5CEA8" : "#116329",
    comment: isDark ? "#6A9955" : "#1A7F37",
  }

  const keywords = [
    "select", "from", "where", "join", "inner", "left", "right", "full",
    "outer", "on", "group", "by", "order", "limit", "offset", "insert",
    "into", "values", "update", "set", "delete", "create", "table", "view",
    "index", "drop", "alter", "add", "distinct", "as", "and", "or", "not",
    "null", "is", "in", "like", "between", "having", "union", "all",
  ]
  const keywordSet = new Set(keywords)

  const tokenRegex =
    /(--[^\n]*|'(?:''|[^'])*'|"(?:""|[^"])*"|\b\d+(?:\.\d+)?\b|\b[a-z_][a-z0-9_]*\b)/gi

  const highlighted = escapeHtml(code).replace(tokenRegex, (rawToken) => {
    const token = rawToken.toLowerCase()
    if (token.startsWith("--")) {
      return `<span style="color:${colors.comment}">${rawToken}</span>`
    }
    if (token.startsWith("'") || token.startsWith('"')) {
      return `<span style="color:${colors.string}">${rawToken}</span>`
    }
    if (/^\d+(\.\d+)?$/.test(token)) {
      return `<span style="color:${colors.number}">${rawToken}</span>`
    }
    if (keywordSet.has(token)) {
      return `<span style="color:${colors.keyword}">${rawToken}</span>`
    }
    return rawToken
  })

  return `<pre class="shiki sql-fallback" style="color:${colors.text};background-color:transparent" tabindex="0"><code>${highlighted}</code></pre>`
}

function CodeBlockCode({
  code,
  language = "tsx",
  theme = "github-light",
  className,
  ...props
}: CodeBlockCodeProps) {
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null)

  useEffect(() => {
    const normalizeLanguage = (value: string): string => {
      const normalized = value.trim().toLowerCase()
      const aliases: Record<string, string> = {
        postgres: "sql",
        postgresql: "sql",
        mysql: "sql",
        mariadb: "sql",
        sqlite: "sql",
        clickhouse: "sql",
        shell: "bash",
        zsh: "bash",
        sh: "bash",
        js: "javascript",
        ts: "typescript",
        yml: "yaml",
      }
      return aliases[normalized] ?? normalized
    }

    async function highlight() {
      if (!code) {
        setHighlightedHtml("<pre><code></code></pre>")
        return
      }

      const normalizedLanguage = normalizeLanguage(language)
      const useSqlFallback =
        normalizedLanguage === "sql"
        || normalizedLanguage === "plaintext"
        || normalizedLanguage === "text"

      try {
        const html = await codeToHtml(code, {
          lang: normalizedLanguage,
          theme,
        })
        setHighlightedHtml(html)
      } catch {
        try {
          // SQL is the safest fallback for this app context.
          const sqlFallback = await codeToHtml(code, { lang: "sql", theme })
          setHighlightedHtml(sqlFallback)
        } catch {
          try {
            const plaintextFallback = await codeToHtml(code, {
              lang: "text",
              theme,
            })
            setHighlightedHtml(plaintextFallback)
          } catch {
            // Robust fallback for Electron renderer: keep themed code even if Shiki runtime fails.
            setHighlightedHtml(
              useSqlFallback
                ? buildSqlFallbackHtml(code, theme)
                : buildPlainThemedHtml(code, theme),
            )
          }
        }
      }
    }
    highlight()
  }, [code, language, theme])

  const classNames = cn(
    "w-full overflow-x-auto text-[13px] [&>pre]:px-4 [&>pre]:py-4",
    className
  )

  // SSR fallback: render plain code if not hydrated yet
  return highlightedHtml ? (
    <div
      className={classNames}
      dangerouslySetInnerHTML={{ __html: highlightedHtml }}
      {...props}
    />
  ) : (
    <div className={classNames} {...props}>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  )
}

export type CodeBlockGroupProps = React.HTMLAttributes<HTMLDivElement>

function CodeBlockGroup({
  children,
  className,
  ...props
}: CodeBlockGroupProps) {
  return (
    <div
      className={cn("flex items-center justify-between", className)}
      {...props}
    >
      {children}
    </div>
  )
}

export { CodeBlockGroup, CodeBlockCode, CodeBlock }
