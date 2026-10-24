/** Author-owned zero-based selection. Empty decks expose -1 and never emit an empty selection intent. */
export interface SlideDeckChangeDetail { value: number }
export interface SlideDeckContract { index: number | undefined }
export function slideIndex(index: number, count: number): number {
  return count<=0?-1:Math.max(0,Math.min(Number.isFinite(index)?Math.floor(index):0,count-1));
}
export function slideKeyIndex(key: string, current: number, count: number): number | null {
  if(key==='Home')return slideIndex(0,count);
  if(key==='End')return slideIndex(count-1,count);
  if(key==='ArrowRight'||key==='PageDown'||key===' ')return slideIndex(current+1,count);
  if(key==='ArrowLeft'||key==='PageUp')return slideIndex(current-1,count);
  return null;
}
export function visibleSlideIndex(tops: readonly number[], mark: number): number {
  let index=tops.length?0:-1;
  tops.forEach((top,i)=>{if(top<=mark)index=i;});return index;
}
