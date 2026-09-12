const NS = "http://www.w3.org/2000/svg";

let root: SVGSVGElement | null = null;

function ensureRoot(): SVGSVGElement {
  if (root && root.isConnected) return root;
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
  document.body.appendChild(svg);
  root = svg;
  return svg;
}

function el<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

/** Live backdrop lens. in=SourceGraphic is the page under the chrome, not a screenshot. */
export function upsertLens(id: string, mapHref: string, scale: number, width: number, height: number) {
  const svg = ensureRoot();
  svg.querySelector(`#${CSS.escape(id)}`)?.remove();

  const pad = Math.round(scale);
  const filter = el("filter", {
    id,
    x: String(-pad),
    y: String(-pad),
    width: String(width + pad * 2),
    height: String(height + pad * 2),
    filterUnits: "userSpaceOnUse",
    primitiveUnits: "userSpaceOnUse",
    "color-interpolation-filters": "sRGB",
  });
  const map = el("feImage", {
    href: mapHref,
    preserveAspectRatio: "none",
    result: "map",
    x: "0",
    y: "0",
    width: String(width),
    height: String(height),
  });
  map.setAttributeNS("http://www.w3.org/1999/xlink", "href", mapHref);

  const disp = el("feDisplacementMap", {
    in: "SourceGraphic",
    in2: "map",
    scale: String(scale),
    xChannelSelector: "R",
    yChannelSelector: "G",
    result: "bent",
  });

  const r = el("feOffset", { in: "bent", dx: String(-scale * 0.04), dy: "0", result: "r" });
  const b = el("feOffset", { in: "bent", dx: String(scale * 0.04), dy: "0", result: "bch" });
  const rPick = el("feColorMatrix", {
    in: "r",
    type: "matrix",
    values: "1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0",
    result: "rc",
  });
  const gPick = el("feColorMatrix", {
    in: "bent",
    type: "matrix",
    values: "0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0",
    result: "gc",
  });
  const bPick = el("feColorMatrix", {
    in: "bch",
    type: "matrix",
    values: "0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0",
    result: "bc",
  });
  const merge = el("feBlend", { in: "rc", in2: "gc", mode: "screen", result: "rg" });
  const merge2 = el("feBlend", { in: "rg", in2: "bc", mode: "screen" });

  filter.append(map, disp, r, b, rPick, gPick, bPick, merge, merge2);
  svg.appendChild(filter);
}

export function removeLens(id: string) {
  root?.querySelector(`#${CSS.escape(id)}`)?.remove();
}
