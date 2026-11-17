/**
 * EVERY PAGE A BROWSER GATE BUILDS AND EVERY BODY IT PUBLISHES, read from the gate scripts without running them.
 *
 * Gates run only on main, so a product change a gate depends on reached main untested more than once: #1200 left two
 * gates publishing a GraphQL mutation the publish check then refused, and #1263 left a fixture page with a script
 * syntax error and a fixture importing a retired hosted component. This module lets pr fast check those inputs with no
 * browser and no server: scripts/__tests__/gate-pages.test.mjs parses each page's scripts and checks what they import,
 * and services/app/__tests__/gate-publish.test.ts sends each body through the real publish handlers.
 *
 * Starting from the manifest's gates (scripts/gates.manifest.mjs), it follows their relative imports to every module a
 * gate runs and parses each with acorn (none is imported to be read: a gate runs on import). It finds
 *   - publish sites: an object literal with a content field (`CONTENT_FIELDS`, or a folder) sent to a create or
 *     replace route (`/api/artifacts`, `/api/my/artifacts`, `/api/artifacts/<id>`), named in the call or in the helper
 *     the call goes through; a body built from a helper's parameters is evaluated once per call of that helper;
 *   - pages: every string or template literal under scripts/ holding a complete `<script>` element or an HTML
 *     document, taken with the concatenation or template it sits in.
 * Each is EVALUATED from its own source: the expression and the declarations it reaches (constants, functions, awaited
 * values, imports from side-effect-free modules, packages and safe builtins), each run only when reached; anything known
 * only at run time (a parameter no call fills, a loop variable, a name assigned later, a request nobody answers) is a
 * placeholder that reads as the caller's `placeholder` string (0 as a number) wherever it is used. A request goes only
 * to the caller's `serve` (the replay answers publishes in process), never to a network; nothing evaluated may start a
 * browser, a server or a process, and `process` is the module's own argv with an empty environment.
 * Used by: scripts/__tests__/gate-pages.test.mjs, scripts/__tests__/gate-labels.test.mjs (`gateModules`),
 * services/app/__tests__/gate-publish.test.ts.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { builtinModules } from 'node:module';
import { parse } from 'acorn';
import { GATE_SPECS } from '../gates.manifest.mjs';

const PARSE = { ecmaVersion: 'latest', sourceType: 'module', allowAwaitOutsideFunction: true, allowHashBang: true, allowReturnOutsideFunction: true, locations: true };
/** The publish body fields that carry content (lib/publish parseContentInput): one of them makes a body a publish. */
const CONTENT_FIELDS = Object.freeze(['html', 'dataset', 'image', 'file', 'pdf', 'viz', 'sheetUrl', 'csvUrl']);
const BUILTINS = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
/** Builtins evaluated code may use for real: no sockets, servers, processes or workers. */
const SAFE_BUILTINS = new Set(['fs', 'fs/promises', 'path', 'url', 'crypto', 'zlib', 'buffer', 'util', 'os', 'assert', 'assert/strict', 'module', 'querystring', 'string_decoder', 'stream', 'events', 'timers/promises'].flatMap((name) => [name, `node:${name}`]));
/** Packages evaluated code never loads: a browser engine or a module loader hook. */
const REFUSED_PACKAGES = /^(?:playwright|tsx)(?:\/|$)/;
const AsyncFunction = (async () => {}).constructor;
/** Calls that hand a value to a page in a browser rather than to a server. */
const BROWSER_CALLS = Object.freeze(['evaluate', 'evaluateHandle', 'addInitScript', 'postMessage', 'exposeBinding', 'exposeFunction']);
const PAGE = /<script\b[^>]*>[\s\S]*?<\/script>|<!doctype html|<html[\s>]/i;

/** Every child node of `node`, in source order. */
function children(node) {
  const out = [];
  for (const key of Object.keys(node)) {
    if (key === 'parent' || key.startsWith('__')) continue;
    const value = node[key];
    if (Array.isArray(value)) { for (const item of value) if (item && typeof item.type === 'string') out.push(item); }
    else if (value && typeof value.type === 'string') out.push(value);
  }
  return out;
}
function* walk(node) { yield node; for (const child of children(node)) yield* walk(child); }
const within = (node, outer) => node.start >= outer.start && node.end <= outer.end;
function containsAwait(node) {
  if (node.type === 'AwaitExpression' || node.type === 'YieldExpression') return true;
  if (/Function/.test(node.type)) return false;
  return children(node).some(containsAwait);
}
/** The text of a string or template literal (`${}` for each hole), or null. */
function literalText(node) {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node?.type === 'TemplateLiteral') return node.quasis.map((q) => q.value.cooked ?? q.value.raw).join('${}');
  return null;
}
const keyName = (prop) => prop.type === 'Property' && !prop.computed ? (prop.key.type === 'Identifier' ? prop.key.name : prop.key.value) : undefined;

