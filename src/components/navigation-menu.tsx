import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  NavigationMenu as NavigationMenuBase,
  NavigationMenuItem,
  NavigationMenuList,
  navigationMenuTriggerStyle,
} from "@/components/ui/navigation-menu";
import ExternalLink from "./external-link";

export default function NavigationMenu() {
  const { t } = useTranslation();

  return (
    <NavigationMenuBase className="px-2 text-muted-foreground">
      <NavigationMenuList>
        <NavigationMenuItem>
          <Link to="/" className={navigationMenuTriggerStyle()}>
            {t("titleHomePage")}
          </Link>
        </NavigationMenuItem>
        <NavigationMenuItem>
          <Link to="/second" className={navigationMenuTriggerStyle()}>
            {t("titleSecondPage")}
          </Link>
        </NavigationMenuItem>
        <NavigationMenuItem>
          <ExternalLink
            href="https://docs.luanroger.dev/electron-shadcn"
            className={navigationMenuTriggerStyle()}
          >
            {t("documentation")}
          </ExternalLink>
        </NavigationMenuItem>
      </NavigationMenuList>
    </NavigationMenuBase>
  );
}
