/** Pure retained compiler output; no renderer, class merger or recipe code ships to a page. */
export type NativeComponentRecipeTag='Button'|'Card'|'CardHeader'|'CardTitle'|'CardDescription'|'CardContent'|'CardFooter'|'CardAction';
export interface NativeComponentRecipe {
 sourceNode:string;
 tag:NativeComponentRecipeTag;
 /** Exact retained cn(recipe(props)) output, including the author's overriding utilities. */
 className:string;
 /** The source action button's non-author tooltip trigger preserves flex-item sizing. */
 actionWrapper?:'mutation-hint';
 attributes:Readonly<Record<string,string>>;
}
/** The retained compiler's ordinary story column, even when no outline is eligible. */
export interface NativeStoryColumn {tag:'div';attributes:{class:'mx-doc'}}
