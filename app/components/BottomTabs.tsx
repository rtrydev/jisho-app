import type { ComponentType, SVGProps } from "react";

export type TabItem<T extends string> = {
  id: T;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;
};

export function BottomTabs<T extends string>({
  active,
  items,
  onChange,
}: {
  active: T;
  items: ReadonlyArray<TabItem<T>>;
  onChange?: (id: T) => void;
}) {
  return (
    <nav className="btab" aria-label="Primary">
      {items.map((it) => {
        const IconCmp = it.icon;
        return (
          <button
            key={it.id}
            type="button"
            className={`btab-item ${active === it.id ? "btab-active" : ""}`}
            aria-current={active === it.id ? "page" : undefined}
            onClick={() => onChange?.(it.id)}
          >
            <IconCmp size={20} />
            <span className="btab-label">{it.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
