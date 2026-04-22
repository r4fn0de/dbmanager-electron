import { Suspense, lazy } from "react";
import type { EditorProps, OnMount } from "@monaco-editor/react";

// Lazy load the Monaco Editor component
const MonacoEditor = lazy(() => import("@monaco-editor/react"));

interface LazyMonacoEditorProps extends EditorProps {
  fallback?: React.ReactNode;
}

const defaultFallback = (
  <div className="flex h-full w-full items-center justify-center rounded-md border bg-muted/30">
    <span className="text-xs text-muted-foreground">Loading editor...</span>
  </div>
);

export function LazyMonacoEditor({ fallback = defaultFallback, ...props }: LazyMonacoEditorProps) {
  return (
    <Suspense fallback={fallback}>
      <MonacoEditor {...props} />
    </Suspense>
  );
}

export type { OnMount };
