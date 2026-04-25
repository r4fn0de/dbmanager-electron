import React from "react";
import {
  IconAlertCircle,
  IconAlertTriangle,
  IconArrowsShuffle,
  IconArrowsLeftRight,
  IconArrowsMaximize,
  IconArrowsUpDown,
  IconArrowRightCircle,
  IconBolt,
  IconBook,
  IconRobot,
  IconBrain,
  IconBraces,
  IconCalendar,
  IconChevronLeft,
  IconChevronRight,
  IconChevronDown,
  IconChevronUp,
  IconCheck,
  IconCircleCheck,
  IconCircleX,
  IconClock,
  IconCode,
  IconColumns3,
  IconCopy,
  IconDots,
  IconDatabase,
  IconDeviceFloppy,
  IconDice5,
  IconDownload,
  IconExternalLink,
  IconEye,
  IconEyeOff,
  IconFilter,
  IconFileCode,
  IconFileCode2,
  IconFileSearch,
  IconFingerprint,
  IconFolderOpen,
  IconGlobe,
  IconHome,
  IconInfoCircle,
  IconKeyboard,
  IconKey,
  IconBulb,
  IconLayoutGrid,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconLayoutSidebarRight,
  IconLayersIntersect,
  IconLink,
  IconListNumbers,
  IconLoader2,
  IconLock,
  IconLockOpen,
  IconMail,
  IconMaximize,
  IconMaximizeOff,
  IconMinimize,
  IconMinus,
  IconMoon,
  IconPalette,
  IconPencil,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlugConnected,
  IconPlus,
  IconPower,
  IconRefresh,
  IconRotateClockwise,
  IconScript,
  IconSearch,
  IconSend,
  IconServer,
  IconShield,
  IconSparkles,
  IconSquare,
  IconStar,
  IconTable,
  IconTerminal,
  IconSettings,
  IconThumbDown,
  IconThumbUp,
  IconTopologyStar3,
  IconTrash,
  IconUpload,
  IconUser,
  IconWand,
  IconWifi,
  IconX,
  IconZoomIn,
  IconZoomOut,
  IconArrowBackUp,
} from "@tabler/icons-react";

export type IconName =
  | "alert-circle"
  | "alert-triangle"
  | "arrows-left-right"
  | "arrows-maximize"
  | "arrows-up-down"
  | "arrow-right-circle"
  | "book"
  | "bot"
  | "brain"
  | "bulb"
  | "calendar"
  | "braces"
  | "chevron-down"
  | "chevron-up"
  | "chevron-left"
  | "chevron-right"
  | "check"
  | "circle-check"
  | "code"
  | "clock"
  | "columns-3"
  | "copy"
  | "dots"
  | "database"
  | "device-floppy"
  | "dice"
  | "download"
  | "external-link"
  | "eye"
  | "eye-off"
  | "filter"
  | "file-code"
  | "file-code-2"
  | "file-search"
  | "fingerprint"
  | "folder-open"
  | "globe"
  | "hard-drive"
  | "home"
  | "info"
  | "keyboard"
  | "key"
  | "layout-grid"
  | "layout-sidebar-left-collapse"
  | "layout-sidebar-left-expand"
  | "layout-sidebar-right"
  | "layers"
  | "link"
  | "list-numbers"
  | "loader"
  | "lock"
  | "lock-open"
  | "mail"
  | "maximize"
  | "maximize-off"
  | "minimize"
  | "minus"
  | "more-horizontal"
  | "moon"
  | "palette"
  | "panel-right"
  | "panel-left"
  | "panel-left-close"
  | "pause"
  | "pencil"
  | "play"
  | "plug-connected"
  | "plus"
  | "power"
  | "power-off"
  | "refresh"
  | "rotate-clockwise"
  | "script"
  | "search"
  | "send"
  | "server"
  | "shield"
  | "square"
  | "star"
  | "thumbs-down"
  | "thumbs-up"
  | "table"
  | "terminal"
  | "settings"
  | "shuffle"
  | "sparkles"
  | "trash"
  | "upload"
  | "user"
  | "wand"
  | "wifi"
  | "undo"
  | "x"
  | "x-circle"
  | "zoom-in"
  | "zoom-out"
  | "zap";

