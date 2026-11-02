// event.json を JavaScript で読んで書き戻したときに、値やキーの順が変わってしまう書き方がないかを調べる。
// JavaScript の JSON.parse / JSON.stringify では、次のものが元どおりに書けない（Python の json は元どおりに書ける）:
// - 数字だけのキー（"1" など）があるオブジェクト: キーの順が並べ替わる
// - 同じキーが2回あるオブジェクト: 後ろの値だけが残る
// - 数値の書き方: 1.0 → 1、1e16 → 10000000000000000、2^53 を超える整数は丸められる、-0 → 0 など
// - 指数表記の数値（1.5e-7 など）: JavaScript と Python で書き方が違う（1.5e-7 と 1.5e-07）ので、変わらなくても読み取り専用にする
// - 「__proto__」というキー: JavaScript では特別な名前なので、安全のため編集しない
// 見つかったときは、エディタは event.json を読み取り専用にする（値を黙って変えないため）。

const WS = /[ \t\n\r]*/y;
const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const LITERAL = /true|false|null/y;

/**
 * 書き戻すと変わってしまう箇所の説明を返す（なければ空）。text は JSON.parse できること（できなければ例外）。
 */
export function lossyJson(text: string): string[] {
  JSON.parse(text); // 正しい JSON でなければここで例外
  const src = text.startsWith('﻿') ? text.slice(1) : text;
  const issues: string[] = [];
  let i = 0;
  const skip = () => {
    WS.lastIndex = i;
    WS.exec(src);
    i = WS.lastIndex;
  };
  const string = (): string => {
    const start = i;
    i++;
    while (src[i] !== '"') i += src[i] === '\\' ? 2 : 1;
    i++;
    return JSON.parse(src.slice(start, i)) as string;
  };
  const label = (path: string) => path || '（最上位）';
  const value = (path: string): void => {
    skip();
    const c = src[i];
    if (c === '{') {
      i++;
      const keys: string[] = [];
      skip();
      if (src[i] === '}') {
        i++;
        return;
      }
      for (;;) {
        skip();
        const key = string();
        keys.push(key);
        skip();
        i++; // :
        value(path ? `${path}.${key}` : key);
        skip();
        if (src[i++] === ',') continue;
        break;
      }
      if (keys.includes('__proto__')) issues.push(`${label(path)} に「__proto__」というキーがあります（JavaScript では特別な名前なので、安全のため編集しません）`);
      // キーの順は、JSON.parse と同じく自分のプロパティとして足したときの順で確かめる（__proto__ も普通のキーになる）
      const o: Record<string, true> = Object.create(null) as Record<string, true>;
      for (const k of keys) o[k] = true;
      const order = Object.keys(o);
      if (order.length !== keys.length) issues.push(`${label(path)} に同じキーが複数あります`);
      else if (order.some((k, j) => k !== keys[j])) issues.push(`${label(path)} の数字だけのキー（${keys.filter((k) => /^\d+$/.test(k)).join('・')}）の順が変わります`);
      return;
    }
    if (c === '[') {
      i++;
      skip();
      if (src[i] === ']') {
        i++;
        return;
      }
      for (let n = 0; ; n++) {
        value(`${path}[${n}]`);
        skip();
        if (src[i++] === ',') continue;
        break;
      }
      return;
    }
    if (c === '"') {
      string();
      return;
    }
    NUMBER.lastIndex = i;
    const m = NUMBER.exec(src);
    if (m) {
      i = NUMBER.lastIndex;
      const token = m[0];
      const back = JSON.stringify(Number(token));
      if (/[eE]/.test(token)) issues.push(`${label(path)} の数値 ${token} は指数表記です（JavaScript と Python で書き方が違う）`);
      else if (back !== token) issues.push(`${label(path)} の数値 ${token} が ${back} に変わります`);
      return;
    }
    LITERAL.lastIndex = i;
    const l = LITERAL.exec(src);
    if (!l) throw new Error(`JSON を読めません（${i} 文字目）`);
    i = LITERAL.lastIndex;
  };
  value('');
  return issues;
}
