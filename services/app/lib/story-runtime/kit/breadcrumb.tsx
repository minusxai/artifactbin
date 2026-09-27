/** The `breadcrumb` kit chunk (lib/story-ui/kit-chunks): loaded for the documents that draw `<Breadcrumb>`, `<BreadcrumbList>`, `<BreadcrumbItem>`, and the rest of its family. */
import { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbPage, BreadcrumbSeparator, BreadcrumbEllipsis } from '@/components/kit/breadcrumb';
import type { KitChunk } from '../kit-registry';

export const chunk: KitChunk = { faces: { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbPage, BreadcrumbSeparator, BreadcrumbEllipsis } };