class Scope {
  constructor(parent, isFunction) { this.parent = parent; this.fn = isFunction || !parent ? this : parent.fn; this.names = new Map(); }
  resolve(name) { for (let scope = this; scope; scope = scope.parent) if (scope.names.has(name)) return scope.names.get(name); return null; }
}

/** One parsed module: its declarations, every identifier reference resolved to one, and a parent link on every node. */
class Module {
  constructor(file, source) {
    this.file = file;
    this.source = source;
    this.ast = parse(source, PARSE);
    this.refs = [];
    this.program = new Scope(null, true);
    this.visit(this.ast, this.program, null);
    for (const ref of this.refs) {
      ref.decl = ref.scope.resolve(ref.node.name);
      if (ref.node.__write && ref.decl) ref.decl.reassigned = true;
    }
    // Indexes: every node in source order, the references by position and by node.
    this.nodes = [];
    for (const stack = [this.ast]; stack.length;) { const node = stack.pop(); this.nodes.push(node); stack.push(...children(node).reverse()); }
    this.refs.sort((a, b) => a.node.start - b.node.start);
    this.refOf = new Map(this.refs.map((ref) => [ref.node, ref]));
  }

  /** The items of a list sorted by `start(item)` that sit within `range`. */
  static within(list, start, range) {
    let low = 0;
    let high = list.length;
    while (low < high) { const mid = (low + high) >> 1; if (start(list[mid]) < range.start) low = mid + 1; else high = mid; }
    const out = [];
    for (let i = low; i < list.length && start(list[i]) < range.end; i += 1) out.push(list[i]);
    return out;
  }

  /** Every node within `range` (itself included). */
  between(range) { return Module.within(this.nodes, (node) => node.start, range).filter((node) => node.end <= range.end); }

  /** Every identifier reference within `range`. */
  refsIn(range) { return Module.within(this.refs, (ref) => ref.node.start, range).filter((ref) => ref.node.end <= range.end); }

  declare(scope, id, kind, owner) {
    const decl = { name: id.name, kind, id, owner, module: this };
    scope.names.set(id.name, decl);
    id.__binding = true;
    id.__decl = decl;
    return decl;
  }

  bind(pattern, scope, kind, owner, parent) {
    pattern.parent = parent;
    switch (pattern.type) {
      case 'Identifier': this.declare(scope, pattern, kind, owner); return;
      case 'ObjectPattern':
        for (const prop of pattern.properties) {
          prop.parent = pattern;
          if (prop.type === 'RestElement') { this.bind(prop.argument, scope, kind, owner, prop); continue; }
          if (prop.computed) this.visit(prop.key, scope, prop);
          if (prop.shorthand) (prop.value.type === 'AssignmentPattern' ? prop.value.left : prop.value).__shorthand = true;
          this.bind(prop.value, scope, kind, owner, prop);
        }
        return;
      case 'ArrayPattern': for (const element of pattern.elements) if (element) this.bind(element, scope, kind, owner, pattern); return;
      case 'RestElement': this.bind(pattern.argument, scope, kind, owner, pattern); return;
      case 'AssignmentPattern': this.bind(pattern.left, scope, kind, owner, pattern); this.visit(pattern.right, scope, pattern); return;
      default: this.visit(pattern, scope, parent);
    }
  }

  fn(node, scope) {
    const inner = new Scope(scope, true);
    if (node.type === 'FunctionExpression' && node.id) this.declare(inner, node.id, 'self', node);
    for (const param of node.params) this.bind(param, inner, 'param', node, node);
    if (node.body.type === 'BlockStatement') { node.body.parent = node; for (const statement of node.body.body) this.visit(statement, inner, node.body); }
    else this.visit(node.body, inner, node);
  }

