import {controlsClipPath} from './controls-regions';
import {STORY_ROOT_ID, STORY_READER_MODE_MESSAGE, STORY_SCROLL_MESSAGE} from './contract';
import {applyReaderChoice} from './reader-chrome-actions';

/** Only the created frame at the configured origin may report interactive regions. */
export function createControlsFrame(url: string) {
  const origin = new URL(url).origin;
  const frame = document.createElement('iframe');
  frame.title = 'Artifact controls';
  frame.src = url;
  frame.setAttribute('allow','fullscreen');
  Object.assign(frame.style,{position:'fixed',inset:'0',width:'100%',height:'100%',border:'0',zIndex:'2147483000',clipPath:'inset(100%)',background:'transparent'});
  document.body.append(frame);
  let releaseModal: (() => void) | undefined;
  const setModal = (modal: boolean) => {
    if (!modal) {releaseModal?.();releaseModal=undefined;return;}
    if (releaseModal) return;
    const root = document.getElementById(STORY_ROOT_ID);
    if (!root) return;
    const wasInert = root.inert;
    const focused = document.activeElement instanceof HTMLElement && root.contains(document.activeElement) ? document.activeElement : null;
    root.inert = true;
    releaseModal = () => {root.inert=wasInert;if (focused?.isConnected) focused.focus({preventScroll:true});};
  };
  const receive = (event: MessageEvent) => {
    if (event.source !== frame.contentWindow || event.origin !== origin) return;
    if (event.data?.type === STORY_READER_MODE_MESSAGE && (event.data.mode === 'light' || event.data.mode === 'dark')) {
      applyReaderChoice(window,document,event.data.mode);
      return;
    }
    if (event.data?.type === 'mx:controls:navigate' && typeof event.data.url === 'string') {
      try {const target = new URL(event.data.url);if (target.origin === location.origin) location.assign(target.href);} catch { /* Invalid navigation fails closed. */ }
      return;
    }
    if (event.data?.type !== 'mx:controls:regions') return;
    setModal(event.data.modal === true);
    frame.style.clipPath = controlsClipPath(event.data.rects,innerWidth,innerHeight);
    const inset = event.data.rightInset;
    if (typeof inset === 'number' && Number.isFinite(inset) && inset >= 0 && inset <= innerWidth / 2) {
      const root = document.getElementById(STORY_ROOT_ID);
      if (root) root.style.marginRight = `${inset}px`;
    }
  };
  const postScroll = () => frame.contentWindow?.postMessage({
    type:STORY_SCROLL_MESSAGE,
    scrollY:Math.max(0,scrollY),
    atBottom:innerHeight+Math.max(0,scrollY)>=document.documentElement.scrollHeight-4,
    gutter:Math.max(0,innerWidth-document.documentElement.clientWidth),
  },origin);
  window.addEventListener('message',receive);
  const escape = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && !event.defaultPrevented) frame.contentWindow?.postMessage({type:'mx:controls:escape'},origin);
  };
  document.addEventListener('keydown',escape);
  window.addEventListener('scroll',postScroll,{passive:true});
  window.addEventListener('resize',postScroll);
  frame.addEventListener('load',postScroll);
  return {frame, origin, dispose() {
    window.removeEventListener('message',receive);
    document.removeEventListener('keydown',escape);
    setModal(false);
    window.removeEventListener('scroll',postScroll);
    window.removeEventListener('resize',postScroll);
    frame.removeEventListener('load',postScroll);
    frame.remove();
  }};
}
