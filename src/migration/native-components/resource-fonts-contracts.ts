/** Retained platform font inventory; only these explicit sections admit local fonts. */
export interface NativeRetainedFontManifest {
 families:Record<string,readonly {url:string}[]>;
 app:readonly {url:string}[];
 systems:Record<string,readonly {url:string}[]>;
}