  visit(node, scope, parent) {
    node.parent = parent;
    switch (node.type) {
      case 'ImportDeclaration':
        for (const spec of node.specifiers) { spec.parent = node; this.declare(this.program, spec.local, 'import', spec); }
        return;
      case 'VariableDeclaration':
        for (const declarator of node.declarations) {
          declarator.parent = node;
          this.bind(declarator.id, node.kind === 'var' ? scope.fn : scope, node.kind, declarator, declarator);
          if (declarator.init) this.visit(declarator.init, scope, declarator);
        }
        return;
      case 'FunctionDeclaration': if (node.id) this.declare(scope, node.id, 'function', node); this.fn(node, scope); return;
      case 'FunctionExpression': case 'ArrowFunctionExpression': this.fn(node, scope); return;
      case 'ClassDeclaration': case 'ClassExpression':
        if (node.id) this.declare(scope, node.id, node.type === 'ClassDeclaration' ? 'class' : 'self', node);
        if (node.superClass) this.visit(node.superClass, scope, node);
        node.body.parent = node;
        for (const member of node.body.body) this.visit(member, scope, node.body);
        return;
      case 'BlockStatement': case 'StaticBlock': { const inner = new Scope(scope, false); for (const statement of node.body) this.visit(statement, inner, node); return; }
      case 'ForStatement': case 'ForInStatement': case 'ForOfStatement': {
        const inner = new Scope(scope, false);
        for (const key of ['init', 'left']) {
          const part = node[key];
          if (!part) continue;
          if (part.type !== 'VariableDeclaration') { this.visit(part, inner, node); continue; }
          part.parent = node;
          for (const declarator of part.declarations) {
            declarator.parent = part;
            this.bind(declarator.id, inner, 'loop', declarator, declarator);
            if (declarator.init) this.visit(declarator.init, inner, declarator);
          }
        }
        for (const key of ['test', 'update', 'right', 'body']) if (node[key]) this.visit(node[key], inner, node);
        return;
      }
      case 'CatchClause': {
        const inner = new Scope(scope, false);
        if (node.param) this.bind(node.param, inner, 'catch', node, node);
        node.body.parent = node;
        for (const statement of node.body.body) this.visit(statement, inner, node.body);
        return;
      }
      case 'SwitchStatement': { this.visit(node.discriminant, scope, node); const inner = new Scope(scope, false); for (const c of node.cases) this.visit(c, inner, node); return; }
      case 'Identifier': this.refs.push({ node, scope }); return;
      case 'AssignmentExpression': case 'UpdateExpression': {
        // A name assigned after its declaration holds a run-time value, whatever it was declared with.
        const target = node.type === 'AssignmentExpression' ? node.left : node.argument;
        const mark = (n) => {
          if (!n) return;
          if (n.type === 'Identifier') n.__write = true;
          else if (n.type === 'ObjectPattern') n.properties.forEach((prop) => mark(prop.type === 'RestElement' ? prop.argument : prop.value));
          else if (n.type === 'ArrayPattern') n.elements.forEach(mark);
          else if (n.type === 'AssignmentPattern') mark(n.left);
          else if (n.type === 'RestElement') mark(n.argument);
        };
        mark(target);
        for (const child of children(node)) this.visit(child, scope, node);
        return;
      }
      case 'MemberExpression': this.visit(node.object, scope, node); if (node.computed) this.visit(node.property, scope, node); else node.property.parent = node; return;
      case 'Property':
        if (node.computed) this.visit(node.key, scope, node); else node.key.parent = node;
        if (node.shorthand && node.value.type === 'Identifier') node.value.__shorthand = true;
        this.visit(node.value, scope, node);
        return;
      case 'MethodDefinition': case 'PropertyDefinition':
        if (node.computed) this.visit(node.key, scope, node); else node.key.parent = node;
        if (node.value) this.visit(node.value, scope, node);
        return;
      case 'LabeledStatement': node.label.parent = node; this.visit(node.body, scope, node); return;
      case 'BreakStatement': case 'ContinueStatement': case 'MetaProperty': return;
      case 'ExportNamedDeclaration':
        if (node.declaration) this.visit(node.declaration, scope, node);
        else if (!node.source) for (const spec of node.specifiers) { spec.parent = node; spec.local.parent = spec; this.refs.push({ node: spec.local, scope }); }
        return;
      case 'ExportAllDeclaration': return;
      default: for (const child of children(node)) this.visit(child, scope, node);
    }
  }

  where(node) { return `${this.file}:${node.loc.start.line}`; }

  /** The function, class or constant this module exports as `name`. */
  exported(name) {
    const decl = this.program.names.get(name);
    if (decl) return decl;
    for (const statement of this.ast.body) {
      if (statement.type !== 'ExportNamedDeclaration' || statement.source) continue;
      for (const spec of statement.specifiers) if ((spec.exported.name ?? spec.exported.value) === name) return this.program.names.get(spec.local.name) ?? null;
    }
    return null;
  }
}

/** A module whose top level only declares (imports, exports, functions, classes, awaitless constants): safe to import. */
function declaresOnly(module) {
  return module.ast.body.every((statement) => {
    if (statement.type === 'ExpressionStatement') return statement.directive !== undefined;
    if (['ImportDeclaration', 'ExportAllDeclaration', 'FunctionDeclaration', 'ClassDeclaration', 'EmptyStatement'].includes(statement.type)) return true;
    const declaration = statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportDefaultDeclaration' ? statement.declaration : statement;
    if (!declaration) return true;
    if (declaration.type === 'VariableDeclaration') return declaration.declarations.every((d) => !d.init || !containsAwait(d.init));
    return /Declaration$|Expression$|Literal$|Identifier$/.test(declaration.type) && !containsAwait(declaration);
  });
}

