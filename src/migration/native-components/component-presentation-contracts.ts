/** Pure retained compiler output; no renderer, class merger or recipe code ships to a page. */
export type NativeComponentRecipeTag='Button'|'Card'|'CardHeader'|'CardTitle'|'CardDescription'|'CardContent'|'CardFooter'|'CardAction'|'Alert'|'AlertTitle'|'AlertDescription'|'Badge'|'Table'|'TableHeader'|'TableBody'|'TableFooter'|'TableRow'|'TableHead'|'TableCell'|'TableCaption';
export interface NativeComponentRecipe {
 sourceNode:string;
 tag:NativeComponentRecipeTag;
 /** Exact retained cn(recipe(props)) output, including the author's overriding utilities. */
 className:string;
 /** The source action button's non-author tooltip trigger preserves flex-item sizing. */
 actionWrapper?:'mutation-hint';
 /** Retained Table adds one non-source horizontal scroll container. */
 presentationWrapper?:'table-container';
 attributes:Readonly<Record<string,string>>;
}
/** The retained compiler's ordinary story column, even when no outline is eligible. */
export interface NativeStoryColumn {tag:'div';attributes:{class:'mx-doc'}}

/** Structural helper anchors are owned by the exact source button; never source comment anchors. */
export interface NativeComponentHelperIdentity {trigger:string;contents:string}
