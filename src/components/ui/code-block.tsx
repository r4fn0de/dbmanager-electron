import { cn } from "@/utils/tailwind"
import React, { useEffect, useState } from "react"
import { codeToHtml } from "shiki"

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
          const plaintextFallback = await codeToHtml(code, {
            lang: "plaintext",
            theme,
          })
          setHighlightedHtml(plaintextFallback)
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
