/**
 * <af-isometric>: isometric illustration from keyed geometry.
 * Import:  import {registerIsometric} from './components/isometric.js'; registerIsometric();  (load the .js in the browser; this .ts is the readable contract)
 * Props: options={title,parts,...}: keyed geometry, spread/angle/flow, motion
 * Usage:
 *   document.querySelector('af-isometric').options={title:'Stack',parts:[...]};
 */
import { isometricScene, type IsoDrawPath } from "../story-ui/isometric";
import { isometricError } from "../jsx/isometric-spec";
import {
  advanceIsometric,
  isometricTarget,
  type IsometricOptions,
  type IsometricPose,
} from "./isometric-model";
export type { IsometricOptions } from "./isometric-model";
const ns = "http://www.w3.org/2000/svg";
const ink = "var(--ds-hand-ink, var(--foreground, #172033))";
const ground = "var(--ds-hand-ground, var(--card, white))";
const tones = {
  neutral: ground,
  accent: "var(--ds-hand-fill, var(--primary, #4263eb))",
  secondary: "var(--ds-hand-fill2, var(--chart-2, #0d9488))",
  muted: "var(--ds-hand-muted, var(--muted, #cbd5e1))",
};
export class AfIsometric extends HTMLElement {
  private config: IsometricOptions | undefined;
  private svg?: SVGSVGElement;
  private scene?: ReturnType<typeof isometricScene>;
  private pose: IsometricPose = { spread: 0, angle: 0 };
  private frame = 0;
  private previous = 0;
  private dash = 0;
  private visible = true;
  private observer?: IntersectionObserver;
  private reduced?: MediaQueryList;
  get options(): IsometricOptions | undefined {
    return this.config;
  }
  set options(value: IsometricOptions | undefined) {
    if (value) {
      const error = isometricError(value as unknown as Record<string, unknown>);
      if (error) throw new TypeError(error);
    }
    this.config = value;
    this.scene = value ? isometricScene(value) : undefined;
    if (this.isConnected) this.update();
  }
  connectedCallback(): void {
    if (Object.hasOwn(this, "options")) {
      const value = this.options;
      delete (this as { options?: IsometricOptions }).options;
      this.options = value;
    }
    const win = this.ownerDocument.defaultView!;
    this.reduced = win.matchMedia?.("(prefers-reduced-motion: reduce)");
    this.reduced?.addEventListener("change", this.update);
    this.ownerDocument.addEventListener("visibilitychange", this.update);
    this.observer =
      typeof win.IntersectionObserver === "function"
        ? new win.IntersectionObserver((entries) => {
            this.visible = entries.some((e) => e.isIntersecting);
            this.update();
          })
        : undefined;
    this.observer?.observe(this);
    this.update();
  }
  disconnectedCallback(): void {
    this.cancel();
    this.observer?.disconnect();
    this.reduced?.removeEventListener("change", this.update);
    this.ownerDocument.removeEventListener("visibilitychange", this.update);
  }
  private active = () =>
    this.isConnected &&
    this.visible &&
    !this.ownerDocument.hidden &&
    !this.reduced?.matches;
  private cancel(): void {
    if (this.frame)
      this.ownerDocument.defaultView!.cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.previous = 0;
  }
  private update = (): void => {
    if (!this.config || !this.scene) {
      this.cancel();
      this.svg?.remove();
      this.svg = undefined;
      return;
    }
    if (!this.active() || this.config.motion !== "smooth")
      this.pose = isometricTarget(this.config);
    if (!this.active()) {
      this.cancel();
      this.dash = 0;
    }
    this.draw();
    if (
      this.active() &&
      !this.frame &&
      (this.config.motion === "smooth" || this.config.flow)
    )
      this.frame = this.ownerDocument.defaultView!.requestAnimationFrame(
        this.tick,
      );
  };
  private tick = (now: number): void => {
    this.frame = 0;
    if (!this.config || !this.active()) {
      this.update();
      return;
    }
    const dt = this.previous
      ? Math.min((now - this.previous) / 1000, 0.05)
      : 1 / 60;
    this.previous = now;
    const target = isometricTarget(this.config);
    this.pose = advanceIsometric(
      this.pose,
      target,
      dt,
      this.config.motion === "smooth",
    );
    if (this.config.flow) this.dash = (this.dash - dt * 20) % 20;
    this.draw();
    if (this.pose !== target || this.config.flow)
      this.frame = this.ownerDocument.defaultView!.requestAnimationFrame(
        this.tick,
      );
    else this.previous = 0;
  };
  private draw(): void {
    const scene = this.scene,
      p = this.config;
    if (!scene || !p) return;
    if (!this.svg) {
      this.svg = this.ownerDocument.createElementNS(ns, "svg");
      this.svg.style.cssText = "display:block;width:100%;height:auto";
      this.svg.setAttribute("role", "img");
      this.svg.setAttribute("stroke-linejoin", "round");
      this.svg.setAttribute("stroke-linecap", "round");
      this.append(this.svg);
    }
    const svg = this.svg;
    svg.setAttribute("viewBox", `0 0 ${scene.width} ${scene.height}`);
    svg.setAttribute("aria-label", p.title);
    let title = svg.querySelector<SVGTitleElement>("title");
    if (!title) {
      title = this.ownerDocument.createElementNS(ns, "title");
      svg.prepend(title);
    }
    title.textContent = p.title;
    const retained = new Set<Element>();
    for (const part of scene.draw(this.pose.spread, this.pose.angle)) {
      let group = Array.from(svg.children).find(
        (e) => e.getAttribute("data-part") === part.key,
      ) as SVGGElement | undefined;
      if (!group) {
        group = this.ownerDocument.createElementNS(ns, "g");
        group.setAttribute("data-part", part.key);
      }
      retained.add(group);
      group.setAttribute(
        "transform",
        `translate(${part.offset[0]} ${part.offset[1]})`,
      );
      svg.append(group);
      part.paths.forEach((path, i) => {
        let node = group!.children[i] as SVGPathElement | undefined;
        if (!node) {
          node = this.ownerDocument.createElementNS(ns, "path");
          group!.append(node);
        }
        this.path(node, path, p);
      });
      while (group.children.length > part.paths.length)
        group.lastElementChild!.remove();
    }
    for (const child of Array.from(svg.children))
      if (child !== title && !retained.has(child)) child.remove();
  }
  private path(
    node: SVGPathElement,
    path: IsoDrawPath,
    p: IsometricOptions,
  ): void {
    const tone = tones[path.tone];
    const base =
      p.appearance === "solid" || path.section || path.tone === "neutral"
        ? tone
        : `color-mix(in srgb, ${tone} 18%, ${ground})`;
    const fill =
      path.kind === "face"
        ? `color-mix(in srgb, ${ink} ${path.shade * (p.appearance === "solid" ? 5 : 2)}%, ${base})`
        : "none";
    const stroke =
      path.kind === "face"
        ? fill
        : path.tone === "muted"
          ? `color-mix(in srgb, ${ink} 48%, ${ground})`
          : path.tone !== "neutral"
            ? `color-mix(in srgb, ${tone} 80%, ${ink})`
            : ink;
    for (const [key, value] of Object.entries({
      d: path.d,
      fill,
      stroke,
      "stroke-width":
        path.width ??
        (path.kind === "face" ? 0.35 : path.kind === "crease" ? 0.8 : 1.6),
      "stroke-opacity": path.opacity ?? (path.kind === "crease" ? 0.7 : 1),
      "vector-effect": "non-scaling-stroke",
      "stroke-dasharray": path.dashed ? "10 10" : "none",
      "stroke-dashoffset": path.dashed ? this.dash : 0,
    }))
      node.setAttribute(key, String(value));
  }
}
export function registerIsometric(
  registry: CustomElementRegistry = customElements,
): void {
  if (!registry.get("af-isometric"))
    registry.define("af-isometric", AfIsometric);
}