const PLACEHOLDERS = new WeakSet();
/** A value known only at run time: reads as `text` wherever it is used (a string, a property, a call, a JSON value). */
function placeholderValue(text) {
  const proxy = new Proxy(function placeholder() {}, {
    get(_target, key) {
      if (key === Symbol.toPrimitive) return (hint) => (hint === 'number' ? 0 : text);
      if (key === 'toString' || key === 'valueOf' || key === 'toJSON') return () => text;
      if (key === Symbol.iterator) return function* empty() {};
      if (key === 'length') return 0;
      if (key === 'then' || typeof key === 'symbol') return undefined;
      return proxy;
    },
    apply: () => proxy,
    construct: () => proxy,
    has: () => false,
  });
  PLACEHOLDERS.add(proxy);
  return proxy;
}
/** True for a value the evaluation could not know (see `placeholderValue`). */
export const isPlaceholder = (value) => typeof value === 'function' && PLACEHOLDERS.has(value);

/** Every repository module the manifest's gates run: the gates and their relative static, re-export and literal dynamic imports. */
export function gateModules(root) {
  const modules = new Map();
  const queue = GATE_SPECS.map((spec) => path.join(root, 'scripts/gates', `gate-${spec.name}.mjs`));
  while (queue.length) {
    const file = queue.shift();
    if (modules.has(file) || !/\.m?js$/.test(file) || !existsSync(file)) continue;
    const module = new Module(file, readFileSync(file, 'utf8'));
    modules.set(file, module);
    for (const node of module.nodes) {
      const source = ['ImportDeclaration', 'ExportAllDeclaration', 'ExportNamedDeclaration', 'ImportExpression'].includes(node.type) ? node.source : null;
      const specifier = literalText(source);
      if (specifier?.startsWith('.') && !specifier.includes('${}')) queue.push(path.resolve(path.dirname(file), specifier));
    }
  }
  return [...modules.values()];
}

/** How a URL text names a publish route: 'create', 'replace', or null (another route). */
function publishRoute(url) {
  const at = url.lastIndexOf('/api/');
  if (at < 0) return null;
  const rest = url.slice(at + 5).split(/[?#]/)[0];
  if (/^(?:my\/)?artifacts\/?$/.test(rest)) return 'create';
  if (/^(?:my\/)?artifacts\/(?:\$\{\}|[A-Za-z0-9]{6,12})$/.test(rest)) return 'replace';
  return null;
}

/** The `<script>` elements of an HTML string: { type: 'module' | 'classic' | 'json' | 'other', code, attributes }. */
export function pageScripts(html) {
  const scripts = [];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attributes = match[1];
    const declared = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attributes)?.[1]?.toLowerCase();
    const type = declared === 'module' ? 'module'
      : !declared || /^(?:text|application)\/(?:java|ecma)script$/.test(declared) ? 'classic'
      : declared === 'importmap' || /json$/.test(declared) ? 'json' : 'other';
    if (/\bsrc\s*=/i.test(attributes) && !match[2].trim()) continue;
    scripts.push({ type, code: match[2], attributes });
  }
  return scripts;
}


const FUNCTION = /Function(?:Declaration|Expression)$|^ArrowFunctionExpression$/;

/** What a page may import as `@afbin/<name>` and load from `/components/<name>.js`, read from the build's inputs. */
export function servedModules(root) {
  const text = (file) => readFileSync(path.join(root, file), 'utf8');
  const components = JSON.parse(text('services/app/lib/html-components/hosted.json')).components;
  const libraries = Object.keys(JSON.parse(text('services/app/lib/libraries/registry.json')));
  const runtime = [...text('services/app/lib/html-runtime/build.server.ts').matchAll(/'@afbin\/([a-z][a-z-]*)'/g)].map((m) => m[1]);
  return { components: new Set(components), modules: new Set([...components, ...libraries, ...runtime]) };
}

/** Each problem with one page's scripts: a script that does not parse, or an import the build does not ship. */
export function pageProblems(html, served) {
  const problems = [];
  // A hosted component is loaded from the page origin's root: `/components/<name>.js` (a gate's fixture server) or `/af/components/<name>.js`.
  const component = (specifier) => /^(?:https?:\/\/[^/]+)?\/(?:af\/)?components\/([a-z][a-z0-9-]*)\.js$/.exec(specifier)?.[1];
  const checkSpecifier = (specifier) => {
    const name = specifier.startsWith('@afbin/') ? specifier.slice(7).split('/')[0] : null;
    if (name && !served.modules.has(name)) problems.push(`imports ${specifier}, which the build does not ship`);
    const hosted = component(specifier);
    if (hosted && !served.components.has(hosted)) problems.push(`loads ${specifier}, a hosted component the build does not ship`);
  };
  for (const match of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) checkSpecifier(match[1]);
  for (const { type, code } of pageScripts(html)) {
    if (type === 'json') {
      try { JSON.parse(code); } catch (error) { problems.push(`a JSON script does not parse: ${error.message}`); }
      continue;
    }
    if (type !== 'module' && type !== 'classic') continue;
    let ast;
    try { ast = parse(code, { ecmaVersion: 'latest', sourceType: type === 'module' ? 'module' : 'script' }); }
    catch (error) { problems.push(`a ${type} script does not parse: ${error.message} near ${JSON.stringify(code.slice(Math.max(0, (error.pos ?? 0) - 40), (error.pos ?? 0) + 20))}`); continue; }
    const visit = (node) => {
      if (!node || typeof node.type !== 'string') return;
      if (['ImportDeclaration', 'ExportAllDeclaration', 'ExportNamedDeclaration', 'ImportExpression'].includes(node.type) && typeof node.source?.value === 'string') checkSpecifier(node.source.value);
      for (const value of Object.values(node)) (Array.isArray(value) ? value : [value]).forEach((child) => child && typeof child === 'object' && visit(child));
    };
    visit(ast);
  }
  return problems;
}

