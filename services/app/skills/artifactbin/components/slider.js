// node_modules/d3-format/src/formatDecimal.js
function formatDecimal_default(x) {
  return Math.abs(x = Math.round(x)) >= 1e21 ? x.toLocaleString("en").replace(/,/g, "") : x.toString(10);
}
function formatDecimalParts(x, p) {
  if (!isFinite(x) || x === 0) return null;
  var i = (x = p ? x.toExponential(p - 1) : x.toExponential()).indexOf("e"), coefficient = x.slice(0, i);
  return [
    coefficient.length > 1 ? coefficient[0] + coefficient.slice(2) : coefficient,
    +x.slice(i + 1)
  ];
}

// node_modules/d3-format/src/exponent.js
function exponent_default(x) {
  return x = formatDecimalParts(Math.abs(x)), x ? x[1] : NaN;
}

// node_modules/d3-format/src/formatGroup.js
function formatGroup_default(grouping, thousands) {
  return function(value, width) {
    var i = value.length, t = [], j = 0, g = grouping[0], length = 0;
    while (i > 0 && g > 0) {
      if (length + g + 1 > width) g = Math.max(1, width - length);
      t.push(value.substring(i -= g, i + g));
      if ((length += g + 1) > width) break;
      g = grouping[j = (j + 1) % grouping.length];
    }
    return t.reverse().join(thousands);
  };
}

// node_modules/d3-format/src/formatNumerals.js
function formatNumerals_default(numerals) {
  return function(value) {
    return value.replace(/[0-9]/g, function(i) {
      return numerals[+i];
    });
  };
}

