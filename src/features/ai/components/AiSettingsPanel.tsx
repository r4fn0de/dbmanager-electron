import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { PROVIDER_ICONS } from "@/components/ProviderIcons";
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
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type {
  AiModelEntry,
  PrivacyPreset,
  PrivacySettings,
} from "@/shared/ai/streaming-contracts";
import { PRIVACY_PRESETS } from "@/shared/ai/streaming-contracts";
import {
  type AiCustomProviderInfo,
  type AiProviderName,
  type AiProvidersInfo,
  addCustomModel,
  addCustomProvider,
  checkProviderEndpoint,
  detectOllama,
  fetchProviderModels,
  getAiSettings,
  getPrivacySettings,
  removeCustomModel,
  removeCustomProvider,
  renameCustomModel,
  setAiApiKey,
  setCustomProviderApiKey,
  updateAiSettings,
  updateCustomProvider,
  updatePrivacySettings,
} from "../hooks/ai-actions";
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
  }>({ checking: true, detected: false, models: [] });

  const [providerModels, setProviderModels] = useState<
    Record<AiProviderName, AiModelEntry[]>
  >({
    anthropic: [],
    google: [],
    ollama: [],
    openai: [],
    "openai-compatible": [],
  });

  const [customStatuses, setCustomStatuses] = useState<
    Record<
      string,
      { checking: boolean; reachable: boolean | null; models: number }
    >
  >({});
  const [customDiscovered, setCustomDiscovered] = useState<
    Record<string, AiModelEntry[]>
  >({});
  const [customDialogOpen, setCustomDialogOpen] = useState(false);

  const [privacySettings, setPrivacySettings] = useState<PrivacySettings>(
    PRIVACY_PRESETS.full
  );
  const [privacyPreset, setPrivacyPreset] = useState<PrivacyPreset | null>(
    "full"
  );

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

  const loadModels = useCallback(async () => {
    if (!settings) {
      return;
    }
    const entries: Record<AiProviderName, AiModelEntry[]> = {
      anthropic: [],
      google: [],
      ollama: [],
      openai: [],
      "openai-compatible": [],
    };
    for (const provider of settings.providers) {
      try {
        const apiKey = settings.providers.find(
          (p) => p.name === provider.name
        )?.hasApiKey;
        const baseURL =
          provider.name === "ollama"
            ? settings.current.ollamaBaseURL
            : undefined;
        const models = await fetchProviderModels(
          provider.name,
          apiKey ? undefined : undefined, // API key not sent from renderer for security
          baseURL
            ? `${baseURL}${baseURL.endsWith("/v1") ? "" : "/v1"}`
            : undefined
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
      if (mounted) {
        setOllamaStatus({ ...result, checking: false });
      }
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
      if (!settings) {
        return [];
      }
      const provider = settings.providers.find((p) => p.name === providerName);
      if (!provider) {
        return [];
      }
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
    [settings, providerModels]
  );

  const configured = useMemo(
    () =>
      (settings?.current.provider === "ollama" && ollamaStatus.detected) ||
      (settings?.providers.some((p) => p.hasApiKey) ?? false) ||
      (settings?.customProviders.some(
        (p) => p.id === settings.current.provider && p.baseURL.trim().length > 0
      ) ??
        false),
    [settings, ollamaStatus.detected]
  );

  const currentProviderLabel = useMemo(
    () =>
      settings?.providers.find((p) => p.name === settings.current.provider)
        ?.label ??
      settings?.customProviders.find((p) => p.id === settings.current.provider)
        ?.label,
    [settings]
  );

  const handleProviderChange = useCallback(
    async (providerName: AiProviderName) => {
      if (!settings) {
        return;
      }
      const newProvider = settings.providers.find(
        (p) => p.name === providerName
      );
      if (!newProvider) {
        return;
      }
      setIsSavingProvider(true);
      try {
        await updateAiSettings({
          model: newProvider.defaultModel,
          provider: providerName,
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
    async (model: string) => {
      if (!settings) {
        return;
      }
      await updateAiSettings({ model });
      await loadSettings();
    },
    [settings, loadSettings]
  );

  const handleSaveApiKey = useCallback(
    async (provider: AiProviderName, key: string) => {
      await setAiApiKey(provider, key);
      await loadSettings();
    },
    [loadSettings]
  );

  const handleRemoveApiKey = useCallback(
    async (provider: AiProviderName) => {
      await setAiApiKey(provider, "");
      await loadSettings();
    },
    [loadSettings]
  );

  const handleSaveOllamaBaseUrl = useCallback(
    async (url: string) => {
      await updateAiSettings({ ollamaBaseURL: url });
      await loadSettings();
    },
    [loadSettings]
  );

  const handleRefreshModels = useCallback(
    async (providerName: AiProviderName) => {
      setSavingModelsFor(providerName);
      try {
        const provider = settings?.providers.find(
          (p) => p.name === providerName
        );
        if (!provider) {
          return;
        }
        const baseURL =
          providerName === "ollama"
            ? settings?.current.ollamaBaseURL
            : undefined;
        const models = await fetchProviderModels(
          providerName,
          undefined,
          baseURL
            ? `${baseURL}${baseURL.endsWith("/v1") ? "" : "/v1"}`
            : undefined
        );
        setProviderModels((prev) => ({ ...prev, [providerName]: models }));
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to fetch models"
        );
      } finally {
        setSavingModelsFor(null);
      }
    },
    [settings]
  );

  const handlePrivacyPreset = useCallback(async (preset: PrivacyPreset) => {
    try {
      const result = await updatePrivacySettings({ preset });
      setPrivacySettings(result);
      setPrivacyPreset(preset);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update privacy"
      );
    }
  }, []);

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
          err instanceof Error ? err.message : "Failed to update privacy"
        );
      }
    },
    []
  );

  const handleRefreshOllama = useCallback(async () => {
    setOllamaStatus((prev) => ({ ...prev, checking: true }));
    const result = await detectOllama();
    setOllamaStatus({ ...result, checking: false });
    await loadSettings();
  }, [loadSettings]);

  const checkCustomStatus = useCallback(
    async (custom: AiCustomProviderInfo) => {
      setCustomStatuses((prev) => ({
        ...prev,
        [custom.id]: {
          checking: true,
          models: prev[custom.id]?.models ?? 0,
          reachable: prev[custom.id]?.reachable ?? null,
        },
      }));
      try {
        const status = await checkProviderEndpoint(custom.baseURL);
        setCustomStatuses((prev) => ({
          ...prev,
          [custom.id]: {
            checking: false,
            models: status.models.length,
            reachable: status.reachable,
          },
        }));
      } catch {
        setCustomStatuses((prev) => ({
          ...prev,
          [custom.id]: { checking: false, models: 0, reachable: false },
        }));
      }
    },
    []
  );

  // Auto-check local custom endpoints once per URL (they may start/stop).
  const checkedLocalRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!settings) {
      return;
    }
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
      if (!settings) {
        return;
      }
      if (!model && settings.current.provider === custom.id) {
        return;
      }
      setIsSavingProvider(true);
      try {
        await updateAiSettings({
          model: model ?? custom.defaultModel ?? settings.current.model,
          provider: custom.id,
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
              baseURL: input.baseURL,
              defaultModel: input.defaultModel,
              label: input.label,
            })
          : await addCustomProvider({
              apiKey: input.apiKey,
              baseURL: input.baseURL,
              defaultModel: input.defaultModel,
              label: input.label,
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
          err instanceof Error ? err.message : "Failed to save custom provider"
        );
      }
    },
    []
  );

  const handleRemoveCustomProvider = useCallback(async (id: string) => {
    try {
      const next = await removeCustomProvider(id);
      setSettings(next);
      toast.success("Custom provider removed");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to remove custom provider"
      );
    }
  }, []);

  const handleCustomKeySave = useCallback(async (id: string, key: string) => {
    try {
      const next = await setCustomProviderApiKey(id, key);
      setSettings(next);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to save API key"
      );
    }
  }, []);

  const handleRenameCustomModel = useCallback(
    async (
      providerId: string,
      oldModelId: string,
      newModelId: string,
      isCustom: boolean
    ) => {
      try {
        let next = isCustom
          ? await renameCustomModel(providerId, oldModelId, newModelId)
          : await addCustomModel(providerId, newModelId);

        if (!isCustom) {
          setCustomDiscovered((prev) => ({
            ...prev,
            [providerId]: (prev[providerId] ?? []).map((model) =>
              model.id === oldModelId
                ? { ...model, id: newModelId, isCustom: true }
                : model
            ),
          }));

          if (
            next.current.provider === providerId &&
            next.current.model === oldModelId
          ) {
            await updateAiSettings({ model: newModelId });
            next = await getAiSettings();
          }
        }

        setSettings(next);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to rename model"
        );
        throw err;
      }
    },
    []
  );

  const handleDiscoverCustomModels = useCallback(
    async (custom: AiCustomProviderInfo) => {
      setSavingModelsFor(custom.id);
      try {
        const base = custom.baseURL.endsWith("/v1")
          ? custom.baseURL
          : `${custom.baseURL}/v1`;
        const models = await fetchProviderModels(
          "openai-compatible",
          undefined,
          base
        );
        setCustomDiscovered((prev) => ({ ...prev, [custom.id]: models }));
        if (models.length === 0) {
          toast.info("No models listed by this endpoint");
        }
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to fetch models"
        );
      } finally {
        setSavingModelsFor(null);
      }
    },
    []
  );

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <UiIcon
          className="size-5 animate-spin text-muted-foreground"
          name="loader"
        />
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-md text-center">
          <UiIcon
            className="mx-auto mb-3 size-10 text-muted-foreground"
            name="bot"
          />
          <p className="font-medium text-sm">Could not load AI settings</p>
          <Button
            className="mt-3 transition-transform duration-150 ease-out active:scale-[0.97]"
            onClick={loadSettings}
            size="sm"
            variant="outline"
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {!compact && (
        <div className="flex items-center justify-between px-6 pt-6 pb-2">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary/[0.12] ring-1 ring-primary/20">
              <UiIcon className="size-5 text-primary" name="sparkles" />
            </div>
            <div>
              <h2 className="font-heading font-semibold text-lg tracking-tight">
                AI Assistant
              </h2>
              <p className="text-muted-foreground text-xs">
                Configure the AI provider and model for SQL assistance.
              </p>
            </div>
          </div>
        </div>
      )}

      <Tabs className="gap-4" defaultValue="providers">
        <div className="sticky top-0 z-10 bg-background pb-1">
          <TabsList>
            <TabsTrigger value="providers">Providers</TabsTrigger>
            <TabsTrigger value="custom">Custom Providers</TabsTrigger>
            <TabsTrigger value="privacy">Privacy & Context</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="providers">
          <AiSettingsStatus configured={configured} />
          <ProvidersPanel
            currentModel={settings.current.model}
            currentProvider={settings.current.provider}
            getMergedModels={getMergedModels}
            isFetchingModelsFor={savingModelsFor}
            isSavingProvider={isSavingProvider}
            ollamaBaseURL={settings.current.ollamaBaseURL ?? ""}
            ollamaChecking={ollamaStatus.checking}
            ollamaDetected={ollamaStatus.detected}
            ollamaModels={ollamaStatus.models}
            onModelChange={handleModelChange}
            onProviderChange={handleProviderChange}
            onRefreshModels={handleRefreshModels}
            onRefreshOllama={handleRefreshOllama}
            onRemoveApiKey={handleRemoveApiKey}
            onSaveApiKey={handleSaveApiKey}
            onSaveOllamaBaseUrl={handleSaveOllamaBaseUrl}
            providers={settings.providers}
          />
          <MissingConfigWarning
            ollamaDetected={ollamaStatus.detected}
            settings={settings}
          />
        </TabsContent>

        <TabsContent value="custom">
          <CustomProvidersPanel
            currentModel={settings.current.model}
            currentProvider={settings.current.provider}
            customs={settings.customProviders ?? []}
            discovered={customDiscovered}
            fetchingModelsFor={savingModelsFor}
            isSavingProvider={isSavingProvider}
            onAddModel={async (id, modelId) => {
              try {
                setSettings(await addCustomModel(id, modelId));
              } catch (err) {
                toast.error(
                  err instanceof Error ? err.message : "Failed to add model"
                );
              }
            }}
            onAddNew={() => setCustomDialogOpen(true)}
            onDelete={(id) => handleRemoveCustomProvider(id)}
            onDiscover={(custom) => handleDiscoverCustomModels(custom)}
            onModelChange={(model: string) => handleModelChange(model)}
            onRefreshStatus={(custom) => checkCustomStatus(custom)}
            onRemoveModel={async (id, modelId) => {
              try {
                setSettings(await removeCustomModel(id, modelId));
              } catch (err) {
                toast.error(
                  err instanceof Error ? err.message : "Failed to remove model"
                );
              }
            }}
            onRenameModel={(id, oldModelId, newModelId, isCustom) =>
              handleRenameCustomModel(id, oldModelId, newModelId, isCustom)
            }
            onSaveKey={(id: string, key: string) =>
              handleCustomKeySave(id, key)
            }
            onSelect={(custom) => handleCustomProviderChange(custom)}
            onUpdate={async (id, patch) => {
              try {
                setSettings(await updateCustomProvider(id, patch));
              } catch (err) {
                toast.error(
                  err instanceof Error
                    ? err.message
                    : "Failed to update provider"
                );
              }
            }}
            onUseModel={(custom, modelId) =>
              handleCustomProviderChange(custom, modelId)
            }
            statuses={customStatuses}
          />
        </TabsContent>

        <TabsContent value="privacy">
          <PrivacySettingsSection
            currentProvider={settings.current.provider}
            onPresetChange={handlePrivacyPreset}
            onToggle={handlePrivacyToggle}
            privacyPreset={privacyPreset}
            privacySettings={privacySettings}
            providerLabel={currentProviderLabel}
          />
        </TabsContent>
      </Tabs>

      <CustomProviderDialog
        onOpenChange={setCustomDialogOpen}
        onSave={handleSaveCustomProvider}
        open={customDialogOpen}
      />
    </div>
  );
}

