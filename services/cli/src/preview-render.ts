/**
 * THE LOCAL EXPORT'S RENDER REQUEST — what `afbin export <file>` asks the browser for. A script document gets the
 * server exporter's policy (app/lib/export/script-origins `scriptRenderAllowance`): its module hosts admitted and its
 * component mounts (`[data-mx-mount]`) waited for, so the shot shows the components rather than their fallbacks.
 * Pure: no browser and no session here.
 */
import type {RenderCardCrop,RenderFormat,RenderRequest} from '@artifactbin/contracts';
import {CARD_WIDTH,CARD_HEIGHT,scriptModuleOrigins,scriptRenderAllowance} from '../../app/lib/cli-toolkit/host.server';

interface PreviewRenderInput {
 /** The capture session's address (preview/session `url`). */
 url:string;
 /** The document's markup as the session read it (the file's body, below its front matter). */
 source:string;
 format:RenderFormat;
 /** A deck slide, 1-based. */
 page?:number;
 /** The social card, cropped as the document asks. */
 card?:RenderCardCrop;
}

export function previewRenderRequest(input:PreviewRenderInput):RenderRequest{
 return {
  url:input.url+'/?capture=1',format:input.format,
  viewport:input.card?{width:CARD_WIDTH,height:CARD_HEIGHT}:{width:1200,height:630},
  selector:'[data-afbin-export-ready] [data-mx-story-root]',
  capture:input.page?{slide:input.page}:input.card?{card:input.card}:'full',
  sameOriginOnly:true,waitForManagedFrames:true,
  ...scriptRenderAllowance(scriptModuleOrigins(input.source)),
  timeoutMs:30000,
 };
}