class Evaluator {
  constructor(root, modules, placeholder, serve) {
    this.root = root;
    this.modules = new Map(modules.map((module) => [module.file, module]));
    this.serve = serve;
    this.answers = new Map();
    this.fetch = (input, init) => this.request(input, init);
    this.gates = modules;
    this.placeholder = placeholder;
    this.loaded = new Map();
    this.calls = null;
  }

  module(file) {
    if (!this.modules.has(file)) {
      let module = null;
      try { if (existsSync(file)) module = new Module(file, readFileSync(file, 'utf8')); } catch { module = null; }
      this.modules.set(file, module);
    }
    return this.modules.get(file);
  }

  resolveImport(from, specifier) { return specifier.startsWith('.') ? this.module(path.resolve(path.dirname(from), specifier)) : null; }

  /**
   * Whether evaluated code may import `specifier` from `from` for real: a safe builtin, a package other than a browser
   * engine, a product module (under services/) that only declares, or a gate helper (under scripts/) that only declares
   * and imports nothing refused. Everything else (a gate, a fixture that runs on import, a helper that can open a
   * socket or start a browser) is a placeholder namespace, so nothing evaluated starts a server, a process or a browser.
   */
  importable(from, specifier, seen = new Set()) {
    if (BUILTINS.has(specifier)) return SAFE_BUILTINS.has(specifier);
    if (!specifier.startsWith('.')) return !REFUSED_PACKAGES.test(specifier);
    const module = this.resolveImport(from, specifier);
    if (!module || !declaresOnly(module)) return false;
    if (seen.has(module.file) || !path.relative(this.root, module.file).startsWith(`scripts${path.sep}`)) return true;
    seen.add(module.file);
    return module.ast.body.every((statement) => !statement.source || this.importable(module.file, statement.source.value, seen));
  }

  load(from, specifier) {
    const key = `${from}\0${specifier}`;
    if (!this.loaded.has(key)) {
      const fallback = () => placeholderValue(this.placeholder);
      const target = specifier.startsWith('.') ? pathToFileURL(path.resolve(path.dirname(from), specifier)).href : specifier;
      this.loaded.set(key, this.importable(from, specifier) ? import(target).catch(fallback) : Promise.resolve(fallback()));
    }
    return this.loaded.get(key);
  }

  /**
   * The fetch evaluated code sees, the global one included: the caller's `serve(method, path, body)` answers it (a
   * Response, or null for a request it does not serve), once per distinct request, so a gate's own helper reads the id
   * it was given as it does against a server. A request `serve` does not answer, a body that is not text, or any request
   * without `serve`, is refused: nothing evaluated reaches a server.
   */
  async request(input, init = {}) {
    const url = new URL(String(input?.url ?? input), 'http://gate.invalid');
    const method = String(init.method ?? 'GET').toUpperCase();
    const refused = () => Error(`a gate expression reached the network (${method} ${url.pathname})`);
    if (!this.serve || (init.body !== undefined && typeof init.body !== 'string')) throw refused();
    const key = `${method} ${url.pathname}${url.search} ${init.body ?? ''}`;
    if (!this.answers.has(key)) {
      this.answers.set(key, (async () => {
        let body = init.body;
        try { body = body === undefined ? undefined : JSON.parse(body); } catch { /* a text body stays text */ }
        const response = await this.serve(method, `${url.pathname}${url.search}`, body);
        return response && { status: response.status, text: await response.text(), type: response.headers.get('content-type') ?? 'application/json' };
      })());
    }
    const answer = await this.answers.get(key);
    if (!answer) throw refused();
    return new Response(answer.text, { status: answer.status, headers: { 'content-type': answer.type } });
  }

  /** Every call, in the gates' modules, of the function node `fn`: [{ module, call }]. */
  callsOf(fn) {
    if (!this.calls) {
      this.calls = new Map();
      for (const module of this.gates) {
        for (const node of module.nodes) {
          if (node.type !== 'CallExpression') continue;
          const target = this.callee(module, node.callee);
          if (!target) continue;
          if (!this.calls.has(target.node)) this.calls.set(target.node, []);
          this.calls.get(target.node).push({ module, call: node });
        }
      }
    }
    return this.calls.get(fn) ?? [];
  }

