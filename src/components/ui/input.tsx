import * as React from "react";
import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-11 w-full rounded-sm bg-elevated px-3 text-sm text-fg shadow-[var(--shadow-border)] placeholder:text-subtle",
          "transition-[box-shadow] duration-150 focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_var(--color-ring)]",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
