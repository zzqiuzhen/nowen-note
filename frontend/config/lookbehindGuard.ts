/**
 * iOS 16.0 / 16.0.x WebKit has no RegExp lookbehind (added in Safari 16.4).
 *
 * Two ways lookbehind reaches a shipped chunk:
 *   1. as a regex *literal*  -> parse-time SyntaxError, the whole chunk is dead;
 *   2. as a string passed to `new RegExp("(?<=...)")` -> runs fine while the bundle is
 *      parsed, then throws `Invalid regular expression: invalid group specifier name`
 *      the first time that line executes. On this app that happens inside a React
 *      render (MotionPhotoOverlay), so React unmounts and the phone shows a blank page.
 *
 * This module rewrites every `new RegExp(<string with lookbehind>)` call into an IIFE
 * that keeps the original expression when the engine supports lookbehind and falls back
 * to the same pattern with the lookbehind groups stripped when it does not. It also
 * reports sites it cannot make safe so the build can fail instead of shipping another
 * white-screen IPA.
 */

const LOOKBEHIND_MARK = /\(\?<[=!]/;
const WRAPPED_PREFIX = "try{return ";

type StringLiteral = { end: number; raw: string };

function readStringLiteral(src: string, pos: number): StringLiteral | null {
  const quote = src[pos];
  if (quote !== '"' && quote !== "'" && quote !== "`") return null;
  let i = pos + 1;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === quote) return { end: i + 1, raw: src.slice(pos, i + 1) };
    if (quote === "`" && ch === "$" && src[i + 1] === "{") return null;
    i += 1;
  }
  return null;
}

/** Index of the ")" that closes the "(" opened at `open`, or -1. Handles nested strings. */
function findCallEnd(src: string, open: number): number {
  let depth = 0;
  let i = open;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const lit = readStringLiteral(src, i);
      if (!lit) return -1;
      i = lit.end;
      continue;
    }
    if (ch === "/" && src[i + 1] !== "/" && src[i + 1] !== "*") {
      // skip a regex literal so parens inside it do not disturb the depth count
      let j = i + 1;
      let inClass = false;
      while (j < src.length) {
        const c = src[j];
        if (c === "\\") {
          j += 2;
          continue;
        }
        if (c === "[") inClass = true;
        else if (c === "]") inClass = false;
        else if (c === "/" && !inClass) break;
        else if (c === "\n") break;
        j += 1;
      }
      i = j + 1;
      continue;
    }
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  return -1;
}

const FALLBACK_RE = String.raw`/\(\?<[=!][^()]*\)/g`;

export interface GuardResult {
  code: string;
  wrapped: number;
  unguarded: string[];
}

/**
 * Rewrite every `new RegExp(<string literal containing lookbehind>[, flags])` so it
 * degrades instead of throwing on engines without lookbehind support.
 */
export function guardLookbehindCalls(code: string): GuardResult {
  let out = "";
  let last = 0;
  let wrapped = 0;
  const unguarded: string[] = [];
  const re = /new RegExp\(/g;
  let match: RegExpExecArray | null;

  while ((match = re.exec(code))) {
    const callStart = match.index;
    const before = code.slice(Math.max(0, callStart - WRAPPED_PREFIX.length), callStart);
    if (before === WRAPPED_PREFIX) continue; // already rewritten by an earlier pass

    const literalStart = callStart + match[0].length;
    const literal = readStringLiteral(code, literalStart);
    if (!literal) continue;
    if (!LOOKBEHIND_MARK.test(literal.raw)) continue;

    const callEnd = findCallEnd(code, callStart + match[0].length - 1);
    if (callEnd < 0) {
      unguarded.push(code.slice(callStart, callStart + 200));
      continue;
    }

    const call = code.slice(callStart, callEnd + 1);
    const tail = call.slice(match[0].length + literal.raw.length).replace(/\)\s*$/, "").trim();
    const flagsExpr = tail.replace(/^,\s*/, "").trim() || "undefined";

    out += code.slice(last, callStart);
    out += `(()=>{try{return ${call}}catch(__le){return new RegExp(String(${literal.raw}).replace(${FALLBACK_RE},""),${flagsExpr})}})()`;
    last = callEnd + 1;
    wrapped += 1;
    re.lastIndex = callEnd + 1;
  }

  out += code.slice(last);
  return { code: out, wrapped, unguarded };
}

/** Remove string literals and comments so only "code" text (incl. regex literal bodies) remains. */
function stripStringsAndComments(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const lit = readStringLiteral(src, i);
      if (lit) {
        out += " ";
        i = lit.end;
        continue;
      }
    }
    if (ch === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end < 0 ? src.length : end + 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/** Sites that would still throw on iOS 16.0 at runtime, or kill the chunk at parse time. */
export function findUnguardedLookbehind(code: string): string[] {
  const issues: string[] = [];
  const re = /new RegExp\(/g;
  let match: RegExpExecArray | null;

  while ((match = re.exec(code))) {
    const callStart = match.index;
    const before = code.slice(Math.max(0, callStart - WRAPPED_PREFIX.length), callStart);
    if (before === WRAPPED_PREFIX) continue;
    const literal = readStringLiteral(code, callStart + match[0].length);
    if (!literal || !LOOKBEHIND_MARK.test(literal.raw)) continue;
    issues.push(code.slice(callStart, callStart + 200));
  }

  // 字符串和注释清掉后还剩下的 (?< 只可能在正则字面量里 —— 那是解析期 SyntaxError，
  // 整个 chunk 根本不会执行，任何 error boundary 都兜不住。
  const literalOnly = stripStringsAndComments(code);
  if (LOOKBEHIND_MARK.test(literalOnly)) {
    const idx = literalOnly.search(LOOKBEHIND_MARK);
    issues.push(`regex-literal: ${literalOnly.slice(Math.max(0, idx - 80), idx + 120)}`);
  }

  return issues;
}