  /** The argument a call passes for the parameter `decl` (a plain or destructured-object parameter of the callee): a node, or null. */
  static argumentFor(fn, decl, call) {
    for (const [index, param] of fn.params.entries()) {
      const arg = call.arguments[index];
      if (!arg || arg.type === 'SpreadElement') continue;
      if (param === decl.id) return arg;
      if (param.type === 'ObjectPattern' && arg.type === 'ObjectExpression') {
        const prop = param.properties.find((p) => p.type === 'Property' && (p.value === decl.id || p.value.left === decl.id));
        const name = prop && keyName(prop);
        const given = name && arg.properties.find((p) => keyName(p) === name);
        if (given) return given.value;
      }
    }
    return null;
  }

  /**
   * Evaluates the expression `node` of `module`. `bindings` maps a parameter's declaration to the call-site argument
   * (`{ node, module }`) that fills it. A declaration runs only when the expression reaches it; an awaited one runs
   * first, dependencies before dependents, and is a placeholder if it throws (a request `serve` refused, say).
   */
  async evaluate(module, node, bindings = new Map()) {
    const defs = [];
    const keys = new Map();
    const imports = [];
    const root = { deps: [] };
    const slot = (key, name) => {
      const def = { alias: `$${defs.length}_${name}`, body: '$ph', deps: [], async: false };
      keys.set(key, def);
      defs.push(def);
      return def;
    };
    const global = (name) => {
      if (['process', 'fetch', 'undefined', 'arguments'].includes(name) || name in globalThis) return null;
      return keys.get(`global:${name}`) ?? slot(`global:${name}`, name);
    };
    const rewrite = (mod, range, from, extra = []) => {
      const edits = [...extra];
      for (const ref of mod.refsIn(range)) {
        if (ref.node.__binding) continue;
        const { decl } = ref;
        if (decl && within(decl.id, range) && !bindings.has(decl)) continue; // declared inside the range itself
        const def = decl ? need(decl) : global(ref.node.name);
        if (!def) continue;
        from.deps.push(def);
        edits.push({ node: ref.node, text: ref.node.__shorthand && ref.node !== range ? `${ref.node.name}: $s.${def.alias}` : `$s.${def.alias}` });
      }
      for (const meta of mod.between(range)) if (meta.type === 'MetaProperty' && meta.meta.name === 'import') edits.push({ node: meta, text: '$meta' });
      edits.sort((a, b) => b.node.start - a.node.start);
      let text = mod.source.slice(range.start, range.end);
      for (const edit of edits) text = text.slice(0, edit.node.start - range.start) + edit.text + text.slice(edit.node.end - range.start);
      return text;
    };
    const need = (decl) => {
      const key = decl.kind === 'import' ? decl.owner : decl.id;
      if (keys.has(key)) return keys.get(key);
      const def = slot(key, decl.name);
      const { module: mod, owner } = decl;
      const bound = bindings.get(decl);
      if (bound) def.body = rewrite(bound.module, bound.node, def);
      else if (decl.kind === 'import') {
        imports.push({ from: mod.file, specifier: owner.parent.source.value });
        const ns = `$imports[${imports.length - 1}]`;
        def.body = owner.type === 'ImportNamespaceSpecifier' ? ns
          : owner.type === 'ImportDefaultSpecifier' ? `${ns}.default`
          : `${ns}[${JSON.stringify(owner.imported.name ?? owner.imported.value)}]`;
      } else if (decl.kind === 'function' || decl.kind === 'class') def.body = rewrite(mod, owner, def);
      else if (decl.kind === 'param' && decl.id.parent?.type === 'AssignmentPattern' && decl.id.parent.left === decl.id) def.body = rewrite(mod, decl.id.parent.right, def);
      else if (['const', 'let', 'var'].includes(decl.kind) && owner.init && !decl.reassigned) {
        if (decl.id === owner.id) { def.body = rewrite(mod, owner.init, def); def.async = containsAwait(owner.init); }
        else {
          // A destructured declaration: run it once and read each name from it.
          let holder = keys.get(owner);
          if (!holder) {
            holder = slot(owner, 'pattern');
            const names = [];
            const renames = [];
            for (const n of walk(owner.id)) {
              if (n.type !== 'Identifier' || !n.__binding) continue;
              names.push(`${JSON.stringify(n.name)}: $b_${n.name}`);
              renames.push({ node: n, text: n.__shorthand ? `${n.name}: $b_${n.name}` : `$b_${n.name}` });
            }
            holder.async = containsAwait(owner.init);
            holder.body = `(${holder.async ? 'async ' : ''}() => { const ${rewrite(mod, owner.id, holder, renames)} = (${rewrite(mod, owner.init, holder)}); return { ${names.join(', ')} }; })()`;
          }
          def.deps.push(holder);
          def.body = `$s.${holder.alias}[${JSON.stringify(decl.name)}]`;
        }
      }
      return def;
    };
    const body = rewrite(module, node, root);
    const namespaces = await Promise.all(imports.map(({ from, specifier }) => this.load(from, specifier)));
    const ph = placeholderValue(this.placeholder);
    const $s = {};
    const thunks = new Map();
    const settled = new Map();
    const lazy = (alias, thunk, awaited) => {
      thunks.set(alias, thunk);
      Object.defineProperty($s, alias, {
        get() { if (!settled.has(alias)) settled.set(alias, awaited ? ph : thunk()); return settled.get(alias); },
        set(next) { settled.set(alias, next); },
      });
    };
    const code = `"use strict";\n${defs.map(({ alias, body: value, async }) => `$lazy(${JSON.stringify(alias)}, ${async ? 'async ' : ''}() => (${value}), ${async});`).join('\n')}\nreturn async () => (${body});`;
    const meta = { url: pathToFileURL(module.file).href, filename: module.file, dirname: path.dirname(module.file) };
    const proc = { ...process, argv: [process.argv[0], module.file], env: {}, exit() { throw Error('a gate expression called process.exit'); }, on() { return proc; }, once() { return proc; } };
    const program = new AsyncFunction('$lazy', '$s', '$meta', '$ph', '$imports', 'process', 'fetch', code);
    const run = await program(lazy, $s, meta, ph, namespaces, proc, this.fetch);
    // The awaited constants the expression reaches, dependencies first; one that fails is a placeholder.
    const order = [];
    const seen = new Set();
    const visit = (def) => { if (seen.has(def)) return; seen.add(def); for (const dep of def.deps) visit(dep); order.push(def); };
    for (const dep of root.deps) visit(dep);
    for (const def of order) {
      if (!def.async || settled.has(def.alias)) continue;
      try { settled.set(def.alias, await thunks.get(def.alias)()); } catch { settled.set(def.alias, ph); }
    }
    return run();
  }

