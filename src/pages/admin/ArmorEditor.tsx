import { ShieldCheck } from 'lucide-react';
import ProficiencyEntityShell from '../../components/compendium/ProficiencyEntityShell';

export default function ArmorEditor({
  userProfile,
  hideHeader,
}: {
  userProfile: any;
  hideHeader?: boolean;
}) {
  return (
    <ProficiencyEntityShell
      userProfile={userProfile}
      table="armor"
      singular="Armor"
      plural="Armor"
      icon={ShieldCheck}
      description="Define the armor available in your game system."
      hideHeader={hideHeader}
      categoryFK={{
        column: 'category_id',
        referenceTable: 'armorCategories',
        label: 'Category',
        required: true,
      }}
    />
  );
}
