/**
 * AiSettingsPanel — settings page for configuring the AI assistant.
 *
 * Lets users pick a provider (OpenAI, Anthropic, Google), enter an API key,
 * and select a model. Uses the ai-actions module for IPC calls.
 */
import {
  Bot,
  Check,
  CheckCircle2,
  Globe,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Sparkles,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  getAiSettings,
  setAiApiKey,
  updateAiSettings,
  type AiProvidersInfo,
} from "@/hooks/ai-actions";
import { cn } from "@/utils/tailwind";

// ---------------------------------------------------------------------------
// Provider icons (inline SVGs matching the app's icon style)
// ---------------------------------------------------------------------------

function OpenAiIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <title>OpenAI</title>
      <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.505 4.505 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.5 4.5 0 0 1 2.34 7.87zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l5.843-3.369v2.337a.076.076 0 0 1-.033.061l-4.83 2.787a4.5 4.5 0 0 1-.676-8.11v5.678a.795.795 0 0 0 .397.616z" />
    </svg>
  );
}

function AnthropicIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <title>Anthropic</title>
      <path d="M17.295 2.607h-3.378L18.1 21.393h3.378zM8.705 2.607L2.522 21.393h3.44l1.557-4.557h5.967l1.557 4.557h3.44L12.294 2.607zm-.147 11.356 2.08-6.083 2.08 6.083z" />
    </svg>
  );
}

function GoogleAiIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <title>Google AI</title>
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
    </svg>
  );
}

function OpenAICompatibleIcon({ className }: { className?: string }) {
  return <Globe className={className} />;
}

const PROVIDER_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  openai: OpenAiIcon,
  anthropic: AnthropicIcon,
  google: GoogleAiIcon,
  "openai-compatible": OpenAICompatibleIcon,
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface AiSettingsPanelProps {
  compact?: boolean;
}

