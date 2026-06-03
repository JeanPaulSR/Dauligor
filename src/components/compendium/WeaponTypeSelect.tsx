export type WeaponType = 'Melee' | 'Ranged';

export default function WeaponTypeSelect({
  value,
  onChange,
}: {
  value: WeaponType;
  onChange: (next: WeaponType) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-bold uppercase tracking-widest text-ink/45">
        Weapon Type
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as WeaponType)}
        className="w-full h-10 px-3 rounded-md border border-gold/15 bg-background/50 focus:border-gold outline-none text-sm"
      >
        <option value="Melee">Melee</option>
        <option value="Ranged">Ranged</option>
      </select>
    </div>
  );
}
