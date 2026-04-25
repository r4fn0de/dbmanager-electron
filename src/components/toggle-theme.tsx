import { toggleTheme } from "@/actions/theme";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/Icon";

export default function ToggleTheme() {
  return (
    <Button onClick={toggleTheme} size="icon">
      <Icon name="moon" size={16} />
    </Button>
  );
}
