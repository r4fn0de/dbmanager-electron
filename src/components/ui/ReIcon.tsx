import type { SVGProps } from "react";
import type { IconComponent } from "reicon-react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  ArrowRightCircle,
  ArrowSwapHorizontal,
  ArrowUpRight,
  Bolt,
  Book,
  Bulb,
  Calendar,
  Check,
  CheckCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  Cloud,
  Code,
  CodeFile,
  Copy,
  Database,
  Download,
  Edit,
  Envelope,
  Expand,
  Eye,
  EyeOff,
  Filter,
  Fingerprint,
  Floppy,
  FolderOpen,
  Globe,
  Globe2,
  Grid,
  Grid8,
  Home,
  InfoCircle,
  Key,
  Keyboard,
  Layers,
  Link,
  List,
  Loader,
  Lock,
  LockOpen,
  Maximize,
  Minimize,
  Minus,
  Moon,
  More,
  Palette,
  Pause,
  Play,
  Plug,
  Plus,
  Power,
  Refresh,
  RotateRight,
  Search,
  SearchMinus,
  SearchPlus,
  Send,
  Server,
  Settings,
  Shield,
  ShieldCheck,
  Shuffle,
  SidebarLeft,
  SidebarLeft2,
  SidebarRight,
  Sort,
  Sparkles,
  Star,
  TerminalCircle,
  ThumbsDown,
  ThumbsUp,
  Trash,
  Undo,
  Upload,
  User,
  Wand,
  Wifi,
  X,
  XCircle,
} from "reicon-react";

/**
 * Reicon-backed icon set.
 *
 * This is an isolated wrapper around `reicon-react` (https://reicon.dev/docs/react).
 * It is intentionally separate from `@/components/ui/Icon` (Tabler) so both
 * providers can coexist without either one leaking into the other's API.
 *
 * The name union mirrors the kebab-case convention used by `Icon` for a
 * consistent call-site experience, while `REICON_MAP` resolves each name to its
 * PascalCase Reicon component. Every entry is a static import, so bundlers can
 * tree-shake the ~2600 icons that are not listed here.
 *
 * To add an icon:
 *   1. Add its kebab-case name to `ReIconName`.
 *   2. Import the PascalCase component from `reicon-react`.
 *   3. Add the entry to `REICON_MAP`.
 *
 * Browse the full catalogue at https://reicon.dev/icons.
 */
export type ReIconName =
  | "alert-circle"
  | "alert-triangle"
  | "arrow-right"
  | "arrow-right-circle"
  | "arrows-left-right"
  | "arrows-maximize"
  | "arrows-shuffle"
  | "arrows-up-down"
  | "book"
  | "bulb"
  | "calendar"
  | "check"
  | "chevron-down"
  | "chevron-left"
  | "chevron-right"
  | "chevron-up"
  | "circle-check"
  | "clock"
  | "cloud"
  | "code"
  | "copy"
  | "database"
  | "device-floppy"
  | "dots"
  | "download"
  | "external-link"
  | "eye"
  | "eye-off"
  | "file-code"
  | "filter"
  | "fingerprint"
  | "folder-open"
  | "globe"
  | "hard-drive"
  | "home"
  | "info"
  | "key"
  | "keyboard"
  | "layers"
  | "layout-grid"
  | "link"
  | "list-numbers"
  | "loader"
  | "lock"
  | "lock-open"
  | "mail"
  | "maximize"
  | "minimize"
  | "minus"
  | "moon"
  | "more-horizontal"
  | "palette"
  | "panel-left"
  | "panel-left-close"
  | "panel-right"
  | "pause"
  | "pencil"
  | "play"
  | "plug-connected"
  | "plus"
  | "power"
  | "refresh"
  | "rotate-clockwise"
  | "search"
  | "send"
  | "server"
  | "settings"
  | "shield"
  | "shield-check"
  | "sparkles"
  | "star"
  | "terminal"
  | "thumbs-down"
  | "thumbs-up"
  | "trash"
  | "triangle-alert"
  | "undo"
  | "upload"
  | "user"
  | "wand"
  | "wifi"
  | "world"
  | "x"
  | "x-circle"
  | "zap"
  | "zoom-in"
  | "zoom-out";

