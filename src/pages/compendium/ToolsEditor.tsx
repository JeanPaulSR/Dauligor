import { Hammer } from 'lucide-react';
import ProficiencyEntityShell from '../../components/compendium/ProficiencyEntityShell';

export default function ToolsEditor({
  userProfile,
  hideHeader,
}: {
  userProfile: any;
  hideHeader?: boolean;
}) {
  return (
    <ProficiencyEntityShell
      userProfile={userProfile}
      table="tools"
      singular="Tool"
      plural="Tools"
      icon={Hammer}
      description="Define the tools and instruments available in your game system."
      hideHeader={hideHeader}
      backLink={{ href: '/compendium/classes', label: 'Back to Classes' }}
      categoryFK={{
        column: 'category_id',
        referenceTable: 'toolCategories',
        label: 'Category',
      }}
    />
  );
}
