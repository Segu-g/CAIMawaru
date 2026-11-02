import { describe, expect, it } from 'vitest';
import eventJson from '../../events/example/event.json?raw';
import { formatJson, loadDoc } from './doc';
import { lossyJson } from './jsonCheck';

describe('書き戻すと変わってしまう event.json を見つける', () => {
  it('events/example と、ふつうの値は問題なし', () => {
    expect(lossyJson(eventJson)).toEqual([]);
    expect(lossyJson('{"a": [1, -2, 0.5, 1.25e-7, 123456789], "b": {"x": null, "y": true, "z": "1.0"}, "c": {}, "d": []}')).toEqual([]);
  });

  it('数値の書き方が変わるもの（1.0・1e16・2^53 を超える整数・-0）', () => {
    expect(lossyJson('{"a": 1.0, "b": [1e16], "c": {"d": 9007199254740993}, "e": -0}')).toEqual([
      'a の数値 1.0 が 1 に変わります',
      'b[0] の数値 1e16 が 10000000000000000 に変わります',
      'c.d の数値 9007199254740993 が 9007199254740992 に変わります',
      'e の数値 -0 が 0 に変わります',
    ]);
  });

  it('数字だけのキーの順が並べ替わるもの。昇順で先頭にあるなら変わらない', () => {
    expect(lossyJson('{"info": {"slotColors": {"2": {}, "1": {}}}}')).toEqual(['info.slotColors の数字だけのキー（2・1）の順が変わります']);
    expect(lossyJson('{"name": "x", "1": 1}')).toEqual(['（最上位） の数字だけのキー（1）の順が変わります']);
    expect(lossyJson('{"slotColors": {"1": {}, "2": {}, "x": 1}}')).toEqual([]);
  });

  it('同じキーが2回あるもの', () => {
    expect(lossyJson('{"a": 1, "a": 2}')).toEqual(['（最上位） に同じキーが複数あります']);
  });

  it('文字列の中の「"」「\\」やエスケープは問題にしない', () => {
    expect(lossyJson('{"a\\"b": "c\\\\\\"}", "\\u3042": "\\n"}')).toEqual([]);
  });

  it('見つかったときは、イベント情報を読み取り専用にして、値を変えない', () => {
    const text = '{\n  "storeId": "ev",\n  "title": "t",\n  "info": {\n    "slotColors": {\n      "2": {},\n      "1": {}\n    }\n  },\n  "scale": 1.0\n}\n';
    const { doc, notes } = loadDoc({ event: text, circles: null, menus: null });
    expect(doc.eventLocked).toHaveLength(2);
    expect(notes.map((n) => n.file)).toEqual(['event.json']);
    expect(formatJson(doc.event)).not.toBe(text); // JavaScript では元どおりに書けない（だから書かない）
  });
});
