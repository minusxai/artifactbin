import type * as React from 'react';

import {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
} from '@/components/kit/card';
import { Badge } from '@/components/kit/badge';
import { Button } from '@/components/kit/button';
import { Alert, AlertTitle, AlertDescription } from '@/components/kit/alert';
import {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
} from '@/components/kit/table';
import { Separator } from '@/components/kit/separator';
import { Skeleton } from '@/components/kit/skeleton';
import { Progress } from '@/components/kit/progress';
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
  BreadcrumbEllipsis,
} from '@/components/kit/breadcrumb';
import {
  Avatar,
  AvatarImage,
  AvatarFallback,
  AvatarBadge,
  AvatarGroup,
  AvatarGroupCount,
} from '@/components/kit/avatar';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/kit/tabs';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/kit/accordion';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/kit/collapsible';
// The one kit component that is app chrome first: it lives beside the app's
// other primitives so the reader graph never crosses into this layer for it.
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@/components/Tooltip';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverAnchor,
  PopoverHeader,
  PopoverTitle,
  PopoverDescription,
} from '@/components/kit/popover';
import { Grid, GridItem } from '@/components/kit/grid';
import { Select, Slider, DatePicker, Segmented, Switch } from '@/components/kit/controls';
import { Icon } from '@/components/kit/icon';
import { SlideDeck, Slide } from '@/components/kit/slides';
import { Video } from '@/components/kit/video';
import { File } from '@/components/kit/file';
import { DataTable } from '@/components/kit/data-table';
import { Files } from '@/components/kit/files';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const STORY_UI_COMPONENTS: Record<string, React.ComponentType<any>> = {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  CardAction,
  Badge,
  Button,
  Alert,
  AlertTitle,
  AlertDescription,
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
  Separator,
  Skeleton,
  Progress,
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
  BreadcrumbEllipsis,
  Avatar,
  AvatarImage,
  AvatarFallback,
  AvatarBadge,
  AvatarGroup,
  AvatarGroupCount,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverAnchor,
  PopoverHeader,
  PopoverTitle,
  PopoverDescription,
  Grid,
  GridItem,
  // The bound-control kit, registered as its STATIC faces (disabled, bindings
  // stamped); the runtime registry overrides them with live store adapters
  // (lib/story-runtime/StoryRuntimeApp).
  Select,
  Slider,
  DatePicker,
  Segmented,
  Switch,
  SlideDeck,
  Slide,
  Video,
  File,
  Icon,
  // The data-bound table. Registered bare for completeness; the three render
  // paths override it with an adapter that supplies the rows from the store
  // (StoryRuntimeApp / StoryJsxBody) or a placeholder (preview/inert).
  DataTable: DataTable as unknown as React.ComponentType<any>, // eslint-disable-line @typescript-eslint/no-explicit-any
  // A folder's listing. Registered bare, like DataTable, and overridden by the
  // runtime adapter that supplies its rows from the store.
  Files: Files as unknown as React.ComponentType<any>, // eslint-disable-line @typescript-eslint/no-explicit-any
};

export const STORY_UI_COMPONENT_NAMES = Object.keys(STORY_UI_COMPONENTS);
