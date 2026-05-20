import { PROVIDER_ICONS } from "@/components/ProviderIcons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Icon as UiIcon } from "@/components/ui/Icon";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  getAiSettings,
  setAiApiKey,
  updateAiSettings,
  detectOllama,
  getPrivacySettings,
  updatePrivacySettings,
  type AiProvidersInfo,
} from "../hooks/ai-actions";
import { cn } from "@/lib/utils";
import type { PrivacySettings, PrivacyPreset } from "@/shared/ai/streaming-contracts";
import { PRIVACY_PRESETS } from "@/shared/ai/streaming-contracts";
import { PrivacySettingsSection } from "./PrivacySettingsSection";
import { ProviderConfigDialog } from "./ProviderConfigDialog";

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

type ProviderName = "openai" | "anthropic" | "google" | "openai-compatible" | "ollama";

interface AiSettingsPanelProps {
  compact?: boolean;
}

export function AiSettingsPanel({ compact }: AiSettingsPanelProps) {
  const [settings, setSettings] = useState<AiProvidersInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingProvider, setIsSavingProvider] = useState(false);
  const [openConfigProvider, setOpenConfigProvider] = useState<string | null>(null);

  const [ollamaStatus, setOllamaStatus] = useState<{
    detected: boolean;
    models: string[];
    checking: boolean;
  }>({ detected: false, models: [], checking: true });

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

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

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

  const configured = useMemo(
    () =>
      (settings?.current.provider === "ollama" && ollamaStatus.detected) ||
      (settings?.providers.some((p) => p.hasApiKey) ?? false) ||
      (settings?.current.provider === "openai-compatible" &&
        (settings.current.openaiCompatibleBaseURL?.trim().length ?? 0) > 0),
    [settings, ollamaStatus.detected],
  );

  const currentProviderLabel = useMemo(
    () =>
      settings?.providers.find((p) => p.name === settings.current.provider)?.label,
    [settings],
  );

  const handleProviderChange = useCallback(
    async (providerName: string) => {
      if (!settings) return;
      const newProvider = settings.providers.find((p) => p.name === providerName);
      if (!newProvider) return;
      setIsSavingProvider(true);
      try {
        await updateAiSettings({
          provider: providerName as ProviderName,
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
    async (provider: string, key: string) => {
      await setAiApiKey(
        provider as "openai" | "anthropic" | "google" | "openai-compatible",
        key,
      );
      await loadSettings();
    },
    [loadSettings],
  );

  const handleRemoveApiKey = useCallback(
    async (provider: string) => {
      await setAiApiKey(
        provider as "openai" | "anthropic" | "google" | "openai-compatible",
        "",
      );
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
              <div
                key={provider.name}
                className={cn(
                  "flex items-center gap-2 rounded-xl border transition-colors duration-150 ease-out",
                  isActive
                    ? "border-primary/30 bg-primary/[0.08] ring-1 ring-primary/20 shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
                    : "border-border/70 bg-transparent hover:border-muted-foreground/30 hover:bg-muted/[0.02]",
                )}
              >
                <button
                  type="button"
                  disabled={isSavingProvider}
                  onClick={() => handleProviderChange(provider.name)}
                  className={cn(
                    "flex-1 flex items-center justify-between px-3.5 py-3 text-sm font-medium text-left active:scale-[0.97] transition-transform select-none",
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
                    {isSavingThis && (
                      <UiIcon name="loader" className="size-3.5 animate-spin" />
                    )}
                  </div>
                </button>
                {isActive && (
                  <button
                    type="button"
                    onClick={() => setOpenConfigProvider(provider.name)}
                    className="mr-2 flex items-center justify-center size-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors duration-150 ease-out active:scale-[0.97] select-none"
                    title="Provider settings"
                  >
                    <UiIcon name="settings" className="size-4" />
                  </button>
                )}
              </div>
            );
          })}

          <MissingConfigWarning
            settings={settings}
            ollamaDetected={ollamaStatus.detected}
          />
        </div>
      </div>

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

      <ProviderConfigDialog
        open={!!openConfigProvider}
        onOpenChange={(o) => !o && setOpenConfigProvider(null)}
        providerName={openConfigProvider}
        settings={settings}
        ollamaStatus={ollamaStatus}
        onRefreshOllama={handleRefreshOllama}
        onSaveApiKey={handleSaveApiKey}
        onRemoveApiKey={handleRemoveApiKey}
        onModelChange={handleModelChange}
        onSaveBaseUrl={handleSaveBaseUrl}
      />
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
            : "border-amber-500/15 bg-amber-500/[0.04] text-amber-700 dark:text-amber-400",
        )}
      >
        {configured ? (
          <>
            <UiIcon name="circle-check" className="size-4 shrink-0" />
            <span className="font-medium">AI is configured and ready to use</span>
          </>
        ) : (
          <>
            <UiIcon name="x" className="size-4 shrink-0" />
            <span className="font-medium">
              {settings.current.provider === "ollama"
                ? "Start Ollama to use local models (run `ollama serve`)"
                : settings.current.provider === "openai-compatible"
                  ? "Set the Base URL to enable OpenAI-compatible provider"
                  : "Add an API key to enable AI features"}
            </span>
          </>
        )}
      </motion.div>
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
  if (settings.current.provider === "ollama" && !ollamaDetected) {
    return (
      <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/20 bg-amber-500/6 px-3.5 py-3 text-xs text-amber-700 dark:text-amber-400">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 mt-0.5">
          <UiIcon name="alert-circle" className="size-3.5" />
        </div>
        <span className="leading-relaxed">
          Ollama is not running. Start it with{" "}
          <code className="font-mono">ollama serve</code> in your terminal.
        </span>
      </div>
    );
  }

  const activeProvider = settings.providers.find(
    (p) => p.name === settings.current.provider,
  );
  if (!activeProvider?.hasApiKey && settings.current.provider !== "ollama") {
    return (
      <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/20 bg-amber-500/6 px-3.5 py-3 text-xs text-amber-700 dark:text-amber-400">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 mt-0.5">
          <UiIcon name="alert-circle" className="size-3.5" />
        </div>
        <span className="leading-relaxed">
          {settings.current.provider === "openai-compatible"
            ? "Configure the Base URL and API key to use this provider"
            : "Add an API key to enable this provider"}
        </span>
      </div>
    );
  }

  return null;
}
