export interface WeaponProperty {
  id: string;
  name: string;
  description?: string;
}

export default function WeaponPropertiesPicker({
  value,
  options,
  onChange,
}: {
  value: string[];
  options: WeaponProperty[];
  onChange: (next: string[]) => void;
}) {
  const toggle = (id: string, checked: boolean) => {
    if (checked) {
      if (value.includes(id)) return;
      onChange([...value, id]);
    } else {
      onChange(value.filter((existing) => existing !== id));
    }
  };

  return (
    <div className="space-y-2 border-t border-gold/15 pt-4 mt-2">
      <label className="text-xs font-bold uppercase tracking-widest text-ink/45 block">
        Weapon Properties
      </label>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 max-h-[150px] overflow-y-auto p-2 border border-gold/5 bg-background/30 rounded-md custom-scrollbar">
        {options.map((prop) => (
          <label
            key={prop.id}
            className="flex items-center gap-2 cursor-pointer group"
          >
            <input
              type="checkbox"
              checked={value.includes(prop.id)}
              onChange={(e) => toggle(prop.id, e.target.checked)}
              className="rounded border-gold/25 text-gold focus:ring-gold"
            />
            <span className="text-[11px] font-medium text-ink/65 group-hover:text-ink transition-colors truncate">
              {prop.name}
            </span>
          </label>
        ))}
        {options.length === 0 && (
          <p className="col-span-2 text-[10px] text-ink/45 italic py-2">
            No properties defined. Create them in the Properties tab.
          </p>
        )}
      </div>
    </div>
  );
}