const REICON_MAP = {
  "alert-circle": AlertCircle,
  "alert-triangle": AlertTriangle,
  "arrow-right": ArrowRight,
  "arrow-right-circle": ArrowRightCircle,
  "arrows-left-right": ArrowSwapHorizontal,
  "arrows-maximize": Expand,
  "arrows-shuffle": Shuffle,
  "arrows-up-down": Sort,
  book: Book,
  bulb: Bulb,
  calendar: Calendar,
  check: Check,
  "chevron-down": ChevronDown,
  "chevron-left": ChevronLeft,
  "chevron-right": ChevronRight,
  "chevron-up": ChevronUp,
  "circle-check": CheckCircle,
  clock: Clock,
  cloud: Cloud,
  code: Code,
  copy: Copy,
  database: Database,
  "device-floppy": Floppy,
  dots: More,
  download: Download,
  "external-link": ArrowUpRight,
  eye: Eye,
  "eye-off": EyeOff,
  "file-code": CodeFile,
  filter: Filter,
  fingerprint: Fingerprint,
  "folder-open": FolderOpen,
  globe: Globe,
  "hard-drive": Database,
  home: Home,
  info: InfoCircle,
  key: Key,
  keyboard: Keyboard,
  layers: Layers,
  "layout-grid": Grid,
  link: Link,
  "list-numbers": List,
  loader: Loader,
  lock: Lock,
  "lock-open": LockOpen,
  mail: Envelope,
  maximize: Maximize,
  minimize: Minimize,
  minus: Minus,
  moon: Moon,
  "more-horizontal": More,
  palette: Palette,
  "panel-left": SidebarLeft,
  "panel-left-close": SidebarLeft2,
  "panel-right": SidebarRight,
  pause: Pause,
  pencil: Edit,
  play: Play,
  "plug-connected": Plug,
  plus: Plus,
  power: Power,
  refresh: Refresh,
  "rotate-clockwise": RotateRight,
  search: Search,
  send: Send,
  server: Server,
  settings: Settings,
  shield: Shield,
  "shield-check": ShieldCheck,
  sparkles: Sparkles,
  star: Star,
  terminal: TerminalCircle,
  "thumbs-down": ThumbsDown,
  "thumbs-up": ThumbsUp,
  trash: Trash,
  "triangle-alert": AlertTriangle,
  undo: Undo,
  upload: Upload,
  user: User,
  wand: Wand,
  wifi: Wifi,
  world: Globe2,
  x: X,
  "x-circle": XCircle,
  zap: Bolt,
  "zoom-in": SearchPlus,
  "zoom-out": SearchMinus,
} satisfies Record<ReIconName, IconComponent>;

/** Reicon ships every icon in two weights. */
export type ReIconWeight = "Outline" | "Filled";

const DEFAULT_SIZE = 20;
const SIZE_STEP = 4;

/**
 * Resolve an icon size from Tailwind utilities, matching how `Icon` is used
 * across the app (e.g. `className="size-3.5"`, `className="size-[18px]"` or
 * `className="h-3 w-3"`). Tailwind's numeric spacing scale is 4px per step.
 */
function sizeFromClassName(className?: string): number {
  if (!className) return 0;

  const arbitrary = className.match(/(?:^|\s)(?:size|h)-\[(\d+(?:\.\d+)?)px\]/);
  if (arbitrary) return Number.parseFloat(arbitrary[1]);

  const scale = className.match(/(?:^|\s)(?:size|h)-(\d+(?:\.\d+)?)/);
  if (scale) return Number.parseFloat(scale[1]) * SIZE_STEP;

  return 0;
}

export interface ReIconProps extends Omit<SVGProps<SVGSVGElement>, "color"> {
  name: ReIconName;
  /** Icon size in pixels. Defaults to `20`, or the value implied by `className`. */
  size?: number;
  /** Icon weight. Defaults to `"Outline"`. */
  weight?: ReIconWeight;
  /** Any valid CSS color. Defaults to `currentColor`. */
  color?: string;
}

export function ReIcon({
  name,
  size,
  weight = "Outline",
  className,
  ...rest
}: ReIconProps) {
  const Component = REICON_MAP[name];
  if (!Component) return null;

  const effectiveSize = size ?? (sizeFromClassName(className) || DEFAULT_SIZE);

  // Thin strokes disappear on small icons, so scale the stroke with the size.
  // `1.5` is Reicon's own default and is passed through untouched.
  const strokeWidth = effectiveSize <= 14 ? 2 : effectiveSize <= 18 ? 1.75 : 1.5;

  return (
    <Component
      className={className}
      size={effectiveSize}
      strokeWidth={strokeWidth}
      weight={weight}
      {...rest}
    />
  );
}
