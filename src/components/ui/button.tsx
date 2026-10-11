import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "hit-shine inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-semibold transition-[color,background-color,box-shadow,transform,opacity] duration-150 ease-out focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 active:not-disabled:scale-[0.98]",
  {
    variants: {
      variant: {
        default: "bg-accent text-accent-fg hover:bg-accent/90",
        secondary:
          "bg-surface text-fg shadow-[var(--shadow-border)] hover:shadow-[var(--shadow-border-hover)]",
        outline:
          "bg-surface text-fg shadow-[var(--shadow-border)] hover:shadow-[var(--shadow-border-hover)]",
        ghost: "text-muted hover:bg-fg/5 hover:text-fg",
        destructive: "bg-rust-soft text-rust hover:bg-rust/20",
      },
      size: {
        default: "h-11 px-4",
        sm: "h-9 px-3.5 text-[13px]",
        lg: "h-12 px-5",
        icon: "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