type IconComponent = React.ComponentType<
  React.SVGProps<SVGSVGElement> & { size?: string | number }
>;

const ICON_MAP: Record<IconName, IconComponent> = {
  braces: IconBraces,
  "alert-circle": IconAlertCircle,
  "alert-triangle": IconAlertTriangle,
  "arrows-left-right": IconArrowsLeftRight,
  "arrows-maximize": IconArrowsMaximize,
  "arrows-up-down": IconArrowsUpDown,
  "arrow-right-circle": IconArrowRightCircle,
  book: IconBook,
  bot: IconRobot,
  brain: IconBrain,
  bulb: IconBulb,
  calendar: IconCalendar,
  "chevron-down": IconChevronDown,
  "chevron-up": IconChevronUp,
  "chevron-left": IconChevronLeft,
  "chevron-right": IconChevronRight,
  check: IconCheck,
  "circle-check": IconCircleCheck,
  clock: IconClock,
  code: IconCode,
  "columns-3": IconColumns3,
  copy: IconCopy,
  dots: IconDots,
  database: IconDatabase,
  "device-floppy": IconDeviceFloppy,
  dice: IconDice5,
  download: IconDownload,
  "external-link": IconExternalLink,
  eye: IconEye,
  "eye-off": IconEyeOff,
  filter: IconFilter,
  "file-code": IconFileCode,
  "file-code-2": IconFileCode2,
  "file-search": IconFileSearch,
  fingerprint: IconFingerprint,
  "folder-open": IconFolderOpen,
  globe: IconGlobe,
  "hard-drive": IconDatabase,
  home: IconHome,
  info: IconInfoCircle,
  keyboard: IconKeyboard,
  key: IconKey,
  "layout-grid": IconLayoutGrid,
  "layout-sidebar-left-collapse": IconLayoutSidebarLeftCollapse,
  "layout-sidebar-left-expand": IconLayoutSidebarLeftExpand,
  "layout-sidebar-right": IconLayoutSidebarRight,
  layers: IconLayersIntersect,
  link: IconLink,
  "list-numbers": IconListNumbers,
  loader: IconLoader2,
  lock: IconLock,
  "lock-open": IconLockOpen,
  mail: IconMail,
  maximize: IconMaximize,
  "maximize-off": IconMaximizeOff,
  minimize: IconMinimize,
  minus: IconMinus,
  "more-horizontal": IconDots,
  moon: IconMoon,
  palette: IconPalette,
  "panel-right": IconLayoutSidebarRight,
  "panel-left": IconLayoutSidebarLeftExpand,
  "panel-left-close": IconLayoutSidebarLeftCollapse,
  pause: IconPlayerPause,
  pencil: IconPencil,
  play: IconPlayerPlay,
  "plug-connected": IconPlugConnected,
  plus: IconPlus,
  power: IconPower,
  "power-off": IconPower,
  refresh: IconRefresh,
  "rotate-clockwise": IconRotateClockwise,
  script: IconScript,
  search: IconSearch,
  send: IconSend,
  server: IconServer,
  shield: IconShield,
  square: IconSquare,
  star: IconStar,
  "thumbs-down": IconThumbDown,
  "thumbs-up": IconThumbUp,
  table: IconTable,
  terminal: IconTerminal,
  settings: IconSettings,
  shuffle: IconArrowsShuffle,
  sparkles: IconSparkles,
  trash: IconTrash,
  upload: IconUpload,
  user: IconUser,
  wand: IconWand,
  wifi: IconWifi,
  undo: IconArrowBackUp,
  x: IconX,
  "x-circle": IconCircleX,
  "zoom-in": IconZoomIn,
  "zoom-out": IconZoomOut,
  zap: IconBolt,
};

export function Icon({
  name,
  size = 20,
  className,
  ...rest
}: {
  name: IconName;
  size?: number;
  className?: string;
} & React.SVGProps<SVGSVGElement>) {
  const Component = ICON_MAP[name];
  if (!Component) return null;
  return <Component size={size} className={className} {...rest} />;
}
