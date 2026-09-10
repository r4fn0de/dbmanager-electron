import { PROVIDER_ICONS } from "@/components/ProviderIcons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon as UiIcon } from "@/components/ui/Icon";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  getAiSettings,
  setAiApiKey,
  updateAiSettings,
  detectOllama,
  getPrivacySettings,
  updatePrivacySettings,
  fetchProviderModels,
  addCustomProvider,
  updateCustomProvider,
  removeCustomProvider,
  setCustomProviderApiKey,
  addCustomModel,
  removeCustomModel,
  checkProviderEndpoint,
  type AiCustomProviderInfo,
  type AiProvidersInfo,
  type AiProviderName,
} from "../hooks/ai-actions";
import { cn } from "@/lib/utils";
import type { PrivacySettings, PrivacyPreset, AiModelEntry } from "@/shared/ai/streaming-contracts";
import { PRIVACY_PRESETS } from "@/shared/ai/streaming-contracts";
import { PrivacySettingsSection } from "./PrivacySettingsSection";

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

interface AiSettingsPanelProps {
  compact?: boolean;
}

export function AiSettingsPanel({ compact }: AiSettingsPanelProps) {
  const [settings, setSettings] = useState<AiProvidersInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingProvider, setIsSavingProvider] = useState(false);
  const [savingModelsFor, setSavingModelsFor] = useState<string | null>(null);

  const [ollamaStatus, setOllamaStatus] = useState<{
    detected: boolean;
    models: string[];
    checking: boolean;
  }>({ detected: false, models: [], checking: true });

  const [providerModels, setProviderModels] = useState<Record<AiProviderName, AiModelEntry[]>>({
    openai: [],
    anthropic: [],
    google: [],
    "openai-compatible": [],
    ollama: [],
  });

  const [customStatuses, setCustomStatuses] = useState<
    Record<string, { checking: boolean; reachable: boolean | null; models: number }>
  >({});
  const [customDiscovered, setCustomDiscovered] = useState<Record<string, AiModelEntry[]>>({});
  const [customDialogOpen, setCustomDialogOpen] = useState(false);

  const [privacySettings, setPrivacySettings] = useState<PrivacySettings>(
    PRIVACY_PRESETS.full,
  );
  const [privacyPreset, setPrivacyPreset] = useState<PrivacyPreset | null>("full");

  const loadSettings = useCallback(async () => {
    try {
      const s = await getAiSettings();
      setSettings(s);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to load AI settings",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadModels = useCallback(async () => {
    if (!settings) return;
    const entries: Record<AiProviderName, AiModelEntry[]> = {
      openai: [],
      anthropic: [],
      google: [],
      "openai-compatible": [],
      ollama: [],
    };
    for (const provider of settings.providers) {
      try {
        const apiKey = settings.providers.find((p) => p.name === provider.name)?.hasApiKey;
        const baseURL =
          provider.name === "openai-compatible" ? settings.current.openaiCompatibleBaseURL :
          provider.name === "ollama" ? settings.current.ollamaBaseURL :
          undefined;
        const models = await fetchProviderModels(
          provider.name,
          apiKey ? undefined : undefined, // API key not sent from renderer for security
          baseURL ? `${baseURL}${baseURL.endsWith("/v1") ? "" : "/v1"}` : undefined,
        );
        entries[provider.name] = models;
      } catch {
        entries[provider.name] = [];
      }
    }
    setProviderModels(entries);
  }, [settings]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  useEffect(() => {
    let mounted = true;
    detectOllama().then((result) => {
      if (mounted) setOllamaStatus({ ...result, checking: false });
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    getPrivacySettings().then(({ settings: s, preset }) => {
      setPrivacySettings(s);
      setPrivacyPreset(preset);
    });
  }, []);

  // Merge dynamic + custom models for a provider
  const getMergedModels = useCallback(
    (providerName: AiProviderName): AiModelEntry[] => {
      if (!settings) return [];
      const provider = settings.providers.find((p) => p.name === providerName);
      if (!provider) return [];
      const dynamic = providerModels[providerName] ?? [];
      const custom = provider.customModels ?? [];
      // Deduplicate by id, custom models at the end
      const seen = new Set<string>();
      const result: AiModelEntry[] = [];
      for (const m of [...dynamic, ...custom]) {
        if (!seen.has(m.id)) {
          seen.add(m.id);
          result.push(m);
        }
      }
      return result;
    },
    [settings, providerModels],
  );

  const configured = useMemo(
    () =>
      (settings?.current.provider === "ollama" && ollamaStatus.detected) ||
      (settings?.providers.some((p) => p.hasApiKey) ?? false) ||
      (settings?.current.provider === "openai-compatible" &&
        (settings.current.openaiCompatibleBaseURL?.trim().length ?? 0) > 0) ||
      (settings?.customProviders.some(
        (p) => p.id === settings.current.provider && p.baseURL.trim().length > 0,
      ) ??
        false),
    [settings, ollamaStatus.detected],
  );

  const currentProviderLabel = useMemo(
    () =>
      settings?.providers.find((p) => p.name === settings.current.provider)?.label ??
      settings?.customProviders.find((p) => p.id === settings.current.provider)?.label,
    [settings],
  );

  const handleProviderChange = useCallback(
    async (providerName: AiProviderName) => {
      if (!settings) return;
      const newProvider = settings.providers.find((p) => p.name === providerName);
      if (!newProvider) return;
      setIsSavingProvider(true);
      try {
        await updateAiSettings({
          provider: providerName,
          model: newProvider.defaultModel,
        });
        await loadSettings();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to update provider",
        );
      } finally {
        setIsSavingProvider(false);
      }
    },
    [settings, loadSettings],
  );

  const handleModelChange = useCallback(
    async (model: string) => {
      if (!settings) return;
      await updateAiSettings({ model });
      await loadSettings();
    },
    [settings, loadSettings],
  );

  const handleSaveApiKey = useCallback(
    async (provider: AiProviderName, key: string) => {
      await setAiApiKey(provider, key);
      await loadSettings();
    },
    [loadSettings],
  );

  const handleRemoveApiKey = useCallback(
    async (provider: AiProviderName) => {
      await setAiApiKey(provider, "");
      await loadSettings();
    },
    [loadSettings],
  );

  const handleSaveBaseUrl = useCallback(
    async (url: string) => {
      await updateAiSettings({ openaiCompatibleBaseURL: url });
      await loadSettings();
    },
    [loadSettings],
  );

  const handleSaveOllamaBaseUrl = useCallback(
    async (url: string) => {
      await updateAiSettings({ ollamaBaseURL: url });
      await loadSettings();
    },
    [loadSettings],
  );

  const handleRefreshModels = useCallback(async (providerName: AiProviderName) => {
    setSavingModelsFor(providerName);
    try {
      const provider = settings?.providers.find((p) => p.name === providerName);
      if (!provider) return;
      const baseURL =
        providerName === "openai-compatible" ? settings?.current.openaiCompatibleBaseURL :
        providerName === "ollama" ? settings?.current.ollamaBaseURL :
        undefined;
      const models = await fetchProviderModels(
        providerName,
        undefined,
        baseURL ? `${baseURL}${baseURL.endsWith("/v1") ? "" : "/v1"}` : undefined,
      );
      setProviderModels((prev) => ({ ...prev, [providerName]: models }));
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to fetch models",
      );
    } finally {
      setSavingModelsFor(null);
    }
  }, [settings]);

  const handlePrivacyPreset = useCallback(
    async (preset: PrivacyPreset) => {
      try {
        const result = await updatePrivacySettings({ preset });
        setPrivacySettings(result);
        setPrivacyPreset(preset);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to update privacy",
        );
      }
    },
    [],
  );

  const handlePrivacyToggle = useCallback(
    async (key: keyof PrivacySettings, value: boolean) => {
      try {
        const result = await updatePrivacySettings({
          settings: { [key]: value },
        });
        setPrivacySettings(result);
        setPrivacyPreset(null);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to update privacy",
        );
      }
    },
    [],
  );

  const handleRefreshOllama = useCallback(async () => {
    setOllamaStatus((prev) => ({ ...prev, checking: true }));
    const result = await detectOllama();
    setOllamaStatus({ ...result, checking: false });
    await loadSettings();
  }, [loadSettings]);

  const checkCustomStatus = useCallback(async (custom: AiCustomProviderInfo) => {
    setCustomStatuses((prev) => ({
      ...prev,
      [custom.id]: {
        checking: true,
        reachable: prev[custom.id]?.reachable ?? null,
        models: prev[custom.id]?.models ?? 0,
      },
    }));
    try {
      const status = await checkProviderEndpoint(custom.baseURL);
      setCustomStatuses((prev) => ({
        ...prev,
        [custom.id]: {
          checking: false,
          reachable: status.reachable,
          models: status.models.length,
        },
      }));
    } catch {
      setCustomStatuses((prev) => ({
        ...prev,
        [custom.id]: { checking: false, reachable: false, models: 0 },
      }));
    }
  }, []);

  // Auto-check local custom endpoints once per URL (they may start/stop).
  const checkedLocalRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!settings) return;
    for (const custom of settings.customProviders ?? []) {
      const key = `${custom.id}@${custom.baseURL}`;
      if (custom.isLocal && !checkedLocalRef.current.has(key)) {
        checkedLocalRef.current.add(key);
        void checkCustomStatus(custom);
      }
    }
  }, [settings, checkCustomStatus]);

  const handleCustomProviderChange = useCallback(
    async (custom: AiCustomProviderInfo, model?: string) => {
      if (!settings) return;
      if (!model && settings.current.provider === custom.id) return;
      setIsSavingProvider(true);
      try {
        await updateAiSettings({
          provider: custom.id,
          model: model ?? custom.defaultModel ?? settings.current.model,
        });
        await loadSettings();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to update provider",
        );
      } finally {
        setIsSavingProvider(false);
      }
    },
    [settings, loadSettings],
  );

  const handleSaveCustomProvider = useCallback(
    async (input: {
      id?: string;
      label: string;
      baseURL: string;
      apiKey?: string;
      defaultModel?: string;
    }) => {
      try {
        const next = input.id
          ? await updateCustomProvider(input.id, {
              label: input.label,
              baseURL: input.baseURL,
              defaultModel: input.defaultModel,
            })
          : await addCustomProvider({
              label: input.label,
              baseURL: input.baseURL,
              apiKey: input.apiKey,
              defaultModel: input.defaultModel,
            });
        if (input.id && input.apiKey !== undefined) {
          const updated = await setCustomProviderApiKey(input.id, input.apiKey);
          setSettings(updated);
        } else {
          setSettings(next);
        }
        setCustomDialogOpen(false);
        toast.success("Custom provider saved");
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to save custom provider",
        );
      }
    },
    [],
  );

  const handleRemoveCustomProvider = useCallback(async (id: string) => {
    try {
      const next = await removeCustomProvider(id);
      setSettings(next);
      toast.success("Custom provider removed");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to remove custom provider",
      );
    }
  }, []);

  const handleCustomKeySave = useCallback(async (id: string, key: string) => {
    try {
      const next = await setCustomProviderApiKey(id, key);
      setSettings(next);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to save API key",
      );
    }
  }, []);

  const handleDiscoverCustomModels = useCallback(
    async (custom: AiCustomProviderInfo) => {
      setSavingModelsFor(custom.id);
      try {
        const base = custom.baseURL.endsWith("/v1")
          ? custom.baseURL
          : `${custom.baseURL}/v1`;
        const models = await fetchProviderModels("openai-compatible", undefined, base);
        setCustomDiscovered((prev) => ({ ...prev, [custom.id]: models }));
        if (models.length === 0) toast.info("No models listed by this endpoint");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to fetch models");
      } finally {
        setSavingModelsFor(null);
      }
    },
    [],
  );

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

      {!compact && <AiSettingsStatus configured={configured} settings={settings} />}

      <div className="space-y-3">
        <Label className="text-xs font-medium text-muted-foreground">Provider</Label>
        <div className="space-y-2">
          {settings.providers.map((provider) => {
            const isActive = settings.current.provider === provider.name;
            const Icon = PROVIDER_ICONS[provider.name];
            const isSavingThis = isSavingProvider && isActive;
            return (
              <ProviderCard
                key={provider.name}
                provider={provider}
                isActive={isActive}
                icon={Icon}
                isSaving={isSavingThis}
                ollamaDetected={ollamaStatus.detected}
                ollamaModels={ollamaStatus.models}
                ollamaChecking={ollamaStatus.checking}
                providerModels={getMergedModels(provider.name)}
                isFetchingModels={savingModelsFor === provider.name}
                currentModel={settings.current.model}
                openaiCompatibleBaseURL={settings.current.openaiCompatibleBaseURL}
                ollamaBaseURL={settings.current.ollamaBaseURL ?? ""}
                onProviderChange={() => handleProviderChange(provider.name)}
                onModelChange={(model: string) => handleModelChange(model)}
                onSaveApiKey={(key: string) => handleSaveApiKey(provider.name, key)}
                onRemoveApiKey={() => handleRemoveApiKey(provider.name)}
                onSaveBaseUrl={(url: string) => handleSaveBaseUrl(url)}
                onSaveOllamaBaseUrl={(url: string) => handleSaveOllamaBaseUrl(url)}
                onRefreshOllama={handleRefreshOllama}
                onRefreshModels={() => handleRefreshModels(provider.name)}
              />
            );
          })}

          <MissingConfigWarning
            settings={settings}
            ollamaDetected={ollamaStatus.detected}
          />
        </div>
      </div>

      <div className="space-y-3">
        <Label className="text-xs font-medium text-muted-foreground">
          Custom providers
        </Label>
        <CustomProvidersPanel
          customs={settings.customProviders ?? []}
          currentProvider={settings.current.provider}
          currentModel={settings.current.model}
          isSavingProvider={isSavingProvider}
          statuses={customStatuses}
          discovered={customDiscovered}
          fetchingModelsFor={savingModelsFor}
          onSelect={(custom) => handleCustomProviderChange(custom)}
          onUseModel={(custom, modelId) => handleCustomProviderChange(custom, modelId)}
          onModelChange={(model: string) => handleModelChange(model)}
          onSaveKey={(id: string, key: string) => handleCustomKeySave(id, key)}
          onDiscover={(custom) => handleDiscoverCustomModels(custom)}
          onRefreshStatus={(custom) => checkCustomStatus(custom)}
          onUpdate={async (id, patch) => {
            try {
              setSettings(await updateCustomProvider(id, patch));
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Failed to update provider");
            }
          }}
          onAddModel={async (id, modelId) => {
            try {
              setSettings(await addCustomModel(id, modelId));
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Failed to add model");
            }
          }}
          onRemoveModel={async (id, modelId) => {
            try {
              setSettings(await removeCustomModel(id, modelId));
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Failed to remove model");
            }
          }}
          onDelete={(id) => handleRemoveCustomProvider(id)}
          onAddNew={() => setCustomDialogOpen(true)}
        />
      </div>

      <CustomProviderDialog
        open={customDialogOpen}
        onOpenChange={setCustomDialogOpen}
        onSave={handleSaveCustomProvider}
      />

      <PrivacySettingsSection
        privacyPreset={privacyPreset}
        privacySettings={privacySettings}
        currentProvider={settings.current.provider}
        providerLabel={currentProviderLabel}
        onPresetChange={handlePrivacyPreset}
        onToggle={handlePrivacyToggle}
      />
    </>
  );

  return (
    <>
      {compact ? (
        <div className="space-y-6 max-w-xl">{innerContent}</div>
      ) : (
        <ScrollArea className="h-full">
          <div className="mx-auto max-w-xl px-6 py-8 space-y-8">{innerContent}</div>
        </ScrollArea>
      )}
    </>
  );
}