export function AiSettingsPanel({ compact }: AiSettingsPanelProps) {
  const [settings, setSettings] = useState<AiProvidersInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingProvider, setIsSavingProvider] = useState(false);
  const [isSavingModel, setIsSavingModel] = useState(false);
  const [isSavingBaseUrl, setIsSavingBaseUrl] = useState(false);

  // API key state per provider
  const [apiKeyInputs, setApiKeyInputs] = useState<Record<string, string>>({});
  const [showApiKeys, setShowApiKeys] = useState<Record<string, boolean>>({});
  const [isSavingKey, setIsSavingKey] = useState<Record<string, boolean>>({});
  const [modelInput, setModelInput] = useState("");
  const [baseUrlInput, setBaseUrlInput] = useState("");

  const loadSettings = useCallback(async () => {
    try {
      const s = await getAiSettings();
      setSettings(s);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load AI settings");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    setModelInput(settings?.current.model ?? "");
    setBaseUrlInput(settings?.current.openaiCompatibleBaseURL ?? "");
  }, [settings?.current.model, settings?.current.openaiCompatibleBaseURL]);

  const configured = useMemo(
    () =>
      (settings?.providers.some((p) => p.hasApiKey) ?? false)
      || (
        settings?.current.provider === "openai-compatible"
        && (settings.current.openaiCompatibleBaseURL?.trim().length ?? 0) > 0
      ),
    [settings],
  );

  const currentProvider = useMemo(
    () => settings?.providers.find((p) => p.name === settings.current.provider),
    [settings],
  );

  // ------- Handlers -------

  const handleProviderChange = useCallback(
    async (providerName: string) => {
      if (!settings) return;
      const newProvider = settings.providers.find((p) => p.name === providerName);
      if (!newProvider) return;
      setIsSavingProvider(true);
      try {
        // Switch provider AND reset model to the new provider's default
        await updateAiSettings({
          provider: providerName as "openai" | "anthropic" | "google" | "openai-compatible",
          model: newProvider.defaultModel,
        });
        await loadSettings();
        toast.success("Provider updated");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to update provider");
      } finally {
        setIsSavingProvider(false);
      }
    },
    [settings, loadSettings],
  );

  const handleModelChange = useCallback(
    async (value: string | null) => {
      if (!settings || !value) return;
      setIsSavingModel(true);
      try {
        await updateAiSettings({ model: value });
        await loadSettings();
        toast.success("Model updated");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to update model");
      } finally {
        setIsSavingModel(false);
      }
    },
    [settings, loadSettings],
  );

  const handleSaveApiKey = useCallback(
    async (provider: string) => {
      const key = apiKeyInputs[provider]?.trim();
      if (!key) return;
      setIsSavingKey((prev) => ({ ...prev, [provider]: true }));
      try {
        await setAiApiKey(provider as "openai" | "anthropic" | "google" | "openai-compatible", key);
        setApiKeyInputs((prev) => ({ ...prev, [provider]: "" }));
        await loadSettings();
        toast.success("API key saved");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to save API key");
      } finally {
        setIsSavingKey((prev) => ({ ...prev, [provider]: false }));
      }
    },
    [apiKeyInputs, loadSettings],
  );

  const handleSaveBaseUrl = useCallback(async () => {
    if (!baseUrlInput.trim()) return;
    setIsSavingBaseUrl(true);
    try {
      await updateAiSettings({ openaiCompatibleBaseURL: baseUrlInput.trim() });
      await loadSettings();
      toast.success("Base URL updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update Base URL");
    } finally {
      setIsSavingBaseUrl(false);
    }
  }, [baseUrlInput, loadSettings]);

  // ------- Render -------

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="text-center max-w-md">
          <Bot className="size-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm font-medium">Could not load AI settings</p>
          <Button variant="outline" size="sm" onClick={loadSettings} className="mt-3 transition-transform duration-150 ease-out active:scale-[0.97]">
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const innerContent = (
    <>
      {/* Header — only in full mode */}
      {!compact && (
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10">
            <Sparkles className="size-5 text-primary" />
          </div>
          <div>
            <h2 className="font-heading text-lg font-semibold tracking-tight">
              AI Assistant
            </h2>
            <p className="text-xs text-muted-foreground">
              Configure the AI provider and model for SQL assistance.
            </p>
          </div>
        </div>
      )}

      {/* Status indicator — only in full mode */}
      {!compact && (
        <div
          className={cn(
            "flex items-center gap-2.5 rounded-lg border px-3.5 py-2.5 text-xs transition-colors duration-200",
            configured
              ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400"
              : "border-amber-500/20 bg-amber-500/5 text-amber-700 dark:text-amber-400",
          )}
        >
          {configured ? (
            <>
              <CheckCircle2 className="size-4 shrink-0" />
              <span className="font-medium">AI is configured and ready to use</span>
            </>
          ) : (
            <>
              <X className="size-4 shrink-0" />
              <span className="font-medium">
                {settings.current.provider === "openai-compatible"
                  ? "Set the Base URL to enable OpenAI-compatible provider"
                  : "Add an API key to enable AI features"}
              </span>
            </>
          )}
        </div>
      )}

      {/* Provider selection */}
      <div className="space-y-3">
        <Label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          Provider
        </Label>
        <div className="flex flex-wrap gap-2">
          {settings.providers.map((provider) => {
            const isActive = settings.current.provider === provider.name;
            const Icon = PROVIDER_ICONS[provider.name];
            const isSavingThis = isSavingProvider && isActive;
            return (
              <button
                key={provider.name}
                type="button"
                disabled={isSavingProvider}
                onClick={() => handleProviderChange(provider.name)}
                className={cn(
                  "relative flex items-center gap-2 rounded-lg border px-3.5 py-2.5 text-sm font-medium transition-colors duration-150 ease-out active:scale-[0.97]",
                  isActive
                    ? "border-primary/30 bg-primary/5 text-primary ring-1 ring-primary/20"
                    : "border-border bg-transparent text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground",
                )}
              >
                {Icon && <Icon className="size-4 shrink-0" />}
                <span>{provider.label}</span>
                {provider.hasApiKey && (
                  <KeyRound className="size-3 text-emerald-500" />
                )}
                {isSavingThis && (
                  <Loader2 className="size-3 animate-spin ml-0.5" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <Separator />

      {/* API Key for current provider */}
      {currentProvider && (
        <div className="space-y-3">
          <Label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            API Key — {currentProvider.label}
          </Label>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Input
                type={showApiKeys[currentProvider.name] ? "text" : "password"}
                placeholder={currentProvider.hasApiKey ? "Key saved — enter new to replace" : "sk-... or API key"}
                value={apiKeyInputs[currentProvider.name] ?? ""}
                onChange={(e) =>
                  setApiKeyInputs((prev) => ({
                    ...prev,
                    [currentProvider.name]: e.target.value,
                  }))
                }
                className="h-8 pr-8 font-mono text-xs"
              />
              <button
                type="button"
                onClick={() =>
                  setShowApiKeys((prev) => ({
                    ...prev,
                    [currentProvider.name]: !prev[currentProvider.name],
                  }))
                }
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors duration-150 active:scale-[0.97]"
              >
                {showApiKeys[currentProvider.name] ? (
                  <EyeOff className="size-3" />
                ) : (
                  <Eye className="size-3" />
                )}
              </button>
            </div>
            <Button
              type="button"
              size="sm"
              disabled={
                !apiKeyInputs[currentProvider.name]?.trim() ||
                isSavingKey[currentProvider.name]
              }
              onClick={() => handleSaveApiKey(currentProvider.name)}
              className="h-8 gap-1.5 text-xs transition-transform duration-150 ease-out active:scale-[0.97]"
            >
              {isSavingKey[currentProvider.name] ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <KeyRound className="size-3" />
              )}
              Save
            </Button>
          </div>
          <div className="flex items-center gap-3">
            {currentProvider.hasApiKey && !apiKeyInputs[currentProvider.name]?.trim() && (
              <p className="text-[11px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                <CheckCircle2 className="size-3" />
                API key is set
              </p>
            )}
            {currentProvider.hasApiKey && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={async () => {
                  try {
                    await setAiApiKey(
                      currentProvider.name as "openai" | "anthropic" | "google" | "openai-compatible",
                      "",
                    );
                    await loadSettings();
                    toast.success("API key removed");
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Failed to remove API key");
                  }
                }}
                className="text-xs text-muted-foreground hover:text-destructive transition-transform duration-150 ease-out active:scale-[0.97]"
              >
                Remove
              </Button>
            )}
          </div>
        </div>
      )}

      {currentProvider?.name === "openai-compatible" && (
        <>
          <Separator />
          <div className="space-y-3">
            <Label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              OpenAI-Compatible Base URL
            </Label>
            <div className="flex items-center gap-2">
              <Input
                type="url"
                placeholder="http://localhost:1234/v1"
                value={baseUrlInput}
                onChange={(e) => setBaseUrlInput(e.target.value)}
                className="h-8 font-mono text-xs"
              />
              <Button
                type="button"
                size="sm"
                disabled={!baseUrlInput.trim() || isSavingBaseUrl}
                onClick={handleSaveBaseUrl}
                className="h-8 gap-1.5 text-xs transition-transform duration-150 ease-out active:scale-[0.97]"
              >
                {isSavingBaseUrl ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Check className="size-3" />
                )}
                Save
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Exemplo: `http://localhost:1234/v1`
            </p>
          </div>
        </>
      )}

      <Separator />

      {/* Model selection */}
      {currentProvider && (
        <div className="space-y-3">
          <Label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            Model
          </Label>
          {currentProvider.name === "openai-compatible" ? (
            <div className="flex items-center gap-2">
              <Input
                value={modelInput}
                onChange={(e) => setModelInput(e.target.value)}
                placeholder="Model id (ex: gpt-4o-mini, llama3.1:8b)"
                className="h-8 font-mono text-xs"
              />
              <Button
                type="button"
                size="sm"
                disabled={!modelInput.trim() || isSavingModel}
                onClick={() => handleModelChange(modelInput.trim())}
                className="h-8 gap-1.5 text-xs transition-transform duration-150 ease-out active:scale-[0.97]"
              >
                {isSavingModel ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Check className="size-3" />
                )}
                Save
              </Button>
            </div>
          ) : (
            <Select
              value={settings.current.model}
              onValueChange={handleModelChange}
              disabled={isSavingModel || !currentProvider.hasApiKey}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Select a model" />
              </SelectTrigger>
              <SelectContent>
                {currentProvider.models.map((model) => (
                  <SelectItem key={model.id} value={model.id}>
                    {model.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {!currentProvider.hasApiKey && currentProvider.name !== "openai-compatible" && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400">
              Add an API key above to enable model selection.
            </p>
          )}
          {isSavingModel && (
            <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
              <Loader2 className="size-3 animate-spin" />
              Saving…
            </p>
          )}
        </div>
      )}

      <Separator />

      {/* Other providers' API keys */}
      {settings.providers.filter((p) => p.name !== settings.current.provider).length > 0 && (
        <div className="space-y-3">
          <Label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            Other providers
          </Label>
          <div className="space-y-3">
            {settings.providers
              .filter((p) => p.name !== settings.current.provider)
              .map((provider) => {
                const Icon = PROVIDER_ICONS[provider.name];
                return (
                  <div
                    key={provider.name}
                    className="flex items-center gap-3 rounded-lg border border-border bg-muted/10 px-3.5 py-2.5"
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" />}
                      <span className="text-sm font-medium truncate">
                        {provider.label}
                      </span>
                      {provider.hasApiKey ? (
                        <span className="text-[11px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                          <KeyRound className="size-2.5" />
                          Key set
                        </span>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">
                          No key
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <div className="relative">
                        <Input
                          type={showApiKeys[provider.name] ? "text" : "password"}
                          placeholder="API key"
                          value={apiKeyInputs[provider.name] ?? ""}
                          onChange={(e) =>
                            setApiKeyInputs((prev) => ({
                              ...prev,
                              [provider.name]: e.target.value,
                            }))
                          }
                          className="h-7 w-36 pr-7 font-mono text-xs"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setShowApiKeys((prev) => ({
                              ...prev,
                              [provider.name]: !prev[provider.name],
                            }))
                          }
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors duration-150 active:scale-[0.97]"
                        >
                          {showApiKeys[provider.name] ? (
                            <EyeOff className="size-2.5" />
                          ) : (
                            <Eye className="size-2.5" />
                          )}
                        </button>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        disabled={
                          !apiKeyInputs[provider.name]?.trim() ||
                          isSavingKey[provider.name]
                        }
                        onClick={() => handleSaveApiKey(provider.name)}
                        className="transition-transform duration-150 ease-out active:scale-[0.97]"
                      >
                        {isSavingKey[provider.name] ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          "Save"
                        )}
                      </Button>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </>
  );

  if (compact) {
    return <div className="space-y-5">{innerContent}</div>;
  }
  return (
    <ScrollArea className="h-full">
      <div className="mx-auto max-w-xl px-6 py-8 space-y-8">
        {innerContent}
      </div>
    </ScrollArea>
  );
}
