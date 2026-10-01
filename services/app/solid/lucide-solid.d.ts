/**
 * TYPE-ONLY stand-in for `import { Icon } from 'lucide-solid'`: tsconfig `paths` maps the bare
 * specifier here, while Vite, Vitest and the island build still load the real package. The package's
 * own index re-exports ~2,000 per-icon declaration files (28% of the type program); each line below
 * loads one. When tsc reports "has no exported member" for an icon, add its line
 * (`lucide-solid/icons/<kebab-name>`), or import the icon from that deep path directly.
 */
export { default as Ban } from 'lucide-solid/icons/ban';
export { default as Bell } from 'lucide-solid/icons/bell';
export { default as BookOpen } from 'lucide-solid/icons/book-open';
export { default as Box } from 'lucide-solid/icons/box';
export { default as Check } from 'lucide-solid/icons/check';
export { default as ChevronDown } from 'lucide-solid/icons/chevron-down';
export { default as ChevronRight } from 'lucide-solid/icons/chevron-right';
export { default as CircleUser } from 'lucide-solid/icons/circle-user';
export { default as Code2 } from 'lucide-solid/icons/code-2';
export { default as Copy } from 'lucide-solid/icons/copy';
export { default as Database } from 'lucide-solid/icons/database';
export { default as DatabasePlus } from 'lucide-solid/icons/database-plus';
export { default as Download } from 'lucide-solid/icons/download';
export { default as File } from 'lucide-solid/icons/file';
export { default as FileArchive } from 'lucide-solid/icons/file-archive';
export { default as FileSpreadsheet } from 'lucide-solid/icons/file-spreadsheet';
export { default as FileText } from 'lucide-solid/icons/file-text';
export { default as FileUp } from 'lucide-solid/icons/file-up';
export { default as Folder } from 'lucide-solid/icons/folder';
export { default as LayoutGrid } from 'lucide-solid/icons/layout-grid';
export { default as List } from 'lucide-solid/icons/list';
export { default as Loader2 } from 'lucide-solid/icons/loader-2';
export { default as LoaderCircle } from 'lucide-solid/icons/loader-circle';
export { default as LogIn } from 'lucide-solid/icons/log-in';
export { default as LogOut } from 'lucide-solid/icons/log-out';
export { default as Moon } from 'lucide-solid/icons/moon';
export { default as Play } from 'lucide-solid/icons/play';
export { default as Plus } from 'lucide-solid/icons/plus';
export { default as Search } from 'lucide-solid/icons/search';
export { default as Settings } from 'lucide-solid/icons/settings';
export { default as SlidersVertical } from 'lucide-solid/icons/sliders-vertical';
export { default as Sun } from 'lucide-solid/icons/sun';
export { default as User } from 'lucide-solid/icons/user';
export { default as UserRound } from 'lucide-solid/icons/user-round';
export { default as X } from 'lucide-solid/icons/x';
