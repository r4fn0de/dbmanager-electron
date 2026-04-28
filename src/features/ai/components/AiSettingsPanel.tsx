/**
 * AiSettingsPanel — settings page for configuring the AI assistant.
 *
 * Lets users pick a provider (OpenAI, Anthropic, Google), enter an API key,
 * and select a model. Uses the ai-actions module for IPC calls.
 */
import { PROVIDER_ICONS } from "@/components/ProviderIcons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Icon as UiIcon } from "@/components/ui/Icon";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getAiSettings,
  setAiApiKey,
  updateAiSettings,
  type AiProvidersInfo,
} from "../hooks/ai-actions";
import { cn } from "@/lib/utils";
import openAiDarkSvg from "../../../../icons/OpenAI_dark.svg";
import openAiLightSvg from "../../../../icons/OpenAI_light.svg";

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

// Provider icons are imported from @/components/ProviderIcons

type ProviderName = "openai" | "anthropic" | "google" | "openai-compatible";

interface AiSettingsPanelProps {
  compact?: boolean;
}

function OpenAiThemeIcon({ className }: { className?: string }) {
  return (
    <>
      <img src={openAiLightSvg} alt="OpenAI" className={cn(className, "dark:hidden")} />
      <img src={openAiDarkSvg} alt="OpenAI" className={cn("hidden", className, "dark:block")} />
    </>
  );
}

