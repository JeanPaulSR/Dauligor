// The "System Images" section of the image library.
//
// These folder names live under `images/` but are managed by entity editors
// (class/subclass/article/character/source art + user avatars). The Image
// Manager hides them from the user "Image Library" tab and surfaces them under
// the read-only "System Images" tab. Editor image pickers browse exactly this
// set (via IconPickerModal's `folderAllowList`) so admins can reuse system art
// across entities without exposing the general user-upload library.
export const SYSTEM_IMAGE_FOLDERS: readonly string[] = [
  'classes',
  'subclasses',
  'lore',
  'characters',
  'sources',
  'users',
];
