// Olvasó: beállítások, lapozási irány, széles képek felezése, webtoon-felismerés.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as RC from "../../public/js/reader-core.js";

describe("reader-core", () => {
  test("beállítások: ismeretlen érték alapértékre, szélesség korlátok közé", () => {
    assert.deepEqual(RC.normalizePrefs(null), RC.DEFAULT_PREFS);
    const p = RC.normalizePrefs({ mode: "book", direction: "rtl", scaling: "x", widthPct: 5, autoWebtoon: "igen", evil: 1 });
    assert.deepEqual(p, { ...RC.DEFAULT_PREFS, mode: "book", direction: "rtl", widthPct: 40 });
    assert.equal(RC.normalizePrefs({ widthPct: 250 }).widthPct, 100);
  });

  test("irány: jobbról balra a bal billentyű / bal koppintás / jobbra húzás visz előre", () => {
    assert.equal(RC.keyAction("ArrowRight", "ltr"), "next");
    assert.equal(RC.keyAction("ArrowLeft", "ltr"), "prev");
    assert.equal(RC.keyAction("ArrowLeft", "rtl"), "next");
    assert.equal(RC.keyAction("d", "rtl"), "prev");
    assert.equal(RC.keyAction("Enter", "rtl"), null);
    assert.equal(RC.tapAction(0.1, "ltr"), "prev");
    assert.equal(RC.tapAction(0.1, "rtl"), "next");
    assert.equal(RC.tapAction(0.5, "rtl"), null);
    assert.equal(RC.swipeAction(-60, "ltr"), "next");
    assert.equal(RC.swipeAction(-60, "rtl"), "prev");
    assert.equal(RC.swipeAction(10, "ltr"), null);
    assert.equal(RC.arrowAction("left", "rtl"), "next");
    assert.equal(RC.arrowAction("right", "ltr"), "next");
  });

  test("széles kép felezése: előre fél → fél → következő, visszafelé a második félre érkezik", () => {
    const wide = new Set([1]);
    const ctx = { total: 3, step: 1, split: true, isWide: i => wide.has(i) };
    let pos = { index: 0, half: null };
    const seq = [];
    while (pos) { seq.push(`${pos.index}:${pos.half}`); pos = RC.nextPosition(pos, ctx); }
    assert.deepEqual(seq, ["0:null", "1:0", "1:1", "2:null"]);
    pos = { index: 2, half: null };
    const back = [];
    while (pos) { back.push(`${pos.index}:${pos.half}`); pos = RC.prevPosition(pos, ctx); }
    assert.deepEqual(back, ["2:null", "1:1", "1:0", "0:null"]);
  });

  test("felezés nincs: egészben beállításnál és kétoldalas (asztali) nézetben", () => {
    const isWide = () => true;
    assert.deepEqual(RC.nextPosition({ index: 0, half: null }, { total: 3, step: 1, split: false, isWide }), { index: 1, half: null });
    assert.deepEqual(RC.nextPosition({ index: 0, half: null }, { total: 5, step: 2, split: true, isWide }), { index: 2, half: null });
    assert.equal(RC.nextPosition({ index: 4, half: null }, { total: 5, step: 2, split: true, isWide }), null);
  });

  test("melyik fél látszik: balról jobbra előbb a bal, jobbról balra előbb a jobb", () => {
    assert.equal(RC.halfSide(0, "ltr"), "left");
    assert.equal(RC.halfSide(1, "ltr"), "right");
    assert.equal(RC.halfSide(0, "rtl"), "right");
    assert.equal(RC.halfSide(null, "rtl"), null);
    assert.equal(RC.isWideImage(1600, 1100), true);
    assert.equal(RC.isWideImage(800, 1200), false);
  });

  test("webtoon-felismerés: az első képek többsége hosszú", () => {
    const tall = { width: 800, height: 4000 }, page = { width: 800, height: 1200 };
    assert.equal(RC.detectWebtoon([tall, tall, page]), true);
    assert.equal(RC.detectWebtoon([tall, page, page]), false);
    assert.equal(RC.detectWebtoon([tall]), false, "egy kép kevés a döntéshez");
    assert.equal(RC.detectWebtoon([undefined, tall, tall]), true);
  });
});
