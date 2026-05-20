/**
 * ProviderConfigDialog — Dialog for configuring individual AI providers.
 *
 * Handles API key management, model selection, and provider-specific settings
 * (Ollama model picker, OpenAI-compatible Base URL and model ID).
 *
 * State for inputs (API key, model, Base URL) is self-contained — the parent
 * only provides operation callbacks and server data.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { PROVIDER_ICONS } from "@/components/ProviderIcons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Icon as UiIcon } from "@/components/ui/Icon";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AiProvidersInfo } from "../hooks/ai-actions";

type ProviderName = "openai" | "anthropic" | "google" | "openai-compatible" | "ollama";

interface OllamaStatus {
  detected: boolean;
  models: string[];
  checking: boolean;
}

interface ProviderConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providerName: string | null;
  settings: AiProvidersInfo;
  ollamaStatus: OllamaStatus;
  onRefreshOllama: () => Promise<void>;
  onSaveApiKey: (provider: string, key: string) => Promise<void>;
  onRemoveApiKey: (provider: string) => Promise<void>;
  onModelChange: (model: string) => Promise<void>;
  onSaveBaseUrl: (url: string) => Promise<void>;
}

function normalizeCompatibleBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/$/, "");
  return trimmed.replace(/\/models$/i, "");
}

export function ProviderConfigDialog({
  open,
  onOpenChange,
  providerName,
  settings,
  ollamaStatus,
  onRefreshOllama,
  onSaveApiKey,
  onRemoveApiKey,
  onModelChange,
  onSaveBaseUrl,
}: ProviderConfigDialogProps) {
  // ——— Dialog-internal state (resets when dialog opens) ———
  const [apiKeyInputs, setApiKeyInputs] = useState<Record<string, string>>({});
  const [showApiKeys, setShowApiKeys] = useState<Record<string, boolean>>({});
  const [isSavingKey, setIsSavingKey] = useState<Record<string, boolean>>({});
  const [modelInput, setModelInput] = useState("");
  const [baseUrlInput, setBaseUrlInput] = useState("");
  const [modelSaved, setModelSaved] = useState(false);
  const [isSavingModel, setIsSavingModel] = useState(false);
  const [isSavingBaseUrl, setIsSavingBaseUrl] = useState(false);

  // Sync inputs from server settings whenever dialog opens or settings change
  useEffect(() => {
    setModelInput(settings.current.model ?? "");
    setBaseUrlInput(settings.current.openaiCompatibleBaseURL ?? "");
  }, [settings.current.model, settings.current.openaiCompatibleBaseURL]);

  // Reset per-provider input state when the dialog target changes
  useEffect(() => {
    if (providerName) {
      setApiKeyInputs((prev) => ({ ...prev, [providerName]: "" }));
    }
  }, [providerName]);

  const provider = useMemo(
    () => settings.providers.find((p) => p.name === providerName),
    [providerName, settings.providers],
  );

  /* ------- Handlers ------- */

  const handleSaveKey = useCallback(async () => {
    if (!providerName) return;
    const key = apiKeyInputs[providerName]?.trim();
    if (!key) return;
    setIsSavingKey((prev) => ({ ...prev, [providerName]: true }));
    try {
      await onSaveApiKey(providerName, key);
      setApiKeyInputs((prev) => ({ ...prev, [providerName]: "" }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save API key");
    } finally {
      setIsSavingKey((prev) => ({ ...prev, [providerName]: false }));
    }
  }, [providerName, apiKeyInputs, onSaveApiKey]);

  const handleRemoveKey = useCallback(async () => {
    if (!providerName) return;
    try {
      await onRemoveApiKey(providerName);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove API key");
    }
  }, [providerName, onRemoveApiKey]);

  const handleModelSave = useCallback(async () => {
    if (!modelInput.trim()) return;
    setIsSavingModel(true);
    try {
      await onModelChange(modelInput.trim());
      setModelSaved(true);
      setTimeout(() => setModelSaved(false), 2000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update model");
    } finally {
      setIsSavingModel(false);
    }
  }, [modelInput, onModelChange]);

  const handleBaseUrlSave = useCallback(async () => {
    if (!baseUrlInput.trim()) return;
    setIsSavingBaseUrl(true);
    try {
      const normalized = normalizeCompatibleBaseUrl(baseUrlInput);
      await onSaveBaseUrl(normalized);
      setBaseUrlInput(normalized);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update Base URL");
    } finally {
      setIsSavingBaseUrl(false);
    }
  }, [baseUrlInput, onSaveBaseUrl]);

  /* ------- Render ------- */

  const renderIcon = () => {
    if (!providerName) return null;
    const Icon = PROVIDER_ICONS[providerName];
    if (!Icon) return null;
    return (
      <div className="flex size-16 items-center justify-center rounded-2xl bg-muted ring-1 ring-border">
        <Icon className="size-8" />
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onOpenChange(false)}>
      <DialogContent className="t-resize sm:max-w-md">
        <DialogHeader className="text-center">
          <div className="mx-auto mb-3">{renderIcon()}</div>
          <DialogTitle>{provider?.label ?? providerName}</DialogTitle>
          <DialogDescription>
            {providerName === "ollama"
              ? "Configure local model settings."
              : "Configure API key, model and other settings for this provider."}
          </DialogDescription>
        </DialogHeader>

        {providerName === "ollama" ? (
          <OllamaConfig
            ollamaStatus={ollamaStatus}
            currentModel={settings.current.model}
            onRefresh={onRefreshOllama}
            onModelChange={onModelChange}
          />
        ) : provider ? (() => {
          const pName = providerName as string;
          return (
          <ProviderApiConfig
            provider={provider}
            providerName={pName}
            apiKeyInputs={apiKeyInputs}
            showApiKeys={showApiKeys}
            isSavingKey={isSavingKey}
            onApiKeyInputChange={(v) =>
              setApiKeyInputs((prev) => ({ ...prev, [pName]: v }))
            }
            onToggleShowKey={() =>
              setShowApiKeys((prev) => ({
                ...prev,
                [pName]: !prev[pName],
              }))
            }
            onSaveKey={handleSaveKey}
            onRemoveKey={handleRemoveKey}
            // OpenAI-compatible fields
            modelInput={modelInput}
            onModelInputChange={(v) => {
              setModelInput(v);
              if (modelSaved) setModelSaved(false);
            }}
            onModelKeyDown={(e) => {
              if (e.key === "Enter" && modelInput.trim()) {
                handleModelSave();
              }
            }}
            onModelSave={handleModelSave}
            isSavingModel={isSavingModel}
            modelSaved={modelSaved}
            baseUrlInput={baseUrlInput}
            onBaseUrlInputChange={setBaseUrlInput}
            onBaseUrlBlur={() => {
              if (baseUrlInput.trim()) {
                handleBaseUrlSave();
              }
            }}
            isSavingBaseUrl={isSavingBaseUrl}
          />
          );
        })() : null}

        <DialogFooter className="gap-2.5 border-t bg-muted/30 px-6 py-3.5">
          {providerName === "ollama" ? (
            <Button
              type="button"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="h-8 px-5 text-xs shadow-sm"
            >
              Done
            </Button>
          ) : (
            <ProviderDialogActions
              providerName={providerName}
              apiKeyInputs={apiKeyInputs}
              isSavingKey={isSavingKey}
              onClear={() =>
                setApiKeyInputs((prev) => ({ ...prev, [providerName ?? ""]: "" }))
              }
              onDone={async () => {
                if (apiKeyInputs[providerName ?? ""]?.trim()) {
                  await handleSaveKey();
                }
                onOpenChange(false);
              }}
            />
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OllamaConfig({
  ollamaStatus,
  currentModel,
  onRefresh,
  onModelChange,
}: {
  ollamaStatus: OllamaStatus;
  currentModel: string;
  onRefresh: () => Promise<void>;
  onModelChange: (model: string) => Promise<void>;
}) {
  return (
    <div className="space-y-4 pt-2">
      <div className="flex items-center gap-2 text-xs">
        {ollamaStatus.detected ? (
          <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
            <UiIcon name="circle-check" className="size-3" />
            Ollama detected ({ollamaStatus.models.length} models)
          </span>
        ) : (
          <span className="text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
            <UiIcon name="alert-circle" className="size-3" />
            Ollama not running
          </span>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          disabled={ollamaStatus.checking}
          className="h-6 px-2 text-xs ml-auto"
        >
          {ollamaStatus.checking ? (
            <UiIcon name="loader" className="size-3 animate-spin" />
          ) : (
            <UiIcon name="refresh" className="size-3" />
          )}
          Refresh
        </Button>
      </div>

      {ollamaStatus.models.length > 0 && (
        <div className="space-y-2">
          <Label className="text-xs font-medium text-muted-foreground">
            Model
          </Label>
          <select
            value={currentModel}
            onChange={(e) => onModelChange(e.target.value)}
            className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs font-mono"
          >
            {ollamaStatus.models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <p className="text-[11px] text-muted-foreground">
            Models are pulled locally via{" "}
            <code className="text-foreground/60">ollama pull</code>
          </p>
        </div>
      )}

      {!ollamaStatus.detected && (
        <p className="text-[11px] text-muted-foreground">
          Install Ollama from <code className="text-foreground/60">ollama.com</code> and
          run <code className="text-foreground/60">ollama serve</code> to get started.
        </p>
      )}
    </div>
  );
}

interface ProviderApiConfigProps {
  provider: NonNullable<AiProvidersInfo["providers"][number]>;
  providerName: string;
  apiKeyInputs: Record<string, string>;
  showApiKeys: Record<string, boolean>;
  isSavingKey: Record<string, boolean>;
  onApiKeyInputChange: (value: string) => void;
  onToggleShowKey: () => void;
  onSaveKey: () => Promise<void>;
  onRemoveKey: () => Promise<void>;
  // OpenAI-compatible fields
  modelInput: string;
  onModelInputChange: (value: string) => void;
  onModelKeyDown: (e: React.KeyboardEvent) => void;
  onModelSave: () => Promise<void>;
  isSavingModel: boolean;
  modelSaved: boolean;
  baseUrlInput: string;
  onBaseUrlInputChange: (value: string) => void;
  onBaseUrlBlur: () => void;
  isSavingBaseUrl: boolean;
}

function ProviderApiConfig({
  provider,
  providerName,
  apiKeyInputs,
  showApiKeys,
  isSavingKey,
  onApiKeyInputChange,
  onToggleShowKey,
  onSaveKey,
  onRemoveKey,
  modelInput,
  onModelInputChange,
  onModelKeyDown,
  onModelSave,
  isSavingModel,
  modelSaved,
  baseUrlInput,
  onBaseUrlInputChange,
  onBaseUrlBlur,
  isSavingBaseUrl,
}: ProviderApiConfigProps) {
  return (
    <div className="space-y-4 pt-2">
      {/* API Key */}
      <div className="space-y-2">
        <Label className="text-xs font-medium text-muted-foreground">
          API Key
        </Label>
        <div className="relative">
          <Input
            type={showApiKeys[providerName] ? "text" : "password"}
            placeholder={
              provider.hasApiKey
                ? "Key saved — enter new to replace"
                : "sk-... or API key"
            }
            value={apiKeyInputs[providerName] ?? ""}
            onChange={(e) => onApiKeyInputChange(e.target.value)}
            className="h-8 pr-8 font-mono text-xs bg-background"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
          />
          <button
            type="button"
            onClick={onToggleShowKey}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors select-none"
          >
            {showApiKeys[providerName] ? (
              <UiIcon name="eye-off" className="size-3" />
            ) : (
              <UiIcon name="eye" className="size-3" />
            )}
          </button>
        </div>
        {provider.hasApiKey && (
          <div className="flex items-center gap-3">
            <p className="text-[11px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
              <UiIcon name="circle-check" className="size-3" />
              API key is set
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onRemoveKey}
              className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
            >
              Remove
            </Button>
          </div>
        )}
      </div>

      {/* Base URL for OpenAI-compatible */}
      {providerName === "openai-compatible" && (
        <div className="space-y-2">
          <Label className="text-xs font-medium text-muted-foreground">
            Base URL
          </Label>
          <Input
            type="url"
            placeholder="http://localhost:1234/v1"
            value={baseUrlInput}
            onChange={(e) => onBaseUrlInputChange(e.target.value)}
            onBlur={onBaseUrlBlur}
            className="h-8 font-mono text-xs bg-background"
          />
          <p className="text-[11px] text-muted-foreground">
            Ex: <code className="text-foreground/60">http://localhost:1234/v1</code>
          </p>
        </div>
      )}

      {/* OpenAI-compatible model ID */}
      {providerName === "openai-compatible" && (
        <div className="space-y-2">
          <Label className="text-xs font-medium text-muted-foreground">
            Model ID
          </Label>
          <div className="flex gap-1.5">
            <Input
              value={modelInput}
              onChange={(e) => onModelInputChange(e.target.value)}
              onKeyDown={onModelKeyDown}
              placeholder="anthropic/claude-sonnet-4.5"
              className="h-8 flex-1 font-mono text-xs bg-background"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck="false"
            />
            <Button
              type="button"
              size="sm"
              onClick={onModelSave}
              disabled={isSavingModel || !modelInput.trim() || modelSaved}
              className={`h-8 px-3 text-xs gap-1.5 shadow-sm shrink-0 transition-[background-color,color,box-shadow] duration-200 ease-out ${
                modelSaved
                  ? "bg-emerald-500 text-white hover:bg-emerald-500/90 hover:text-white"
                  : ""
              }`}
            >
              {isSavingModel ? (
                <UiIcon name="loader" className="size-3 animate-spin" />
              ) : modelSaved ? (
                <span
                  className="flex items-center gap-1"
                  style={{
                    animation:
                      "saveFeedbackPulse 200ms cubic-bezier(0.23, 1, 0.32, 1)",
                  }}
                >
                  <UiIcon name="check" className="size-3" />
                  Saved!
                </span>
              ) : (
                "Save"
              )}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Enter the exact model ID exposed by your provider.
          </p>
        </div>
      )}
    </div>
  );
}

function ProviderDialogActions({
  providerName,
  apiKeyInputs,
  isSavingKey,
  onClear,
  onDone,
}: {
  providerName: string | null;
  apiKeyInputs: Record<string, string>;
  isSavingKey: Record<string, boolean>;
  onClear: () => void;
  onDone: () => Promise<void>;
}) {
  const hasKeyInput = apiKeyInputs[providerName ?? ""]?.trim();
  const canSave = hasKeyInput && !isSavingKey[providerName ?? ""];

  return (
    <>
      {canSave && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClear}
          disabled={isSavingKey[providerName ?? ""]}
          className="h-8 px-3 text-xs"
        >
          Clear
        </Button>
      )}
      <Button
        type="button"
        size="sm"
        onClick={onDone}
        disabled={isSavingKey[providerName ?? ""]}
        className="h-8 px-5 text-xs gap-1.5 shadow-sm"
      >
        {isSavingKey[providerName ?? ""] ? (
          <>
            <UiIcon name="loader" className="size-3.5 animate-spin" />
            Saving...
          </>
        ) : (
          "Done"
        )}
      </Button>
    </>
  );
}
