import React from 'react';
import { IconHome, IconUser, IconSettings, IconCalendar, IconMail, IconKeyboard, IconPalette, IconSparkles } from '@tabler/icons-react';

type IconName = 'home' | 'user' | 'settings' | 'calendar' | 'mail' | 'keyboard' | 'palette' | 'sparkles';
type IconComponent = React.ComponentType<any>;

const ICON_MAP: Record<IconName, IconComponent> = {
  home: IconHome,
  user: IconUser,
  settings: IconSettings,
  calendar: IconCalendar,
  mail: IconMail,
  keyboard: IconKeyboard,
  palette: IconPalette,
  sparkles: IconSparkles,
};

export function Icon({ name, size = 20, className, ...rest }: { name: IconName; size?: number; className?: string } & React.SVGProps<SVGSVGElement>) {
  const Component = ICON_MAP[name];
  if (!Component) return null;
  return <Component size={size} className={className} {...rest} />;
}