function AiSettingsStatus({
  configured,
  settings,
}: {
  configured: boolean;
  settings: AiProvidersInfo;
}) {
  return (
    <AnimatePresence mode="wait">
      {configured ? (
        <motion.div
          key="configured"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4 }}
          transition={{ duration: 0.15, ease: EASE_OUT }}
          className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400"
        >
          <UiIcon name="circle-check" className="size-3" />
          AI is configured
        </motion.div>
      ) : (
        <motion.div
          key="unconfigured"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4 }}
          transition={{ duration: 0.15, ease: EASE_OUT }}
          className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400"
        >
          <UiIcon name="alert-circle" className="size-3" />
          AI not configured — click a provider below to set up
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function MissingConfigWarning({
  settings,
  ollamaDetected,
}: {
  settings: AiProvidersInfo;
  ollamaDetected: boolean;
}) {
  const currentProvider = settings.providers.find(
    (p) => p.name === settings.current.provider,
  );
  if (!currentProvider?.requiresApiKey || currentProvider.hasApiKey) return null;
  if (currentProvider.name === "openai-compatible" && settings.current.openaiCompatibleBaseURL.trim()) return null;
  if (currentProvider.name === "ollama" && ollamaDetected) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15, ease: EASE_OUT, delay: 0.05 }}
      className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-lg p-2.5 mt-2"
    >
      <UiIcon name="alert-circle" className="size-3 shrink-0 mt-0.5" />
      <span>
        This provider requires configuration. Click the provider card to enter your API key.
      </span>
    </motion.div>
  );
}

