import * as React from "react";
import { Slot } from "@radix-ui/react-slot";

const CollapsibleContext = React.createContext(null);

function useCollapsibleContext() {
  const context = React.useContext(CollapsibleContext);
  if (!context) {
    throw new Error("Collapsible components must be used within <Collapsible>.");
  }
  return context;
}

const Collapsible = ({ open = false, onOpenChange, children, ...props }) => (
  <CollapsibleContext.Provider value={{ open, onOpenChange }}>
    <div data-state={open ? "open" : "closed"} {...props}>
      {children}
    </div>
  </CollapsibleContext.Provider>
);

const CollapsibleTrigger = React.forwardRef(
  ({ asChild = false, onClick, ...props }, ref) => {
    const { open, onOpenChange } = useCollapsibleContext();
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        type={asChild ? undefined : "button"}
        aria-expanded={open}
        data-state={open ? "open" : "closed"}
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented) {
            onOpenChange?.(!open);
          }
        }}
        {...props}
      />
    );
  }
);
CollapsibleTrigger.displayName = "CollapsibleTrigger";

const CollapsibleContent = React.forwardRef(({ forceMount = false, ...props }, ref) => {
  const { open } = useCollapsibleContext();
  if (!forceMount && !open) {
    return null;
  }
  return <div ref={ref} hidden={!open} data-state={open ? "open" : "closed"} {...props} />;
});
CollapsibleContent.displayName = "CollapsibleContent";

export { Collapsible, CollapsibleContent, CollapsibleTrigger };