// node_modules/d3-format/src/formatSpecifier.js
var re = /^(?:(.)?([<>=^]))?([+\-( ])?([$#])?(0)?(\d+)?(,)?(\.\d+)?(~)?([a-z%])?$/i;
function formatSpecifier(specifier) {
  if (!(match = re.exec(specifier))) throw new Error("invalid format: " + specifier);
  var match;
  return new FormatSpecifier({
    fill: match[1],
    align: match[2],
    sign: match[3],
    symbol: match[4],
    zero: match[5],
    width: match[6],
    comma: match[7],
    precision: match[8] && match[8].slice(1),
    trim: match[9],
    type: match[10]
  });
}
formatSpecifier.prototype = FormatSpecifier.prototype;
function FormatSpecifier(specifier) {
  this.fill = specifier.fill === void 0 ? " " : specifier.fill + "";
  this.align = specifier.align === void 0 ? ">" : specifier.align + "";
  this.sign = specifier.sign === void 0 ? "-" : specifier.sign + "";
  this.symbol = specifier.symbol === void 0 ? "" : specifier.symbol + "";
  this.zero = !!specifier.zero;
  this.width = specifier.width === void 0 ? void 0 : +specifier.width;
  this.comma = !!specifier.comma;
  this.precision = specifier.precision === void 0 ? void 0 : +specifier.precision;
  this.trim = !!specifier.trim;
  this.type = specifier.type === void 0 ? "" : specifier.type + "";
}
FormatSpecifier.prototype.toString = function() {
  return this.fill + this.align + this.sign + this.symbol + (this.zero ? "0" : "") + (this.width === void 0 ? "" : Math.max(1, this.width | 0)) + (this.comma ? "," : "") + (this.precision === void 0 ? "" : "." + Math.max(0, this.precision | 0)) + (this.trim ? "~" : "") + this.type;
};

// node_modules/d3-format/src/formatTrim.js
function formatTrim_default(s) {
  out: for (var n = s.length, i = 1, i0 = -1, i1; i < n; ++i) {
    switch (s[i]) {
      case ".":
        i0 = i1 = i;
        break;
      case "0":
        if (i0 === 0) i0 = i;
        i1 = i;
        break;
      default:
        if (!+s[i]) break out;
        if (i0 > 0) i0 = 0;
        break;
    }
  }
  return i0 > 0 ? s.slice(0, i0) + s.slice(i1 + 1) : s;
}

// node_modules/d3-format/src/formatPrefixAuto.js
var prefixExponent;
function formatPrefixAuto_default(x, p) {
  var d = formatDecimalParts(x, p);
  if (!d) return prefixExponent = void 0, x.toPrecision(p);
  var coefficient = d[0], exponent = d[1], i = exponent - (prefixExponent = Math.max(-8, Math.min(8, Math.floor(exponent / 3))) * 3) + 1, n = coefficient.length;
  return i === n ? coefficient : i > n ? coefficient + new Array(i - n + 1).join("0") : i > 0 ? coefficient.slice(0, i) + "." + coefficient.slice(i) : "0." + new Array(1 - i).join("0") + formatDecimalParts(x, Math.max(0, p + i - 1))[0];
}

// node_modules/d3-format/src/formatRounded.js
function formatRounded_default(x, p) {
  var d = formatDecimalParts(x, p);
  if (!d) return x + "";
  var coefficient = d[0], exponent = d[1];
  return exponent < 0 ? "0." + new Array(-exponent).join("0") + coefficient : coefficient.length > exponent + 1 ? coefficient.slice(0, exponent + 1) + "." + coefficient.slice(exponent + 1) : coefficient + new Array(exponent - coefficient.length + 2).join("0");
}

// node_modules/d3-format/src/formatTypes.js
var formatTypes_default = {
  "%": (x, p) => (x * 100).toFixed(p),
  "b": (x) => Math.round(x).toString(2),
  "c": (x) => x + "",
  "d": formatDecimal_default,
  "e": (x, p) => x.toExponential(p),
  "f": (x, p) => x.toFixed(p),
  "g": (x, p) => x.toPrecision(p),
  "o": (x) => Math.round(x).toString(8),
  "p": (x, p) => formatRounded_default(x * 100, p),
  "r": formatRounded_default,
  "s": formatPrefixAuto_default,
  "X": (x) => Math.round(x).toString(16).toUpperCase(),
  "x": (x) => Math.round(x).toString(16)
};

// node_modules/d3-format/src/identity.js
function identity_default(x) {
  return x;
}

// node_modules/d3-format/src/locale.js
var map = Array.prototype.map;
var prefixes = ["y", "z", "a", "f", "p", "n", "\xB5", "m", "", "k", "M", "G", "T", "P", "E", "Z", "Y"];
function locale_default(locale2) {
  var group = locale2.grouping === void 0 || locale2.thousands === void 0 ? identity_default : formatGroup_default(map.call(locale2.grouping, Number), locale2.thousands + ""), currencyPrefix = locale2.currency === void 0 ? "" : locale2.currency[0] + "", currencySuffix = locale2.currency === void 0 ? "" : locale2.currency[1] + "", decimal = locale2.decimal === void 0 ? "." : locale2.decimal + "", numerals = locale2.numerals === void 0 ? identity_default : formatNumerals_default(map.call(locale2.numerals, String)), percent = locale2.percent === void 0 ? "%" : locale2.percent + "", minus = locale2.minus === void 0 ? "\u2212" : locale2.minus + "", nan = locale2.nan === void 0 ? "NaN" : locale2.nan + "";
  function newFormat(specifier, options) {
    specifier = formatSpecifier(specifier);
    var fill = specifier.fill, align = specifier.align, sign = specifier.sign, symbol = specifier.symbol, zero = specifier.zero, width = specifier.width, comma = specifier.comma, precision = specifier.precision, trim = specifier.trim, type = specifier.type;
    if (type === "n") comma = true, type = "g";
    else if (!formatTypes_default[type]) precision === void 0 && (precision = 12), trim = true, type = "g";
    if (zero || fill === "0" && align === "=") zero = true, fill = "0", align = "=";
    var prefix = (options && options.prefix !== void 0 ? options.prefix : "") + (symbol === "$" ? currencyPrefix : symbol === "#" && /[boxX]/.test(type) ? "0" + type.toLowerCase() : ""), suffix = (symbol === "$" ? currencySuffix : /[%p]/.test(type) ? percent : "") + (options && options.suffix !== void 0 ? options.suffix : "");
    var formatType = formatTypes_default[type], maybeSuffix = /[defgprs%]/.test(type);
    precision = precision === void 0 ? 6 : /[gprs]/.test(type) ? Math.max(1, Math.min(21, precision)) : Math.max(0, Math.min(20, precision));
    function format2(value) {
      var valuePrefix = prefix, valueSuffix = suffix, i, n, c;
      if (type === "c") {
        valueSuffix = formatType(value) + valueSuffix;
        value = "";
      } else {
        value = +value;
        var valueNegative = value < 0 || 1 / value < 0;
        value = isNaN(value) ? nan : formatType(Math.abs(value), precision);
        if (trim) value = formatTrim_default(value);
        if (valueNegative && +value === 0 && sign !== "+") valueNegative = false;
        valuePrefix = (valueNegative ? sign === "(" ? sign : minus : sign === "-" || sign === "(" ? "" : sign) + valuePrefix;
        valueSuffix = (type === "s" && !isNaN(value) && prefixExponent !== void 0 ? prefixes[8 + prefixExponent / 3] : "") + valueSuffix + (valueNegative && sign === "(" ? ")" : "");
        if (maybeSuffix) {
          i = -1, n = value.length;
          while (++i < n) {
            if (c = value.charCodeAt(i), 48 > c || c > 57) {
              valueSuffix = (c === 46 ? decimal + value.slice(i + 1) : value.slice(i)) + valueSuffix;
              value = value.slice(0, i);
              break;
            }
          }
        }
      }
      if (comma && !zero) value = group(value, Infinity);
      var length = valuePrefix.length + value.length + valueSuffix.length, padding = length < width ? new Array(width - length + 1).join(fill) : "";
      if (comma && zero) value = group(padding + value, padding.length ? width - valueSuffix.length : Infinity), padding = "";
      switch (align) {
        case "<":
          value = valuePrefix + value + valueSuffix + padding;
          break;
        case "=":
          value = valuePrefix + padding + value + valueSuffix;
          break;
        case "^":
          value = padding.slice(0, length = padding.length >> 1) + valuePrefix + value + valueSuffix + padding.slice(length);
          break;
        default:
          value = padding + valuePrefix + value + valueSuffix;
          break;
      }
      return numerals(value);
    }
    format2.toString = function() {
      return specifier + "";
    };
    return format2;
  }
  function formatPrefix2(specifier, value) {
    var e = Math.max(-8, Math.min(8, Math.floor(exponent_default(value) / 3))) * 3, k = Math.pow(10, -e), f = newFormat((specifier = formatSpecifier(specifier), specifier.type = "f", specifier), { suffix: prefixes[8 + e / 3] });
    return function(value2) {
      return f(k * value2);
    };
  }
  return {
    format: newFormat,
    formatPrefix: formatPrefix2
  };
}

// node_modules/d3-format/src/defaultLocale.js
var locale;
var format;
var formatPrefix;
defaultLocale({
  thousands: ",",
  grouping: [3],
  currency: ["$", ""]
});
function defaultLocale(definition) {
  locale = locale_default(definition);
  format = locale.format;
  formatPrefix = locale.formatPrefix;
  return locale;
}

// services/app/lib/html-components/slider.ts
function numeric(value) {
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
var nextId = 0;
var AfSlider = class extends HTMLElement {
  static observedAttributes = ["value", "default-value", "min", "max", "step", "label", "format", "prefix", "suffix", "disabled", "readonly"];
  initialized = false;
  controlled = false;
  propertyValue = null;
  selection = null;
  input;
  labelElement;
  readout;
  get value() {
    if (this.controlled) return this.propertyValue;
    if (this.hasAttribute("value")) return numeric(this.getAttribute("value"));
    return this.selection;
  }
  set value(value) {
    this.controlled = true;
    this.propertyValue = typeof value === "number" && Number.isFinite(value) ? value : null;
    this.sync();
  }
  connectedCallback() {
    if (Object.prototype.hasOwnProperty.call(this, "value")) {
      const value = this.value;
      delete this.value;
      this.value = value;
    }
    if (!this.initialized) {
      this.selection = numeric(this.getAttribute("default-value"));
      this.initialized = true;
    }
    this.ensureParts();
    this.input?.addEventListener("input", this.onInput);
    this.sync();
  }
  disconnectedCallback() {
    this.input?.removeEventListener("input", this.onInput);
  }
  attributeChangedCallback() {
    this.sync();
  }
  ensureParts() {
    this.input ??= this.querySelector('input[type="range"]') ?? void 0;
    if (!this.input) {
      this.input = this.ownerDocument.createElement("input");
      this.input.type = "range";
      this.append(this.input);
    }
    if (!this.input.id) {
      let id;
      do {
        id = `af-slider-${++nextId}`;
      } while (this.ownerDocument.getElementById(id));
      this.input.id = id;
    }
    this.labelElement = this.querySelector("label") ?? void 0;
    if (!this.labelElement) {
      this.labelElement = this.ownerDocument.createElement("label");
      this.prepend(this.labelElement);
    }
    this.labelElement.htmlFor = this.input.id;
    this.readout = this.querySelector('[part="readout"]') ?? void 0;
    if (!this.readout) {
      this.readout = this.ownerDocument.createElement("output");
      this.readout.setAttribute("part", "readout");
      this.append(this.readout);
    }
  }
  onInput = () => {
    const input = this.input;
    if (!input) return;
    if (this.hasAttribute("disabled") || this.hasAttribute("readonly")) {
      this.sync();
      return;
    }
    const value = input.valueAsNumber;
    if (!Number.isFinite(value) || value === this.value) {
      this.sync();
      return;
    }
    const change = new CustomEvent("af-change", { detail: { value }, bubbles: true, composed: true, cancelable: true });
    if (this.dispatchEvent(change) && !this.controlled && !this.hasAttribute("value")) this.selection = value;
    this.sync();
  };
  sync() {
    if (!this.isConnected) return;
    this.ensureParts();
    const input = this.input;
    input.min = this.getAttribute("min") ?? "0";
    input.max = this.getAttribute("max") ?? "100";
    input.step = this.getAttribute("step") ?? "1";
    input.disabled = this.hasAttribute("disabled");
    input.readOnly = this.hasAttribute("readonly");
    const value = this.value;
    const min = Number.isFinite(Number(input.min)) ? Number(input.min) : 0;
    input.value = String(value ?? min);
    this.labelElement.htmlFor = input.id;
    if (this.hasAttribute("label")) this.labelElement.textContent = this.getAttribute("label") ?? "";
    this.readout.textContent = value === null ? "\u2014" : `${this.getAttribute("prefix") ?? ""}${this.formatValue(value)}${this.getAttribute("suffix") ?? ""}`;
  }
  formatValue(value) {
    const spec = this.getAttribute("format");
    if (!spec) return String(value);
    try {
      return format(spec)(value);
    } catch {
      return String(value);
    }
  }
};
var sliderStyles = `
af-slider{display:inline-flex;flex-direction:column;gap:.375rem;min-width:12rem;font:inherit;color:inherit}
af-slider>label{font-size:.875rem;line-height:1.25rem}
af-slider>input[type=range]{width:100%;accent-color:var(--primary,currentColor)}
af-slider>input[type=range]:disabled{opacity:.55}
af-slider>[part=readout]{align-self:flex-end;font-variant-numeric:tabular-nums;font-size:.875rem}
`;
function registerSlider(registry = customElements, document = globalThis.document) {
  if (!document.querySelector("style[data-af-slider-styles]")) {
    const style = document.createElement("style");
    style.setAttribute("data-af-slider-styles", "");
    style.textContent = sliderStyles;
    document.head.append(style);
  }
  if (!registry.get("af-slider")) registry.define("af-slider", AfSlider);
}
export {
  AfSlider,
  registerSlider
};