interface ProviderCardProps {
  provider: NonNullable<AiProvidersInfo["providers"][number]>;
  isActive: boolean;
  icon: React.ElementType | undefined;
  isSaving: boolean;
  ollamaDetected: boolean;
  ollamaModels: string[];
  ollamaChecking: boolean;
  providerModels: AiModelEntry[];
  isFetchingModels: boolean;
  currentModel: string;
  openaiCompatibleBaseURL: string;
  ollamaBaseURL: string;
  onProviderChange: () => void;
  onModelChange: (model: string) => void;
  onSaveApiKey: (key: string) => void;
  onRemoveApiKey: () => void;
  onSaveBaseUrl: (url: string) => void;
  onSaveOllamaBaseUrl: (url: string) => void;
  onRefreshOllama: () => Promise<void>;
  onRefreshModels: () => void;
}

function ProviderCard({
  provider,
  isActive,
  icon: Icon,
  isSaving,
  ollamaDetected,
  ollamaModels,
  ollamaChecking,
  providerModels,
  isFetchingModels,
  currentModel,
  openaiCompatibleBaseURL,
  ollamaBaseURL,
  onProviderChange,
  onModelChange,
  onSaveApiKey,
  onRemoveApiKey,
  onSaveBaseUrl,
  onSaveOllamaBaseUrl,
  onRefreshOllama,
  onRefreshModels,
}: ProviderCardProps) {
  // Per-card local state
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [isSavingKey, setIsSavingKey] = useState(false);
  const [baseUrlInput, setBaseUrlInput] = useState("");
  const [isSavingBaseUrl, setIsSavingBaseUrl] = useState(false);
  const [modelSaved, setModelSaved] = useState(false);
  const [isSavingModel, setIsSavingModel] = useState(false);

  // Sync inputs from global state when this card becomes active
  useEffect(() => {
    if (isActive) {
      setBaseUrlInput(openaiCompatibleBaseURL);
    }
  }, [isActive, openaiCompatibleBaseURL]);

  const handleSaveKey = async () => {
    if (!apiKeyInput.trim()) return;
    setIsSavingKey(true);
    try {
      await onSaveApiKey(apiKeyInput.trim());
      setApiKeyInput("");
      setShowApiKey(false);
    } finally {
      setIsSavingKey(false);
    }
  };

  const handleModelSave = async () => {
    if (!currentModel.trim()) return;
    setIsSavingModel(true);
    try {
      await onModelChange(currentModel.trim());
      setModelSaved(true);
      setTimeout(() => setModelSaved(false), 2000);
    } finally {
      setIsSavingModel(false);
    }
  };

  const handleBaseUrlSave = async () => {
    if (!baseUrlInput.trim()) return;
    setIsSavingBaseUrl(true);
    try {
      await onSaveBaseUrl(baseUrlInput.trim());
    } finally {
      setIsSavingBaseUrl(false);
    }
  };

  const handleOllamaBaseBlur = async () => {
    if (ollamaBaseURL.trim()) {
      await onSaveOllamaBaseUrl(ollamaBaseURL.trim());
    }
  };

  return (
    <div
      className={cn(
        "rounded-xl border transition-colors duration-150 ease-out overflow-hidden",
        isActive
          ? "border-primary/30 bg-primary/[0.08] ring-1 ring-primary/20"
          : "border-border/70 bg-transparent hover:border-muted-foreground/30 hover:bg-muted/[0.02]",
      )}
    >
      {/* Provider header — always visible for selection */}
      <button
        type="button"
        disabled={isSaving}
        onClick={onProviderChange}
        className={cn(
          "w-full flex items-center justify-between px-3.5 py-3 text-sm font-medium text-left active:scale-[0.97] select-none",
          isActive
            ? "text-primary"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        <div className="flex items-center gap-3">
          {Icon && <Icon className="size-5 shrink-0" />}
          <span>{provider.label}</span>
        </div>
        <div className="flex items-center gap-2">
          {isSaving && (
            <UiIcon name="loader" className="size-3.5 animate-spin" />
          )}
          {!isActive && provider.hasApiKey && (
            <UiIcon name="circle-check" className="size-3 text-emerald-400" />
          )}
        </div>
      </button>

      {/* Expanded config — only shown when active */}
      {isActive && (
        <div className="px-4 py-3 space-y-4 border-t border-border/50">
          {/* API Key */}
          <div className="space-y-2">
            <Label className="text-xs font-medium text-muted-foreground">
              API Key
            </Label>
            <div className="relative">
              <Input
                type={showApiKey ? "text" : "password"}
                placeholder={
                  provider.hasApiKey
                    ? "Key saved — enter new to replace"
                    : provider.apiKeyFormat?.placeholder ?? "Enter API key"
                }
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                className="h-8 pr-8 font-mono text-xs bg-background"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck="false"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors select-none"
              >
                {showApiKey ? (
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
                  onClick={onRemoveApiKey}
                  className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                >
                  Remove
                </Button>
              </div>
            )}
          </div>

          {/* Base URL for OpenAI-compatible */}
          {provider.name === "openai-compatible" && (
            <div className="space-y-2">
              <Label className="text-xs font-medium text-muted-foreground">
                Base URL
              </Label>
              <Input
                type="url"
                placeholder="http://localhost:1234/v1"
                value={baseUrlInput}
                onChange={(e) => setBaseUrlInput(e.target.value)}
                onBlur={handleBaseUrlSave}
                className="h-8 font-mono text-xs bg-background"
              />
              <p className="text-[11px] text-muted-foreground">
                Ex: <code className="text-foreground/60">http://localhost:1234/v1</code>
              </p>
            </div>
          )}

          {/* Base URL for Ollama (configurable) */}
          {provider.name === "ollama" && (
            <div className="space-y-2">
              <Label className="text-xs font-medium text-muted-foreground">
                Ollama Base URL (leave empty for localhost)
              </Label>
              <Input
                type="url"
                placeholder="http://localhost:11434"
                value={ollamaBaseURL}
                onChange={(e) => onSaveOllamaBaseUrl(e.target.value)}
                onBlur={handleOllamaBaseBlur}
                className="h-8 font-mono text-xs bg-background"
              />
            </div>
          )}

          {/* Ollama detection status */}
          {provider.name === "ollama" && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs">
                {ollamaDetected ? (
                  <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                    <UiIcon name="circle-check" className="size-3" />
                    Ollama detected ({ollamaModels.length} models)
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
                  onClick={onRefreshOllama}
                  disabled={ollamaChecking}
                  className="h-6 px-2 text-xs ml-auto"
                >
                  {ollamaChecking ? (
                    <UiIcon name="loader" className="size-3 animate-spin" />
                  ) : (
                    <UiIcon name="refresh" className="size-3" />
                  )}
                  Refresh
                </Button>
              </div>

              {!ollamaDetected && (
                <p className="text-[11px] text-muted-foreground">
                  Install Ollama from <code className="text-foreground/60">ollama.com</code> and
                  run <code className="text-foreground/60">ollama serve</code> to get started.
                </p>
              )}
            </div>
          )}

          {/* Model selection */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium text-muted-foreground">
                Model
              </Label>
              {providerModels.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onRefreshModels}
                  disabled={isFetchingModels}
                  className="h-5 px-1.5 text-[10px]"
                >
                  {isFetchingModels ? (
                    <UiIcon name="loader" className="size-2.5 animate-spin" />
                  ) : (
                    <UiIcon name="refresh" className="size-2.5" />
                  )}
                  Refresh
                </Button>
              )}
            </div>

            {provider.name === "openai-compatible" || provider.name === "anthropic" || provider.name === "google" ? (
              <div className="flex gap-1.5">
                <Input
                  value={currentModel}
                  onChange={(e) => onModelChange(e.target.value)}
                  placeholder={provider.defaultModel || "Enter model ID"}
                  className="h-8 flex-1 font-mono text-xs bg-background"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck="false"
                />
                <Button
                  type="button"
                  size="sm"
                  onClick={handleModelSave}
                  disabled={isSavingModel || !currentModel.trim() || modelSaved}
                  className={`h-8 px-3 text-xs gap-1.5 shadow-sm shrink-0 transition-[background-color,color,box-shadow] duration-200 ease-out ${
                    modelSaved
                      ? "bg-emerald-500 text-white hover:bg-emerald-500/90 hover:text-white"
                      : ""
                  }}`}
                >
                  {isSavingModel ? (
                    <UiIcon name="loader" className="size-3 animate-spin" />
                  ) : modelSaved ? (
                    <span className="flex items-center gap-1">
                      <UiIcon name="check" className="size-3" />
                      Saved!
                    </span>
                  ) : (
                    "Save"
                  )}
                </Button>
              </div>
            ) : (
              <select
                value={currentModel}
                onChange={(e) => onModelChange(e.target.value)}
                className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs font-mono"
              >
                <option value="" disabled>
                  Select a model
                </option>
                {providerModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            )}

            {providerModels.length > 0 && provider.name !== "openai-compatible" && provider.name !== "anthropic" && provider.name !== "google" && (
              <p className="text-[11px] text-muted-foreground">
                {providerModels.length} models available from {provider.label}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

type CustomStatus = {
  checking: boolean;
  reachable: boolean | null;
  models: number;
};

interface CustomProvidersPanelProps {
  customs: AiCustomProviderInfo[];
  currentProvider: string;
  currentModel: string;
  isSavingProvider: boolean;
  statuses: Record<string, CustomStatus>;
  discovered: Record<string, AiModelEntry[]>;
  fetchingModelsFor: string | null;
  onSelect: (custom: AiCustomProviderInfo) => void;
  onUseModel: (custom: AiCustomProviderInfo, modelId: string) => void;
  onModelChange: (model: string) => void;
  onSaveKey: (id: string, key: string) => void;
  onDiscover: (custom: AiCustomProviderInfo) => void;
  onRefreshStatus: (custom: AiCustomProviderInfo) => void;
  onUpdate: (
    id: string,
    patch: { label?: string; baseURL?: string; defaultModel?: string },
  ) => void;
  onAddModel: (id: string, modelId: string) => void;
  onRemoveModel: (id: string, modelId: string) => void;
  onDelete: (id: string) => void;
  onAddNew: () => void;
}

function CustomStatusDot({ status }: { status: CustomStatus }) {
  if (status.checking) {
    return <UiIcon name="loader" className="size-3 animate-spin text-muted-foreground" />;
  }
  return (
    <span
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        status.reachable ? "bg-emerald-500" : "bg-muted-foreground/35",
      )}
    />
  );
}

function customStatusText(
  custom: AiCustomProviderInfo,
  status: CustomStatus,
): string {
  if (status.checking) return "Checking…";
  if (status.reachable === null) return custom.isLocal ? "Not checked" : "Remote endpoint";
  if (status.reachable) {
    return custom.isLocal
      ? `Running${status.models > 0 ? ` · ${status.models} models` : ""}`
      : "Reachable";
  }
  return custom.isLocal ? "Stopped" : "Unreachable";
}

function CustomProvidersPanel({
  customs,
  currentProvider,
  currentModel,
  isSavingProvider,
  statuses,
  discovered,
  fetchingModelsFor,
  onSelect,
  onUseModel,
  onModelChange,
  onSaveKey,
  onDiscover,
  onRefreshStatus,
  onUpdate,
  onAddModel,
  onRemoveModel,
  onDelete,
  onAddNew,
}: CustomProvidersPanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected =
    customs.find((c) => c.id === selectedId) ??
    customs.find((c) => c.id === currentProvider) ??
    customs[0] ??
    null;

  if (customs.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/60 px-3 py-3">
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Save your own OpenAI-compatible endpoints — LM Studio, vLLM,
          Ollama on another machine, OpenRouter. Local ones show whether
          they are running.
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onAddNew}
          className="mt-2 h-7 px-2 text-xs gap-1"
        >
          <UiIcon name="plus" className="size-3" />
          Add provider
        </Button>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border/70">
      <div className="flex min-h-[300px]">
        <div className="w-40 shrink-0 border-r border-border/50 p-2">
          <p className="px-2 pt-1 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60 select-none">
            Custom
          </p>
          <div className="space-y-0.5">
            {customs.map((custom) => (
              <button
                key={custom.id}
                type="button"
                onClick={() => setSelectedId(custom.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  selected?.id === custom.id
                    ? "bg-muted/70 font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                )}
              >
                <CustomStatusDot
                  status={statuses[custom.id] ?? { checking: false, reachable: null, models: 0 }}
                />
                <span className="min-w-0 flex-1 truncate">{custom.label}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onAddNew}
            className="mt-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-muted-foreground transition-colors outline-none hover:bg-muted/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <UiIcon name="plus" className="size-3" />
            Add provider
          </button>
        </div>
        <div className="min-w-0 flex-1 p-4">
          {selected && (
            <CustomProviderDetail
              key={selected.id}
              custom={selected}
              isActive={currentProvider === selected.id}
              isSaving={isSavingProvider}
              status={statuses[selected.id] ?? { checking: false, reachable: null, models: 0 }}
              discoveredModels={discovered[selected.id] ?? []}
              isFetchingModels={fetchingModelsFor === selected.id}
              currentModel={currentModel}
              onSelect={() => onSelect(selected)}
              onUseModel={(modelId) => onUseModel(selected, modelId)}
              onModelChange={onModelChange}
              onSaveKey={(key) => onSaveKey(selected.id, key)}
              onDiscover={() => onDiscover(selected)}
              onRefreshStatus={() => onRefreshStatus(selected)}
              onUpdate={(patch) => onUpdate(selected.id, patch)}
              onAddModel={(modelId) => onAddModel(selected.id, modelId)}
              onRemoveModel={(modelId) => onRemoveModel(selected.id, modelId)}
              onDelete={() => onDelete(selected.id)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function CustomProviderDetail({
  custom,
  isActive,
  isSaving,
  status,
  discoveredModels,
  isFetchingModels,
  currentModel,
  onSelect,
  onUseModel,
  onModelChange,
  onSaveKey,
  onDiscover,
  onRefreshStatus,
  onUpdate,
  onAddModel,
  onRemoveModel,
  onDelete,
}: {
  custom: AiCustomProviderInfo;
  isActive: boolean;
  isSaving: boolean;
  status: CustomStatus;
  discoveredModels: AiModelEntry[];
  isFetchingModels: boolean;
  currentModel: string;
  onSelect: () => void;
  onUseModel: (modelId: string) => void;
  onModelChange: (model: string) => void;
  onSaveKey: (key: string) => void;
  onDiscover: () => void;
  onRefreshStatus: () => void;
  onUpdate: (patch: { label?: string; baseURL?: string; defaultModel?: string }) => void;
  onAddModel: (modelId: string) => void;
  onRemoveModel: (modelId: string) => void;
  onDelete: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [nameInput, setNameInput] = useState(custom.label);
  const [baseURLInput, setBaseURLInput] = useState(custom.baseURL);
  const [keyInput, setKeyInput] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const [newModel, setNewModel] = useState("");
  const [manualModel, setManualModel] = useState(custom.defaultModel);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    if (!confirmingDelete) return;
    const timer = setTimeout(() => setConfirmingDelete(false), 3000);
    return () => clearTimeout(timer);
  }, [confirmingDelete]);

  const saveName = () => {
    setRenaming(false);
    if (nameInput.trim() && nameInput.trim() !== custom.label) {
      onUpdate({ label: nameInput.trim() });
    } else {
      setNameInput(custom.label);
    }
  };

  const saveBaseURL = () => {
    if (baseURLInput.trim() && baseURLInput.trim() !== custom.baseURL) {
      onUpdate({ baseURL: baseURLInput.trim() });
    } else {
      setBaseURLInput(custom.baseURL);
    }
  };

  const saveKey = async () => {
    if (!keyInput.trim()) return;
    setSavingKey(true);
    try {
      await onSaveKey(keyInput.trim());
      setKeyInput("");
      setShowKey(false);
    } finally {
      setSavingKey(false);
    }
  };

  const models = useMemo(() => {
    const seen = new Set<string>();
    const rows: Array<{ id: string; added: boolean }> = [];
    for (const m of [...(custom.customModels ?? []), ...discoveredModels]) {
      if (!seen.has(m.id)) {
        seen.add(m.id);
        rows.push({ id: m.id, added: !!m.isCustom });
      }
    }
    return rows;
  }, [custom.customModels, discoveredModels]);

  return (
    <div>
      <div className="flex items-center gap-1.5">
        {renaming ? (
          <Input
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveName();
              if (e.key === "Escape") {
                setNameInput(custom.label);
                setRenaming(false);
              }
            }}
            autoFocus
            className="h-7 flex-1 text-sm font-medium"
          />
        ) : (
          <h3 className="min-w-0 flex-1 truncate text-sm font-medium">{custom.label}</h3>
        )}
        {!renaming && (
          <button
            type="button"
            aria-label="Rename provider"
            onClick={() => {
              setNameInput(custom.label);
              setRenaming(true);
            }}
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground select-none"
          >
            <UiIcon name="pencil" className="size-3" />
          </button>
        )}
        {isActive ? (
          <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400 select-none">
            In use
          </span>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onSelect}
            disabled={isSaving}
            className="h-6 shrink-0 px-2 text-xs"
          >
            {isSaving ? (
              <UiIcon name="loader" className="size-3 animate-spin" />
            ) : null}
            Use
          </Button>
        )}
        <button
          type="button"
          aria-label="Delete provider"
          onClick={() => {
            if (confirmingDelete) onDelete();
            else setConfirmingDelete(true);
          }}
          title={confirmingDelete ? "Click again to confirm" : "Delete provider"}
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-md transition-colors select-none",
            confirmingDelete
              ? "bg-destructive/10 text-destructive"
              : "text-muted-foreground hover:bg-muted/60 hover:text-destructive",
          )}
        >
          <UiIcon name="trash" className="size-3" />
        </button>
      </div>

      <button
        type="button"
        onClick={onRefreshStatus}
        disabled={status.checking}
        className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60 select-none"
      >
        <CustomStatusDot status={status} />
        {customStatusText(custom, status)}
        {status.checking ? null : (
          <UiIcon name="refresh" className="size-2.5 opacity-60" />
        )}
      </button>

      <div className="mt-4 space-y-3.5">
        <div className="space-y-1.5">
          <Label className="text-xs font-medium text-muted-foreground">Base URL</Label>
          <Input
            value={baseURLInput}
            onChange={(e) => setBaseURLInput(e.target.value)}
            onBlur={saveBaseURL}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            placeholder="http://localhost:1234/v1"
            className="h-8 font-mono text-xs bg-background"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs font-medium text-muted-foreground">
            API key{" "}
            {custom.hasApiKey && (
              <span className="text-emerald-600 dark:text-emerald-400">· set</span>
            )}
          </Label>
          <div className="flex gap-1.5">
            <div className="relative flex-1">
              <Input
                type={showKey ? "text" : "password"}
                placeholder={custom.hasApiKey ? "Enter new to replace (optional)" : "Optional"}
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void saveKey();
                }}
                className="h-8 pr-8 font-mono text-xs bg-background"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck="false"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors select-none"
              >
                {showKey ? (
                  <UiIcon name="eye-off" className="size-3" />
                ) : (
                  <UiIcon name="eye" className="size-3" />
                )}
              </button>
            </div>
            <Button
              type="button"
              size="sm"
              onClick={() => void saveKey()}
              disabled={savingKey || !keyInput.trim()}
              className="h-8 shrink-0 px-3 text-xs"
            >
              {savingKey ? (
                <UiIcon name="loader" className="size-3 animate-spin" />
              ) : (
                "Save"
              )}
            </Button>
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-medium text-muted-foreground">Models</Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onDiscover}
              disabled={isFetchingModels}
              className="h-5 px-1.5 text-[10px] gap-1"
            >
              {isFetchingModels ? (
                <UiIcon name="loader" className="size-2.5 animate-spin" />
              ) : (
                <UiIcon name="refresh" className="size-2.5" />
              )}
              Discover
            </Button>
          </div>
          {models.length > 0 ? (
            <div className="overflow-hidden rounded-lg border border-border/60 divide-y divide-border/40">
              {models.map((m) => {
                const isCurrent = isActive && currentModel === m.id;
                return (
                  <div
                    key={m.id}
                    className={cn(
                      "group flex items-center gap-1 pl-2.5 pr-1.5 py-1",
                      !isCurrent && "hover:bg-muted/40",
                      isCurrent && "bg-muted/40",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        if (isCurrent) return;
                        onUseModel(m.id);
                      }}
                      title={isCurrent ? "Current model" : "Use this model"}
                      className="min-w-0 flex-1 truncate text-left font-mono text-xs py-0.5 select-none"
                    >
                      {m.id}
                    </button>
                    {isCurrent ? (
                      <UiIcon name="check" className="size-3 shrink-0 text-emerald-500" />
                    ) : m.added ? (
                      <button
                        type="button"
                        aria-label={`Remove ${m.id}`}
                        onClick={() => onRemoveModel(m.id)}
                        className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/60 opacity-0 transition-all hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100 select-none"
                      >
                        <UiIcon name="x" className="size-3" />
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              No models listed yet — discover from the endpoint or add one below.
            </p>
          )}
          <div className="flex gap-1.5">
            <Input
              value={newModel}
              onChange={(e) => setNewModel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newModel.trim()) {
                  onAddModel(newModel.trim());
                  setNewModel("");
                }
              }}
              placeholder="Add model ID…"
              className="h-7 flex-1 font-mono text-xs"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck="false"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!newModel.trim()}
              onClick={() => {
                onAddModel(newModel.trim());
                setNewModel("");
              }}
              className="h-7 shrink-0 px-2 text-xs gap-1"
            >
              <UiIcon name="plus" className="size-3" />
              Add
            </Button>
          </div>
          {!isActive ? (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">
                Manual model ID
              </Label>
              <Input
                value={manualModel}
                onChange={(e) => setManualModel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && manualModel.trim()) {
                    onUseModel(manualModel.trim());
                  }
                }}
                placeholder={custom.defaultModel || "Enter model ID"}
                className="h-8 font-mono text-xs bg-background"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck="false"
              />
            </div>
          ) : (
            models.length === 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">
                  Manual model ID
                </Label>
                <Input
                  value={currentModel}
                  onChange={(e) => onModelChange(e.target.value)}
                  placeholder={custom.defaultModel || "Enter model ID"}
                  className="h-8 font-mono text-xs bg-background"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck="false"
                />
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}


function CustomProviderDialog({
  open,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (input: {
    label: string;
    baseURL: string;
    apiKey?: string;
    defaultModel?: string;
  }) => void;
}) {
  const [label, setLabel] = useState("");
  const [baseURL, setBaseURL] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [defaultModel, setDefaultModel] = useState("");

  useEffect(() => {
    if (open) {
      setLabel("");
      setBaseURL("");
      setApiKey("");
      setDefaultModel("");
    }
  }, [open]);

  const canSave = label.trim().length > 0 && baseURL.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Add custom provider</DialogTitle>
          <DialogDescription>
            Any OpenAI-compatible endpoint — LM Studio, vLLM, Ollama elsewhere, OpenRouter.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Name</Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="My local LLM"
              className="h-8 text-xs"
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Base URL</Label>
            <Input
              value={baseURL}
              onChange={(e) => setBaseURL(e.target.value)}
              placeholder="http://localhost:1234/v1"
              className="h-8 font-mono text-xs"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck="false"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">
              API Key (optional)
            </Label>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              className="h-8 font-mono text-xs"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck="false"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">
              Default model (optional)
            </Label>
            <Input
              value={defaultModel}
              onChange={(e) => setDefaultModel(e.target.value)}
              placeholder="qwen2.5-coder:7b"
              className="h-8 font-mono text-xs"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck="false"
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!canSave}
            onClick={() =>
              onSave({
                label: label.trim(),
                baseURL: baseURL.trim(),
                apiKey: apiKey.trim() ? apiKey.trim() : undefined,
                defaultModel: defaultModel.trim(),
              })
            }
          >
            Add provider
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