  /** The publish route a call sends to: named in its arguments, or in the helper it calls (three hops); undefined when none is named. */
  route(module, call, payload, depth = 0) {
    const urls = [];
    const scan = (mod, node, skip) => { for (const n of mod.between(node)) { if (skip && within(n, skip)) continue; const text = literalText(n); if (text?.includes('/api/')) urls.push(text); } };
    if (depth === 0) for (const arg of call.arguments) scan(module, arg, payload);
    if (!urls.length && depth < 3) {
      for (const target of this.targets(module, call.callee)) {
        scan(target.module, target.node);
        if (urls.length) break;
        for (const inner of target.module.between(target.node)) {
          if (inner.type !== 'CallExpression') continue;
          const found = this.route(target.module, inner, null, depth + 1);
          if (found !== undefined) return found;
        }
      }
    }
    if (!urls.length) return undefined;
    return urls.map(publishRoute).find(Boolean) ?? null;
  }

  /** The functions a callee may be: a local or imported function, or the arguments the callers pass for a callback parameter. */
  targets(module, node) {
    const direct = this.callee(module, node);
    if (direct) return [direct];
    if (node.type !== 'Identifier') return [];
    const decl = module.refOf.get(node)?.decl;
    if (decl?.kind !== 'param') return [];
    const fn = decl.owner;
    return this.callsOf(fn).flatMap(({ module: caller, call }) => {
      const arg = Evaluator.argumentFor(fn, decl, call);
      if (!arg) return [];
      if (FUNCTION.test(arg.type)) return [{ module: caller, node: arg }];
      const named = this.callee(caller, arg);
      return named ? [named] : [];
    });
  }

  /** The function a callee names (a local or imported function or arrow constant): { module, node }, or null. */
  callee(module, node) {
    if (node.type !== 'Identifier') return null;
    let decl = module.refOf.get(node)?.decl;
    let mod = module;
    if (decl?.kind === 'import') {
      const target = this.resolveImport(module.file, decl.owner.parent.source.value);
      decl = target?.exported(decl.owner.imported?.name ?? 'default') ?? null;
      mod = target;
    }
    if (!decl) return null;
    if (decl.kind === 'function') return { module: mod, node: decl.owner };
    const init = decl.owner?.init;
    if (decl.id === decl.owner?.id && init && FUNCTION.test(init.type)) return { module: mod, node: init };
    return null;
  }

  /**
   * The evaluations of `node`: once per call of the innermost function around it whose parameters it reads (each
   * parameter bound to that call's argument), or once with placeholders when no gate module calls that function.
   */
  variants(module, node) {
    // The parameters it reads, directly or through the function's own local declarations.
    const reads = new Set();
    const seen = new Set();
    const follow = (range) => {
      for (const ref of module.refsIn(range)) {
        const { decl } = ref;
        if (!decl || within(decl.id, range) || seen.has(decl)) continue;
        seen.add(decl);
        if (decl.kind === 'param' && !within(decl.owner, node)) reads.add(decl);
        else if (['const', 'let', 'var'].includes(decl.kind) && decl.owner.init && decl.module === module && FUNCTION.test(enclosingFunction(decl.owner)?.type ?? '')) follow(decl.owner.init);
      }
    };
    follow(node);
    if (!reads.size) return [{ via: null, bindings: new Map() }];
    const fn = [...reads].map((decl) => decl.owner).sort((a, b) => b.start - a.start)[0];
    const params = [...reads].filter((decl) => decl.owner === fn);
    const calls = this.callsOf(fn);
    if (!calls.length) return [{ via: null, bindings: new Map() }];
    return calls.map(({ module: caller, call }) => ({
      via: caller.where(call),
      bindings: new Map(params.flatMap((decl) => { const arg = Evaluator.argumentFor(fn, decl, call); return arg ? [[decl, { node: arg, module: caller }]] : []; })),
    }));
  }
}

