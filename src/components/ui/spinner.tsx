import { cn } from "@/utils/tailwind"
import { Icon } from "@/components/ui/Icon"

function Spinner({
  className,
  ...props
}: Omit<React.ComponentProps<"svg">, "name">) {
  return (
    <Icon name="loader" role="status" aria-label="Loading" className={cn("size-4 animate-spin", className)} {...props} />
  )
}

export { Spinner }