function AiSettingsStatus({ configured }: { configured: boolean }) {
  return (
    <AnimatePresence mode="wait">
      {configured ? (
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 text-emerald-600 text-xs dark:text-emerald-400"
          exit={{ opacity: 0, y: 4 }}
          initial={{ opacity: 0, y: -4 }}
          key="configured"
          transition={{ duration: 0.15, ease: EASE_OUT }}
        >
          <UiIcon className="size-3" name="circle-check" />
          AI is configured
        </motion.div>
      ) : (
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 text-amber-600 text-xs dark:text-amber-400"
          exit={{ opacity: 0, y: 4 }}
          initial={{ opacity: 0, y: -4 }}
          key="unconfigured"
          transition={{ duration: 0.15, ease: EASE_OUT }}
        >
          <UiIcon className="size-3" name="alert-circle" />
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
    (p) => p.name === settings.current.provider
  );
  if (!currentProvider?.requiresApiKey || currentProvider.hasApiKey) {
    return null;
  }
  if (currentProvider.name === "ollama" && ollamaDetected) {
    return null;
  }

  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="mt-2 flex items-start gap-2 rounded-lg bg-amber-50 p-2.5 text-amber-600 text-xs dark:bg-amber-900/20 dark:text-amber-400"
      initial={{ opacity: 0, y: -4 }}
      transition={{ delay: 0.05, duration: 0.15, ease: EASE_OUT }}
    >
      <UiIcon className="mt-0.5 size-3 shrink-0" name="alert-circle" />
      <span>
        This provider requires configuration. Click the provider card to enter
        your API key.
      </span>
    </motion.div>
  );
}

interface ProvidersPanelProps {
  currentModel: string;
  currentProvider: string;
  getMergedModels: (providerName: AiProviderName) => AiModelEntry[];
  isFetchingModelsFor: string | null;
  isSavingProvider: boolean;
  ollamaBaseURL: string;
  ollamaChecking: boolean;
  ollamaDetected: boolean;
  ollamaModels: string[];
  onModelChange: (model: string) => Promise<void>;
  onProviderChange: (providerName: AiProviderName) => Promise<void>;
  onRefreshModels: (providerName: AiProviderName) => Promise<void>;
  onRefreshOllama: () => Promise<void>;
  onRemoveApiKey: (provider: AiProviderName) => Promise<void>;
  onSaveApiKey: (provider: AiProviderName, key: string) => Promise<void>;
  onSaveOllamaBaseUrl: (url: string) => Promise<void>;
  providers: AiProvidersInfo["providers"];
}

/**
 * Master/detail layout for the built-in providers: a compact rail on the left
 * lists every provider, and the pane on the right holds the config for the
 * selected one. Selecting a provider only *views* it — switching the active
 * provider is an explicit action, so browsing never silently changes which
 * model the app is using.
 */
function ProvidersPanel({
  providers,
  currentProvider,
  currentModel,
  isSavingProvider,
  isFetchingModelsFor,
  getMergedModels,
  ollamaBaseURL,
  ollamaDetected,
  ollamaModels,
  ollamaChecking,
  onProviderChange,
  onModelChange,
  onSaveApiKey,
  onRemoveApiKey,
  onSaveOllamaBaseUrl,
  onRefreshOllama,
  onRefreshModels,
}: ProvidersPanelProps) {
  const [selectedName, setSelectedName] = useState<AiProviderName | null>(null);
  const selected =
    providers.find((p) => p.name === selectedName) ??
    providers.find((p) => p.name === currentProvider) ??
    providers[0] ??
    null;

  return (
    <div className="overflow-hidden rounded-xl border border-border/70">
      <div className="flex min-h-[360px]">
        <div className="w-40 shrink-0 border-border/50 border-r p-2">
          <p className="select-none px-2 pt-1 pb-1.5 font-medium text-[11px] text-muted-foreground/60 uppercase tracking-wider">
            Built-in
          </p>
          <div className="space-y-0.5">
            {providers.map((provider) => {
              const ProviderIcon = PROVIDER_ICONS[provider.name];
              const isSelected = selected?.name === provider.name;
              const isActive = currentProvider === provider.name;
              return (
                <button
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                    isSelected
                      ? "bg-muted/70 font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                  )}
                  key={provider.name}
                  onClick={() => setSelectedName(provider.name)}
                  type="button"
                >
                  <ProviderIcon className="size-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">
                    {provider.label}
                  </span>
                  {isActive ? (
                    <span
                      aria-label="Active provider"
                      className="size-1.5 shrink-0 rounded-full bg-primary"
                    />
                  ) : provider.hasApiKey ? (
                    <UiIcon
                      className="size-3 shrink-0 text-emerald-500"
                      name="circle-check"
                    />
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        <div className="min-w-0 flex-1 p-4">
          {selected ? (
            <ProviderDetail
              currentModel={currentModel}
              isActive={currentProvider === selected.name}
              isFetchingModels={isFetchingModelsFor === selected.name}
              isSaving={isSavingProvider}
              key={selected.name}
              ollamaBaseURL={ollamaBaseURL}
              ollamaChecking={ollamaChecking}
              ollamaDetected={ollamaDetected}
              ollamaModels={ollamaModels}
              onModelChange={onModelChange}
              onRefreshModels={() => onRefreshModels(selected.name)}
              onRefreshOllama={onRefreshOllama}
              onRemoveApiKey={() => onRemoveApiKey(selected.name)}
              onSaveApiKey={(key) => onSaveApiKey(selected.name, key)}
              onSaveOllamaBaseUrl={onSaveOllamaBaseUrl}
              onSelectProvider={() => onProviderChange(selected.name)}
              provider={selected}
              providerModels={getMergedModels(selected.name)}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function SaveButton({
  disabled,
  isSaving,
  onSave,
  saved,
}: {
  disabled?: boolean;
  isSaving: boolean;
  onSave: () => void;
  saved: boolean;
}) {
  let label: React.ReactNode = "Save";
  if (isSaving) {
    label = <UiIcon className="size-3 animate-spin" name="loader" />;
  } else if (saved) {
    label = (
      <span className="flex items-center gap-1">
        <UiIcon className="size-3" name="check" />
        Saved!
      </span>
    );
  }

  return (
    <Button
      className={cn(
        "h-8 shrink-0 gap-1.5 px-3 text-xs shadow-sm transition-[background-color,color,box-shadow] duration-200 ease-out",
        saved &&
          "bg-emerald-500 text-white hover:bg-emerald-500/90 hover:text-white"
      )}
      disabled={disabled || isSaving || saved}
      onClick={onSave}
      size="sm"
      type="button"
    >
      {label}
    </Button>
  );
}

interface ProviderDetailProps {
  currentModel: string;
  isActive: boolean;
  isFetchingModels: boolean;
  isSaving: boolean;
  ollamaBaseURL: string;
  ollamaChecking: boolean;
  ollamaDetected: boolean;
  ollamaModels: string[];
  onModelChange: (model: string) => Promise<void>;
  onRefreshModels: () => Promise<void>;
  onRefreshOllama: () => Promise<void>;
  onRemoveApiKey: () => Promise<void>;
  onSaveApiKey: (key: string) => Promise<void>;
  onSaveOllamaBaseUrl: (url: string) => Promise<void>;
  onSelectProvider: () => Promise<void>;
  provider: AiProvidersInfo["providers"][number];
  providerModels: AiModelEntry[];
}

function ProviderDetail({
  provider,
  isActive,
  isSaving,
  providerModels,
  isFetchingModels,
  currentModel,
  ollamaBaseURL,
  ollamaDetected,
  ollamaModels,
  ollamaChecking,
  onSelectProvider,
  onModelChange,
  onSaveApiKey,
  onRemoveApiKey,
  onSaveOllamaBaseUrl,
  onRefreshOllama,
  onRefreshModels,
}: ProviderDetailProps) {
  const ProviderIcon = PROVIDER_ICONS[provider.name];

  // Every text field keeps a local draft and only writes on an explicit
  // action (Save button or Enter). Persisting straight from `onChange` would
  // round-trip to the main process on every keystroke.
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [isSavingKey, setIsSavingKey] = useState(false);
  const [keySaved, setKeySaved] = useState(false);

  const [ollamaUrlInput, setOllamaUrlInput] = useState(ollamaBaseURL);

  const [modelInput, setModelInput] = useState(currentModel);
  const [isSavingModel, setIsSavingModel] = useState(false);
  const [modelSaved, setModelSaved] = useState(false);

  const flashSaved = (reset: (value: boolean) => void) => {
    reset(true);
    setTimeout(() => reset(false), 2000);
  };

  const handleSaveKey = async () => {
    const key = apiKeyInput.trim();
    if (!key) {
      return;
    }
    setIsSavingKey(true);
    try {
      await onSaveApiKey(key);
      setApiKeyInput("");
      setShowApiKey(false);
      flashSaved(setKeySaved);
    } finally {
      setIsSavingKey(false);
    }
  };

  const handleSaveOllamaUrl = async () => {
    const next = ollamaUrlInput.trim();
    if (next === ollamaBaseURL.trim()) {
      return;
    }
    await onSaveOllamaBaseUrl(next);
  };

  const handleSaveModel = async () => {
    const next = modelInput.trim();
    if (!next) {
      return;
    }
    setIsSavingModel(true);
    try {
      await onModelChange(next);
      flashSaved(setModelSaved);
    } finally {
      setIsSavingModel(false);
    }
  };

  const handleFieldEnter = (
    event: React.KeyboardEvent<HTMLInputElement>,
    save: () => Promise<void>
  ) => {
    if (event.key === "Enter") {
      void save();
    }
  };

  // `apiKeyFormat` is the reliable signal: only Ollama ships without one.
  const showApiKeyField =
    provider.requiresApiKey || Boolean(provider.apiKeyFormat);
  const usesModelSelect =
    provider.name === "ollama" || provider.name === "openai";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <ProviderIcon className="size-5 shrink-0" />
          <span className="truncate font-medium text-sm">{provider.label}</span>
        </div>
        {isActive ? (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-primary/10 px-2 py-0.5 font-medium text-[11px] text-primary">
            <span className="size-1.5 rounded-full bg-primary" />
            Active
          </span>
        ) : (
          <Button
            className="h-7 shrink-0 gap-1.5 px-2.5 text-xs"
            disabled={isSaving}
            onClick={onSelectProvider}
            size="sm"
            type="button"
          >
            {isSaving ? (
              <UiIcon className="size-3 animate-spin" name="loader" />
            ) : null}
            Use this provider
          </Button>
        )}
      </div>

      <Separator />

      {showApiKeyField && (
        <div className="space-y-2">
          <Label className="font-medium text-muted-foreground text-xs">
            API Key
            {!provider.requiresApiKey && (
              <span className="ml-1.5 font-normal text-muted-foreground/70">
                optional
              </span>
            )}
          </Label>
          <div className="flex gap-1.5">
            <div className="relative min-w-0 flex-1">
              <Input
                autoCapitalize="off"
                autoComplete="off"
                autoCorrect="off"
                className="h-8 bg-background pr-8 font-mono text-xs"
                onChange={(e) => setApiKeyInput(e.target.value)}
                onKeyDown={(e) => handleFieldEnter(e, handleSaveKey)}
                placeholder={
                  provider.hasApiKey
                    ? "Key saved — enter new to replace"
                    : (provider.apiKeyFormat?.placeholder ?? "Enter API key")
                }
                spellCheck="false"
                type={showApiKey ? "text" : "password"}
                value={apiKeyInput}
              />
              <button
                aria-label={showApiKey ? "Hide API key" : "Show API key"}
                className="absolute top-1/2 right-2.5 -translate-y-1/2 select-none text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => setShowApiKey(!showApiKey)}
                type="button"
              >
                <UiIcon
                  className="size-3"
                  name={showApiKey ? "eye-off" : "eye"}
                />
              </button>
            </div>
            <SaveButton
              disabled={!apiKeyInput.trim()}
              isSaving={isSavingKey}
              onSave={handleSaveKey}
              saved={keySaved}
            />
          </div>
          {provider.hasApiKey && (
            <div className="flex items-center gap-3">
              <p className="flex items-center gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-400">
                <UiIcon className="size-3" name="circle-check" />
                API key is set
              </p>
              <Button
                className="h-7 px-2 text-muted-foreground text-xs hover:text-destructive"
                onClick={onRemoveApiKey}
                size="sm"
                type="button"
                variant="ghost"
              >
                Remove
              </Button>
            </div>
          )}
        </div>
      )}

      {provider.name === "ollama" && (
        <div className="space-y-2">
          <Label className="font-medium text-muted-foreground text-xs">
            Ollama Base URL
          </Label>
          <Input
            className="h-8 bg-background font-mono text-xs"
            onBlur={handleSaveOllamaUrl}
            onChange={(e) => setOllamaUrlInput(e.target.value)}
            onKeyDown={(e) => handleFieldEnter(e, handleSaveOllamaUrl)}
            placeholder="http://localhost:11434"
            type="url"
            value={ollamaUrlInput}
          />
          <p className="text-[11px] text-muted-foreground">
            Leave empty to use the default localhost address.
          </p>
          <div className="flex items-center gap-2 text-xs">
            {ollamaDetected ? (
              <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                <UiIcon className="size-3" name="circle-check" />
                Ollama detected ({ollamaModels.length} models)
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                <UiIcon className="size-3" name="alert-circle" />
                Ollama not running
              </span>
            )}
            <Button
              className="ml-auto h-6 gap-1.5 px-2 text-xs"
              disabled={ollamaChecking}
              onClick={onRefreshOllama}
              size="sm"
              type="button"
              variant="ghost"
            >
              {ollamaChecking ? (
                <UiIcon className="size-3 animate-spin" name="loader" />
              ) : (
                <UiIcon className="size-3" name="refresh" />
              )}
              Refresh
            </Button>
          </div>
          {!ollamaDetected && (
            <p className="text-[11px] text-muted-foreground">
              Install Ollama from{" "}
              <code className="text-foreground/60">ollama.com</code> and run{" "}
              <code className="text-foreground/60">ollama serve</code> to get
              started.
            </p>
          )}
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="font-medium text-muted-foreground text-xs">
            Model
          </Label>
          {providerModels.length > 0 && (
            <Button
              className="h-6 gap-1.5 px-2 text-[10px]"
              disabled={isFetchingModels}
              onClick={onRefreshModels}
              size="sm"
              type="button"
              variant="ghost"
            >
              {isFetchingModels ? (
                <UiIcon className="size-2.5 animate-spin" name="loader" />
              ) : (
                <UiIcon className="size-2.5" name="refresh" />
              )}
              Refresh
            </Button>
          )}
        </div>

        {usesModelSelect ? (
          <NativeSelect
            className="w-full"
            onChange={(e) => onModelChange(e.target.value)}
            size="sm"
            value={currentModel}
          >
            <NativeSelectOption disabled value="">
              Select a model
            </NativeSelectOption>
            {providerModels.map((model) => (
              <NativeSelectOption key={model.id} value={model.id}>
                {model.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        ) : (
          <div className="flex gap-1.5">
            <Input
              autoCapitalize="off"
              autoComplete="off"
              autoCorrect="off"
              className="h-8 min-w-0 flex-1 bg-background font-mono text-xs"
              onChange={(e) => setModelInput(e.target.value)}
              onKeyDown={(e) => handleFieldEnter(e, handleSaveModel)}
              placeholder={provider.defaultModel || "Enter model ID"}
              spellCheck="false"
              value={modelInput}
            />
            <SaveButton
              disabled={!modelInput.trim()}
              isSaving={isSavingModel}
              onSave={handleSaveModel}
              saved={modelSaved}
            />
          </div>
        )}

        {providerModels.length > 0 && usesModelSelect && (
          <p className="text-[11px] text-muted-foreground">
            {providerModels.length} models available from {provider.label}
          </p>
        )}
      </div>
    </div>
  );
}

interface CustomStatus {
  checking: boolean;
  models: number;
  reachable: boolean | null;
}

interface CustomProvidersPanelProps {
  currentModel: string;
  currentProvider: string;
  customs: AiCustomProviderInfo[];
  discovered: Record<string, AiModelEntry[]>;
  fetchingModelsFor: string | null;
  isSavingProvider: boolean;
  onAddModel: (id: string, modelId: string) => void;
  onAddNew: () => void;
  onDelete: (id: string) => void;
  onDiscover: (custom: AiCustomProviderInfo) => void;
  onModelChange: (model: string) => void;
  onRefreshStatus: (custom: AiCustomProviderInfo) => void;
  onRemoveModel: (id: string, modelId: string) => void;
  onRenameModel: (
    id: string,
    oldModelId: string,
    newModelId: string,
    isCustom: boolean
  ) => Promise<void>;
  onSaveKey: (id: string, key: string) => void;
  onSelect: (custom: AiCustomProviderInfo) => void;
  onUpdate: (
    id: string,
    patch: { label?: string; baseURL?: string; defaultModel?: string }
  ) => void;
  onUseModel: (custom: AiCustomProviderInfo, modelId: string) => void;
  statuses: Record<string, CustomStatus>;
}

function CustomStatusDot({ status }: { status: CustomStatus }) {
  if (status.checking) {
    return (
      <UiIcon
        className="size-3 animate-spin text-muted-foreground"
        name="loader"
      />
    );
  }
  return (
    <span
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        status.reachable ? "bg-emerald-500" : "bg-muted-foreground/35"
      )}
    />
  );
}

function customStatusText(
  custom: AiCustomProviderInfo,
  status: CustomStatus
): string {
  if (status.checking) {
    return "Checking…";
  }
  if (status.reachable === null) {
    return custom.isLocal ? "Not checked" : "Remote endpoint";
  }
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
  onRenameModel,
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
      <div className="rounded-xl border border-border/60 border-dashed px-3 py-3">
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Save your own OpenAI-compatible endpoints — LM Studio, vLLM, Ollama on
          another machine, OpenRouter. Local ones show whether they are running.
        </p>
        <Button
          className="mt-2 h-7 gap-1 px-2 text-xs"
          onClick={onAddNew}
          size="sm"
          type="button"
          variant="ghost"
        >
          <UiIcon className="size-3" name="plus" />
          Add provider
        </Button>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border/70">
      <div className="flex min-h-[300px]">
        <div className="w-40 shrink-0 border-border/50 border-r p-2">
          <p className="select-none px-2 pt-1 pb-1.5 font-medium text-[11px] text-muted-foreground/60 uppercase tracking-wider">
            Custom
          </p>
          <div className="space-y-0.5">
            {customs.map((custom) => (
              <button
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                  selected?.id === custom.id
                    ? "bg-muted/70 font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                )}
                key={custom.id}
                onClick={() => setSelectedId(custom.id)}
                type="button"
              >
                <CustomStatusDot
                  status={
                    statuses[custom.id] ?? {
                      checking: false,
                      models: 0,
                      reachable: null,
                    }
                  }
                />
                <span className="min-w-0 flex-1 truncate">{custom.label}</span>
              </button>
            ))}
          </div>
          <button
            className="mt-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-muted-foreground outline-none transition-colors hover:bg-muted/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            onClick={onAddNew}
            type="button"
          >
            <UiIcon className="size-3" name="plus" />
            Add provider
          </button>
        </div>
        <div className="min-w-0 flex-1 p-4">
          {selected && (
            <CustomProviderDetail
              currentModel={currentModel}
              custom={selected}
              discoveredModels={discovered[selected.id] ?? []}
              isActive={currentProvider === selected.id}
              isFetchingModels={fetchingModelsFor === selected.id}
              isSaving={isSavingProvider}
              key={selected.id}
              onAddModel={(modelId) => onAddModel(selected.id, modelId)}
              onDelete={() => onDelete(selected.id)}
              onDiscover={() => onDiscover(selected)}
              onModelChange={onModelChange}
              onRefreshStatus={() => onRefreshStatus(selected)}
              onRemoveModel={(modelId) => onRemoveModel(selected.id, modelId)}
              onRenameModel={(oldModelId, newModelId, isCustom) =>
                onRenameModel(
                  selected.id,
                  oldModelId,
                  newModelId,
                  isCustom
                )
              }
              onSaveKey={(key) => onSaveKey(selected.id, key)}
              onSelect={() => onSelect(selected)}
              onUpdate={(patch) => onUpdate(selected.id, patch)}
              onUseModel={(modelId) => onUseModel(selected, modelId)}
              status={
                statuses[selected.id] ?? {
                  checking: false,
                  models: 0,
                  reachable: null,
                }
              }
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
  onRenameModel,
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
  onUpdate: (patch: {
    label?: string;
    baseURL?: string;
    defaultModel?: string;
  }) => void;
  onAddModel: (modelId: string) => void;
  onRemoveModel: (modelId: string) => void;
  onRenameModel: (
    oldModelId: string,
    newModelId: string,
    isCustom: boolean
  ) => Promise<void>;
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
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [editingModelValue, setEditingModelValue] = useState("");
  const [savingModelId, setSavingModelId] = useState<string | null>(null);

  const beginModelEdit = (modelId: string) => {
    setEditingModelId(modelId);
    setEditingModelValue(modelId);
  };

  const cancelModelEdit = () => {
    setEditingModelId(null);
    setEditingModelValue("");
  };

  const saveModelEdit = async (modelId: string, isCustom: boolean) => {
    const nextModelId = editingModelValue.trim();
    if (!nextModelId || nextModelId === modelId) {
      cancelModelEdit();
      return;
    }

    setSavingModelId(modelId);
    try {
      await onRenameModel(modelId, nextModelId, isCustom);
      cancelModelEdit();
    } catch {
      // The parent displays the actionable error message.
    } finally {
      setSavingModelId(null);
    }
  };

  useEffect(() => {
    if (!confirmingDelete) {
      return;
    }
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
    if (!keyInput.trim()) {
      return;
    }
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
        rows.push({ added: !!m.isCustom, id: m.id });
      }
    }
    return rows;
  }, [custom.customModels, discoveredModels]);

  return (
    <div>
      <div className="flex items-center gap-1.5">
        {renaming ? (
          <Input
            autoFocus
            className="h-7 flex-1 font-medium text-sm"
            onBlur={saveName}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                saveName();
              }
              if (e.key === "Escape") {
                setNameInput(custom.label);
                setRenaming(false);
              }
            }}
            value={nameInput}
          />
        ) : (
          <h3 className="min-w-0 flex-1 truncate font-medium text-sm">
            {custom.label}
          </h3>
        )}
        {!renaming && (
          <button
            aria-label="Rename provider"
            className="flex size-6 shrink-0 select-none items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
            onClick={() => {
              setNameInput(custom.label);
              setRenaming(true);
            }}
            type="button"
          >
            <UiIcon className="size-3" name="pencil" />
          </button>
        )}
        {isActive ? (
          <span className="shrink-0 select-none rounded-full bg-emerald-500/15 px-2 py-0.5 font-medium text-[11px] text-emerald-600 dark:text-emerald-400">
            In use
          </span>
        ) : (
          <Button
            className="h-6 shrink-0 px-2 text-xs"
            disabled={isSaving}
            onClick={onSelect}
            size="sm"
            type="button"
            variant="ghost"
          >
            {isSaving ? (
              <UiIcon className="size-3 animate-spin" name="loader" />
            ) : null}
            Use
          </Button>
        )}
        <button
          aria-label="Delete provider"
          className={cn(
            "flex size-6 shrink-0 select-none items-center justify-center rounded-md transition-colors",
            confirmingDelete
              ? "bg-destructive/10 text-destructive"
              : "text-muted-foreground hover:bg-muted/60 hover:text-destructive"
          )}
          onClick={() => {
            if (confirmingDelete) {
              onDelete();
            } else {
              setConfirmingDelete(true);
            }
          }}
          title={
            confirmingDelete ? "Click again to confirm" : "Delete provider"
          }
          type="button"
        >
          <UiIcon className="size-3" name="trash" />
        </button>
      </div>

      <button
        className="mt-1.5 flex select-none items-center gap-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
        disabled={status.checking}
        onClick={onRefreshStatus}
        type="button"
      >
        <CustomStatusDot status={status} />
        {customStatusText(custom, status)}
        {status.checking ? null : (
          <UiIcon className="size-2.5 opacity-60" name="refresh" />
        )}
      </button>

      <div className="mt-4 space-y-3.5">
        <div className="space-y-1.5">
          <Label className="font-medium text-muted-foreground text-xs">
            Base URL
          </Label>
          <Input
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            className="h-8 bg-background font-mono text-xs"
            onBlur={saveBaseURL}
            onChange={(e) => setBaseURLInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                (e.target as HTMLInputElement).blur();
              }
            }}
            placeholder="http://localhost:1234/v1"
            spellCheck="false"
            value={baseURLInput}
          />
        </div>

        <div className="space-y-1.5">
          <Label className="font-medium text-muted-foreground text-xs">
            API key{" "}
            {custom.hasApiKey && (
              <span className="text-emerald-600 dark:text-emerald-400">
                · set
              </span>
            )}
          </Label>
          <div className="flex gap-1.5">
            <div className="relative flex-1">
              <Input
                autoCapitalize="off"
                autoComplete="off"
                autoCorrect="off"
                className="h-8 bg-background pr-8 font-mono text-xs"
                onChange={(e) => setKeyInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    void saveKey();
                  }
                }}
                placeholder={
                  custom.hasApiKey
                    ? "Enter new to replace (optional)"
                    : "Optional"
                }
                spellCheck="false"
                type={showKey ? "text" : "password"}
                value={keyInput}
              />
              <button
                className="absolute top-1/2 right-2.5 -translate-y-1/2 select-none text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => setShowKey(!showKey)}
                type="button"
              >
                {showKey ? (
                  <UiIcon className="size-3" name="eye-off" />
                ) : (
                  <UiIcon className="size-3" name="eye" />
                )}
              </button>
            </div>
            <Button
              className="h-8 shrink-0 px-3 text-xs"
              disabled={savingKey || !keyInput.trim()}
              onClick={() => void saveKey()}
              size="sm"
              type="button"
            >
              {savingKey ? (
                <UiIcon className="size-3 animate-spin" name="loader" />
              ) : (
                "Save"
              )}
            </Button>
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="font-medium text-muted-foreground text-xs">
              Models
            </Label>
            <Button
              className="h-5 gap-1 px-1.5 text-[10px]"
              disabled={isFetchingModels}
              onClick={onDiscover}
              size="sm"
              type="button"
              variant="ghost"
            >
              {isFetchingModels ? (
                <UiIcon className="size-2.5 animate-spin" name="loader" />
              ) : (
                <UiIcon className="size-2.5" name="refresh" />
              )}
              Discover
            </Button>
          </div>
          {models.length > 0 ? (
            <div className="divide-y divide-border/40 overflow-hidden rounded-lg border border-border/60">
              {models.map((m) => {
                const isCurrent = isActive && currentModel === m.id;
                const isEditing = editingModelId === m.id;
                const isSaving = savingModelId === m.id;
                return (
                  <div
                    className={cn(
                      "group flex items-center gap-1 py-1 pr-1.5 pl-2.5",
                      !isCurrent && "hover:bg-muted/40",
                      isCurrent && "bg-muted/40"
                    )}
                    key={m.id}
                  >
                    {isEditing ? (
                      <>
                        <Input
                          autoFocus
                          className="h-7 min-w-0 flex-1 font-mono text-xs"
                          disabled={isSaving}
                          onChange={(event) =>
                            setEditingModelValue(event.target.value)
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              void saveModelEdit(m.id, m.added);
                            }
                            if (event.key === "Escape") {
                              cancelModelEdit();
                            }
                          }}
                          spellCheck="false"
                          value={editingModelValue}
                        />
                        <button
                          aria-label={`Save ${m.id}`}
                          className="flex size-5 shrink-0 items-center justify-center rounded text-emerald-600 hover:bg-emerald-500/10 disabled:opacity-50 dark:text-emerald-400"
                          disabled={isSaving || !editingModelValue.trim()}
                          onClick={() => void saveModelEdit(m.id, m.added)}
                          type="button"
                        >
                          {isSaving ? (
                            <UiIcon
                              className="size-3 animate-spin"
                              name="loader"
                            />
                          ) : (
                            <UiIcon className="size-3" name="check" />
                          )}
                        </button>
                        <button
                          aria-label={`Cancel editing ${m.id}`}
                          className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                          disabled={isSaving}
                          onClick={cancelModelEdit}
                          type="button"
                        >
                          <UiIcon className="size-3" name="x" />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className="min-w-0 flex-1 select-none truncate py-0.5 text-left font-mono text-xs"
                          onClick={() => {
                            if (isCurrent) {
                              return;
                            }
                            onUseModel(m.id);
                          }}
                          title={isCurrent ? "Current model" : "Use this model"}
                          type="button"
                        >
                          {m.id}
                        </button>
                        <button
                          aria-label={`Edit ${m.id}`}
                          className="flex size-5 shrink-0 select-none items-center justify-center rounded text-muted-foreground/60 opacity-0 transition-all hover:bg-muted/60 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                          onClick={() => beginModelEdit(m.id)}
                          type="button"
                        >
                          <UiIcon className="size-3" name="pencil" />
                        </button>
                        {isCurrent ? (
                          <UiIcon
                            className="size-3 shrink-0 text-emerald-500"
                            name="check"
                          />
                        ) : m.added ? (
                          <button
                            aria-label={`Remove ${m.id}`}
                            className="flex size-5 shrink-0 select-none items-center justify-center rounded text-muted-foreground/60 opacity-0 transition-all hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                            onClick={() => onRemoveModel(m.id)}
                            type="button"
                          >
                            <UiIcon className="size-3" name="x" />
                          </button>
                        ) : null}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              No models listed yet — discover from the endpoint or add one
              below.
            </p>
          )}
          <div className="flex gap-1.5">
            <Input
              autoCapitalize="off"
              autoComplete="off"
              autoCorrect="off"
              className="h-7 flex-1 font-mono text-xs"
              onChange={(e) => setNewModel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newModel.trim()) {
                  onAddModel(newModel.trim());
                  setNewModel("");
                }
              }}
              placeholder="Add model ID…"
              spellCheck="false"
              value={newModel}
            />
            <Button
              className="h-7 shrink-0 gap-1 px-2 text-xs"
              disabled={!newModel.trim()}
              onClick={() => {
                onAddModel(newModel.trim());
                setNewModel("");
              }}
              size="sm"
              type="button"
              variant="ghost"
            >
              <UiIcon className="size-3" name="plus" />
              Add
            </Button>
          </div>
          {isActive ? (
            models.length === 0 && (
              <div className="space-y-1.5">
                <Label className="font-medium text-muted-foreground text-xs">
                  Manual model ID
                </Label>
                <Input
                  autoCapitalize="off"
                  autoComplete="off"
                  autoCorrect="off"
                  className="h-8 bg-background font-mono text-xs"
                  onChange={(e) => onModelChange(e.target.value)}
                  placeholder={custom.defaultModel || "Enter model ID"}
                  spellCheck="false"
                  value={currentModel}
                />
              </div>
            )
          ) : (
            <div className="space-y-1.5">
              <Label className="font-medium text-muted-foreground text-xs">
                Manual model ID
              </Label>
              <Input
                autoCapitalize="off"
                autoComplete="off"
                autoCorrect="off"
                className="h-8 bg-background font-mono text-xs"
                onChange={(e) => setManualModel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && manualModel.trim()) {
                    onUseModel(manualModel.trim());
                  }
                }}
                placeholder={custom.defaultModel || "Enter model ID"}
                spellCheck="false"
                value={manualModel}
              />
            </div>
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
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Add custom provider</DialogTitle>
          <DialogDescription>
            Any OpenAI-compatible endpoint — LM Studio, vLLM, Ollama elsewhere,
            OpenRouter.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label className="font-medium text-muted-foreground text-xs">
              Name
            </Label>
            <Input
              autoComplete="off"
              className="h-8 text-xs"
              onChange={(e) => setLabel(e.target.value)}
              placeholder="My local LLM"
              value={label}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="font-medium text-muted-foreground text-xs">
              Base URL
            </Label>
            <Input
              autoCapitalize="off"
              autoComplete="off"
              autoCorrect="off"
              className="h-8 font-mono text-xs"
              onChange={(e) => setBaseURL(e.target.value)}
              placeholder="http://localhost:1234/v1"
              spellCheck="false"
              value={baseURL}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="font-medium text-muted-foreground text-xs">
              API Key (optional)
            </Label>
            <Input
              autoCapitalize="off"
              autoComplete="off"
              autoCorrect="off"
              className="h-8 font-mono text-xs"
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              spellCheck="false"
              type="password"
              value={apiKey}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="font-medium text-muted-foreground text-xs">
              Default model (optional)
            </Label>
            <Input
              autoCapitalize="off"
              autoComplete="off"
              autoCorrect="off"
              className="h-8 font-mono text-xs"
              onChange={(e) => setDefaultModel(e.target.value)}
              placeholder="qwen2.5-coder:7b"
              spellCheck="false"
              value={defaultModel}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={() => onOpenChange(false)}
            size="sm"
            type="button"
            variant="ghost"
          >
            Cancel
          </Button>
          <Button
            disabled={!canSave}
            onClick={() =>
              onSave({
                apiKey: apiKey.trim() ? apiKey.trim() : undefined,
                baseURL: baseURL.trim(),
                defaultModel: defaultModel.trim(),
                label: label.trim(),
              })
            }
            size="sm"
            type="button"
          >
            Add provider
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