/** The function `node` sits in, or null at a module's top level. */
function enclosingFunction(node) {
  for (let at = node.parent; at; at = at.parent) if (FUNCTION.test(at.type)) return at;
  return null;
}

/** The call that sends `payload`: its argument, or through `JSON.stringify` and an enclosing options object. */
function carrier(payload) {
  let node = payload;
  for (;;) {
    const parent = node.parent;
    if (parent?.type === 'CallExpression' && parent.arguments.includes(node)) {
      const stringify = parent.callee.type === 'MemberExpression' && parent.callee.object.name === 'JSON' && parent.callee.property.name === 'stringify';
      if (!stringify) return parent;
      node = parent;
    } else if (parent?.type === 'Property' && parent.value === node && parent.parent?.type === 'ObjectExpression') node = parent.parent;
    else return null;
  }
}

/**
 * Every publish body and every page the manifest's gates use, evaluated: { modules, publishes: [{ at, route, body }],
 * pages: [{ at, html }], failures: [{ at, error }], unrouted: [at] }. `at` is file:line, with ` via file:line` for a
 * helper's call. `failures` are sites that would not evaluate and `unrouted` bodies sent through a call no route could be
 * read from: both should be empty, so a site is never dropped quietly.
 * @param {string} root the repository root
 * @param {{ placeholder?: string, serve?: (method: string, path: string, body: unknown) => Promise<Response | null> }} [options]
 *   `placeholder`: what a value known only at run time reads as; `serve`: answers the requests evaluated code makes
 *   (a gate's helper publishing an image whose id a later page names), or null to refuse one.
 */
export async function gateInputs(root, { placeholder = 'afPlaceholder', serve } = {}) {
  const modules = gateModules(root);
  const evaluator = new Evaluator(root, modules, placeholder, serve);
  const relative = (where) => path.relative(root, where);
  const result = { modules: modules.map((module) => relative(module.file)), publishes: [], pages: [], failures: [], unrouted: [] };
  const evaluate = async (module, node, record) => {
    for (const { via, bindings } of evaluator.variants(module, node)) {
      const at = relative(module.where(node)) + (via ? ` via ${relative(via)}` : '');
      try { record(at, await evaluator.evaluate(module, node, bindings)); }
      catch (error) { result.failures.push({ at, error: error instanceof Error ? error.message : String(error) }); }
    }
  };
  // Whatever fetch a helper captured, a request goes only where `Evaluator.request` sends it.
  const realFetch = globalThis.fetch;
  globalThis.fetch = evaluator.fetch;
  try {
    const sites = [];
    for (const module of modules) {
      for (const node of module.nodes) {
        if (node.type !== 'ObjectExpression') continue;
        const fields = node.properties.map(keyName);
        const folder = node.properties.some((prop) => keyName(prop) === 'format' && prop.value.value === 'folder');
        if (!folder && !fields.some((field) => CONTENT_FIELDS.includes(field))) continue;
        const call = carrier(node);
        if (!call) continue;
        const route = evaluator.route(module, call, node);
        if (route === null) continue; // another route (a policy, a markdown edit): not a publish
        if (route === undefined) {
          // Data handed to a browser page (page.evaluate's argument, a postMessage) is not a request body.
          if (call.callee.type === 'MemberExpression' && BROWSER_CALLS.includes(call.callee.property.name)) continue;
          result.unrouted.push(relative(module.where(node)));
          continue;
        }
        sites.push({ module, node, route });
      }
    }
    for (const { module, node, route } of sites) await evaluate(module, node, (at, body) => result.publishes.push({ at, route, body }));
    for (const module of modules) {
      if (!relative(module.file).startsWith(`scripts${path.sep}`)) continue;
      const seen = new Set();
      for (const node of module.nodes) {
        const text = literalText(node);
        if (text === null || !PAGE.test(text) || node.parent?.type === 'TaggedTemplateExpression') continue;
        let outer = node;
        while (outer.parent && ((outer.parent.type === 'BinaryExpression' && outer.parent.operator === '+') || outer.parent.type === 'TemplateLiteral')) outer = outer.parent;
        if (seen.has(outer)) continue;
        seen.add(outer);
        await evaluate(module, outer, (at, html) => { if (typeof html === 'string') result.pages.push({ at, html }); });
      }
    }
  } finally {
    globalThis.fetch = realFetch;
  }
  return result;
}