export function AiSettingsPanel({ compact }: AiSettingsPanelProps) {
  const [settings, setSettings] = useState<AiProvidersInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingProvider, setIsSavingProvider] = useState(false);
  const [isSavingModel, setIsSavingModel] = useState(false);
  const [isSavingBaseUrl, setIsSavingBaseUrl] = useState(false);
  const [openConfigProvider, setOpenConfigProvider] = useState<string | null>(
    null
  );

  // API key state per provider
  const [apiKeyInputs, setApiKeyInputs] = useState<Record<string, string>>({});
  const [showApiKeys, setShowApiKeys] = useState<Record<string, boolean>>({});
  const [isSavingKey, setIsSavingKey] = useState<Record<string, boolean>>({});
  const [modelInput, setModelInput] = useState("");
  const [baseUrlInput, setBaseUrlInput] = useState("");
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [isFetchingModels, setIsFetchingModels] = useState(false);

  const loadSettings = useCallback(async () => {
    try {
      const s = await getAiSettings();
      setSettings(s);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to load AI settings"
      );
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
      (settings?.providers.some((p) => p.hasApiKey) ?? false) ||
      (settings?.current.provider === "openai-compatible" &&
        (settings.current.openaiCompatibleBaseURL?.trim().length ?? 0) > 0),
    [settings]
  );


  // ------- Handlers -------

  const handleProviderChange = useCallback(
    async (providerName: string) => {
      if (!settings) return;
      const newProvider = settings.providers.find(
        (p) => p.name === providerName
      );
      if (!newProvider) return;
      setIsSavingProvider(true);
      try {
        await updateAiSettings({
          provider: providerName as
            | "openai"
            | "anthropic"
            | "google"
            | "openai-compatible",
          model: newProvider.defaultModel,
        });
        await loadSettings();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to update provider"
        );
      } finally {
        setIsSavingProvider(false);
      }
    },
    [settings, loadSettings]
  );

  const handleModelChange = useCallback(
    async (value: string | null) => {
      if (!settings || !value) return;
      setIsSavingModel(true);
      try {
        await updateAiSettings({ model: value });
        await loadSettings();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to update model"
        );
      } finally {
        setIsSavingModel(false);
      }
    },
    [settings, loadSettings]
  );

  const handleSaveApiKey = useCallback(
    async (provider: string) => {
      const key = apiKeyInputs[provider]?.trim();
      if (!key) return;
      setIsSavingKey((prev) => ({ ...prev, [provider]: true }));
      try {
        await setAiApiKey(
          provider as "openai" | "anthropic" | "google" | "openai-compatible",
          key
        );
        setApiKeyInputs((prev) => ({ ...prev, [provider]: "" }));
        await loadSettings();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to save API key"
        );
      } finally {
        setIsSavingKey((prev) => ({ ...prev, [provider]: false }));
      }
    },
    [apiKeyInputs, loadSettings]
  );

  const handleSaveBaseUrl = useCallback(async () => {
    if (!baseUrlInput.trim()) return;
    setIsSavingBaseUrl(true);
    try {
      await updateAiSettings({ openaiCompatibleBaseURL: baseUrlInput.trim() });
      await loadSettings();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update Base URL"
      );
    } finally {
      setIsSavingBaseUrl(false);
    }
  }, [baseUrlInput, loadSettings]);

  const handleFetchModels = useCallback(async () => {
    const provider = settings?.providers.find(p => p.name === "openai-compatible");
    if (!provider?.hasApiKey || !baseUrlInput.trim()) {
      toast.error("API key and Base URL are required to fetch models");
      return;
    }
    setIsFetchingModels(true);
    try {
      const apiKey = apiKeyInputs["openai-compatible"] || "";
      const response = await fetch(`${baseUrlInput.replace(/\/$/, '')}/models`, {
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.statusText}`);
      }
      const data = await response.json();
      const models = data.data
        ?.filter((m: { id: string }) => m.id)
        .map((m: { id: string }) => m.id)
        .sort() || [];
      setAvailableModels(models);
      if (models.length === 0) {
        toast.error("No models found");
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to fetch models"
      );
    } finally {
      setIsFetchingModels(false);
    }
  }, [settings, baseUrlInput, apiKeyInputs]);

  // ------- Render -------

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <UiIcon name="loader" className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="text-center max-w-md">
          <UiIcon name="bot" className="size-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm font-medium">Could not load AI settings</p>
          <Button
            variant="outline"
            size="sm"
            onClick={loadSettings}
            className="mt-3 transition-transform duration-150 ease-out active:scale-[0.97]"
          >
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
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary/[0.12] ring-1 ring-primary/20">
            <UiIcon name="sparkles" className="size-5 text-primary" />
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
        <AnimatePresence mode="wait">
          <motion.div
            key={configured ? "ready" : "missing"}
            initial={{ opacity: 0, y: 2 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -2 }}
            transition={{ duration: 0.15, ease: EASE_OUT }}
            className={cn(
              "flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-xs transition-colors duration-200 ease-out",
              configured
                ? "border-emerald-500/15 bg-emerald-500/[0.04] text-emerald-700 dark:text-emerald-400"
                : "border-amber-500/15 bg-amber-500/[0.04] text-amber-700 dark:text-amber-400"
            )}
          >
            {configured ? (
              <>
                <UiIcon name="circle-check" className="size-4 shrink-0" />
                <span className="font-medium">
                  AI is configured and ready to use
                </span>
              </>
            ) : (
              <>
                <UiIcon name="x" className="size-4 shrink-0" />
                <span className="font-medium">
                  {settings.current.provider === "openai-compatible"
                    ? "Set the Base URL to enable OpenAI-compatible provider"
                    : "Add an API key to enable AI features"}
                </span>
              </>
            )}
          </motion.div>
        </AnimatePresence>
      )}

      {/* Provider selection */}
      <div className="space-y-3">
        <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
          Provider
        </Label>
        <div className="space-y-2">
          {settings.providers.map((provider) => {
            const isActive = settings.current.provider === provider.name;
            const Icon = PROVIDER_ICONS[provider.name];
            const isSavingThis = isSavingProvider && isActive;
            return (
              <div
                key={provider.name}
                className={cn(
                  "flex items-center gap-2 rounded-xl border transition-all duration-150 ease-out",
                  isActive
                    ? "border-primary/30 bg-primary/[0.08] ring-1 ring-primary/20 shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
                    : "border-border/70 bg-transparent hover:border-muted-foreground/30 hover:bg-muted/[0.02]"
                )}
              >
                <button
                  type="button"
                  disabled={isSavingProvider}
                  onClick={() => handleProviderChange(provider.name)}
                  className={cn(
                    "flex-1 flex items-center justify-between px-3.5 py-3 text-sm font-medium text-left active:scale-[0.97] transition-transform",
                    isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <div className="flex items-center gap-3">
                    {provider.name === "openai" ? (
                      <OpenAiThemeIcon className="size-5 shrink-0" />
                    ) : (
                      Icon && <Icon className="size-5 shrink-0" />
                    )}
                    <span>{provider.label}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {isSavingThis && (
                      <UiIcon name="loader" className="size-3.5 animate-spin" />
                    )}
                  </div>
                </button>
                {isActive && (
                  <button
                    type="button"
                    onClick={() => setOpenConfigProvider(provider.name)}
                    className="mr-2 flex items-center justify-center size-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-all duration-150 ease-out"
                    title="Provider settings"
                  >
                    <UiIcon name="settings" className="size-4" />
                  </button>
                )}
              </div>
            );
          })}

          {/* Missing config warning for active provider */}
          {(() => {
            const activeProvider = settings.providers.find(
              (p) => p.name === settings.current.provider
            );
            if (!activeProvider?.hasApiKey) {
              return (
                <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/6 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                  <UiIcon name="x" className="size-3.5 shrink-0" />
                  <span>
                    {settings.current.provider === "openai-compatible"
                      ? "Configure the Base URL and API key to use this provider"
                      : "Add an API key to enable this provider"}
                  </span>
                </div>
              );
            }
            return null;
          })()}

        {/* Provider Config Dialog */}
        <Dialog
          open={!!openConfigProvider}
          onOpenChange={(open) => !open && setOpenConfigProvider(null)}
        >
          <DialogContent className="t-resize sm:max-w-md">
            <DialogHeader className="text-center">
              <div className="mx-auto mb-3">
                {openConfigProvider && (() => {
                  const Icon = PROVIDER_ICONS[openConfigProvider];
                  return openConfigProvider === "openai" ? (
                    <div className="flex size-16 items-center justify-center rounded-2xl bg-muted ring-1 ring-border">
                      <OpenAiThemeIcon className="size-8" />
                    </div>
                  ) : Icon ? (
                    <div className="flex size-16 items-center justify-center rounded-2xl bg-muted ring-1 ring-border">
                      <Icon className="size-8" />
                    </div>
                  ) : null;
                })()}
              </div>
              <DialogTitle>
                {openConfigProvider && (() => {
                  const provider = settings.providers.find(p => p.name === openConfigProvider);
                  return provider?.label ?? openConfigProvider;
                })()}
              </DialogTitle>
              <DialogDescription>
                Configure API key, model and other settings for this provider.
              </DialogDescription>
            </DialogHeader>

            {openConfigProvider && (() => {
              const provider = settings.providers.find(p => p.name === openConfigProvider);
              if (!provider) return null;

              return (
                <div className="space-y-4 pt-2">
                  {/* API Key */}
                  <div className="space-y-2">
                    <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                      API Key
                    </Label>
                    <div className="relative">
                      <Input
                        type={showApiKeys[provider.name] ? "text" : "password"}
                        placeholder={
                          provider.hasApiKey
                            ? "Key saved — enter new to replace"
                            : "sk-... or API key"
                        }
                        value={apiKeyInputs[provider.name] ?? ""}
                        onChange={(e) =>
                          setApiKeyInputs((prev) => ({
                            ...prev,
                            [provider.name]: e.target.value,
                          }))
                        }
                        className="h-8 pr-8 font-mono text-xs bg-background"
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="off"
                        spellCheck="false"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setShowApiKeys((prev) => ({
                            ...prev,
                            [provider.name]: !prev[provider.name],
                          }))
                        }
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {showApiKeys[provider.name] ? (
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
                          size="xs"
                          onClick={async () => {
                            try {
                              await setAiApiKey(
                                provider.name as
                                  | "openai"
                                  | "anthropic"
                                  | "google"
                                  | "openai-compatible",
                                ""
                              );
                              await loadSettings();
                            } catch (err) {
                              toast.error(
                                err instanceof Error
                                  ? err.message
                                  : "Failed to remove API key"
                              );
                            }
                          }}
                          className="text-xs text-muted-foreground hover:text-destructive"
                        >
                          Remove
                        </Button>
                      </div>
                    )}
                  </div>

                  {/* Base URL for OpenAI-compatible */}
                  {provider.name === "openai-compatible" && (
                    <div className="space-y-2">
                      <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                        Base URL
                      </Label>
                      <Input
                        type="url"
                        placeholder="http://localhost:1234/v1"
                        value={baseUrlInput}
                        onChange={(e) => setBaseUrlInput(e.target.value)}
                        onBlur={() => {
                          if (baseUrlInput.trim()) {
                            handleSaveBaseUrl();
                          }
                        }}
                        className="h-8 font-mono text-xs bg-background"
                      />
                      <p className="text-[11px] text-muted-foreground">
                        Ex:{" "}
                        <code className="text-foreground/60">
                          http://localhost:1234/v1
                        </code>
                      </p>
                    </div>
                  )}

                  {/* Model selection */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                        Model
                      </Label>
                      {provider.name === "openai-compatible" && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          onClick={handleFetchModels}
                          disabled={isFetchingModels || !provider.hasApiKey || !baseUrlInput.trim()}
                          className="h-6 text-[10px] text-muted-foreground hover:text-primary"
                        >
                          {isFetchingModels ? (
                            <UiIcon name="loader" className="size-3 animate-spin mr-1" />
                          ) : (
                            "Fetch models"
                          )}
                        </Button>
                      )}
                    </div>
                    {provider.name === "openai-compatible" && availableModels.length > 0 ? (
                      <Select
                        value={modelInput}
                        onValueChange={(value) => {
                          if (value) {
                            setModelInput(value);
                            handleModelChange(value);
                          }
                        }}
                        disabled={isSavingModel}
                      >
                        <SelectTrigger className="h-8 text-xs bg-background">
                          <SelectValue placeholder="Select a model" />
                        </SelectTrigger>
                        <SelectContent>
                          {availableModels.map((modelId) => (
                            <SelectItem key={modelId} value={modelId}>
                              {modelId}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : provider.name === "openai-compatible" ? (
                      <Input
                        value={modelInput}
                        onChange={(e) => setModelInput(e.target.value)}
                        onBlur={() => {
                          if (modelInput.trim()) {
                            handleModelChange(modelInput.trim());
                          }
                        }}
                        placeholder="Model id (ex: gpt-4o-mini, llama3.1:8b)"
                        className="h-8 font-mono text-xs bg-background"
                      />
                    ) : (
                      <Select
                        value={settings.current.model}
                        onValueChange={handleModelChange}
                        disabled={isSavingModel || !provider.hasApiKey}
                      >
                        <SelectTrigger className="h-8 text-xs bg-background">
                          <SelectValue placeholder="Select a model" />
                        </SelectTrigger>
                        <SelectContent>
                          {provider.models.map((model) => (
                            <SelectItem key={model.id} value={model.id}>
                              {model.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                </div>
              );
            })()}
            <DialogFooter className="pt-4 gap-2">
              {openConfigProvider && (() => {
                const provider = settings.providers.find(p => p.name === openConfigProvider);
                const hasKeyInput = apiKeyInputs[openConfigProvider]?.trim();
                const canSave = hasKeyInput && !isSavingKey[openConfigProvider];
                return (
                  <>
                    {canSave && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setApiKeyInputs(prev => ({ ...prev, [openConfigProvider]: "" }))}
                        disabled={isSavingKey[openConfigProvider]}
                        className="transition-transform duration-150 ease-out active:scale-[0.97]"
                      >
                        Clear
                      </Button>
                    )}
                    <Button
                      type="button"
                      onClick={async () => {
                        if (hasKeyInput) {
                          await handleSaveApiKey(openConfigProvider);
                        }
                        setOpenConfigProvider(null);
                      }}
                      disabled={isSavingKey[openConfigProvider]}
                      className="transition-transform duration-150 ease-out active:scale-[0.97]"
                    >
                      {isSavingKey[openConfigProvider] ? (
                        <>
                          <UiIcon name="loader" className="size-3 animate-spin mr-1.5" />
                          Saving...
                        </>
                      ) : (
                        "Done"
                      )}
                    </Button>
                  </>
                );
              })()}
            </DialogFooter>
          </DialogContent>
        </Dialog>
        </div>
      </div>

    </>
  );

  if (compact) {
    return (
      <div className="space-y-6 max-w-xl">
        {innerContent}
      </div>
    );
  }
  return (
    <ScrollArea className="h-full">
      <div className="mx-auto max-w-xl px-6 py-8 space-y-8">
        {innerContent}
      </div>
    </ScrollArea>
  );
}
