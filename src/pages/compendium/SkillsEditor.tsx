import { Brain } from 'lucide-react';
import ProficiencyEntityShell from '../../components/compendium/ProficiencyEntityShell';

export default function SkillsEditor({
  userProfile,
  hideHeader,
}: {
  userProfile: any;
  hideHeader?: boolean;
}) {
  return (
    <ProficiencyEntityShell
      userProfile={userProfile}
      table="skills"
      singular="Skill"
      plural="Skills"
      icon={Brain}
      description="Define the core skills available in your game system."
      hideHeader={hideHeader}
      backLink={{ href: '/compendium/classes', label: 'Back to Classes' }}
    />
  );
}
