// The clue reference parser: prose in, (number, direction) pairs out. These tests pin the
// grammar the owner asked for (single refs hyphenated or spaced, "See N-Down" prose, distributed
// lists sharing one trailing direction word, mixed axes in one clue, case-insensitivity) and the
// hard "never match" line: bare numbers, years, and "(17)" enumerations carry no direction word,
// so they yield nothing. Existence is not this module's job; the call site filters against the
// real clue list, so a parsed ref for a clue that does not exist is correct behavior here.
import { describe, expect, it } from "vitest";
import { parseClueRefs } from "./clueRefs";

describe("parseClueRefs", () => {
  it("reads a hyphenated single ref", () => {
    expect(parseClueRefs("42-Down")).toEqual([
      { number: 42, direction: "down" },
    ]);
  });

  it("reads a spaced single ref", () => {
    expect(parseClueRefs("17 Across")).toEqual([
      { number: 17, direction: "across" },
    ]);
  });

  it("reads a ref buried in prose, like 'See 42-Down'", () => {
    expect(parseClueRefs("See 42-Down")).toEqual([
      { number: 42, direction: "down" },
    ]);
  });

  it("is case-insensitive on the direction word", () => {
    expect(parseClueRefs("42-DOWN and 8-across and 3 AcRoSs")).toEqual([
      { number: 42, direction: "down" },
      { number: 8, direction: "across" },
      { number: 3, direction: "across" },
    ]);
  });

  it("distributes one trailing direction word over a comma-and list", () => {
    expect(parseClueRefs("17, 20, 49, and 59 across")).toEqual([
      { number: 17, direction: "across" },
      { number: 20, direction: "across" },
      { number: 49, direction: "across" },
      { number: 59, direction: "across" },
    ]);
  });

  it("distributes over a short 'and' list", () => {
    expect(parseClueRefs("5 and 12 down")).toEqual([
      { number: 5, direction: "down" },
      { number: 12, direction: "down" },
    ]);
  });

  it("distributes over an ampersand list", () => {
    expect(parseClueRefs("1, 5 & 9 Down")).toEqual([
      { number: 1, direction: "down" },
      { number: 5, direction: "down" },
      { number: 9, direction: "down" },
    ]);
  });

  it("keeps mixed axes in one clue on their own direction words", () => {
    expect(parseClueRefs("17-Across and 3-Down")).toEqual([
      { number: 17, direction: "across" },
      { number: 3, direction: "down" },
    ]);
  });

  it("keeps a distributed list and a later single ref apart", () => {
    expect(parseClueRefs("17, 20, and 49 across, plus 3 down")).toEqual([
      { number: 17, direction: "across" },
      { number: 20, direction: "across" },
      { number: 49, direction: "across" },
      { number: 3, direction: "down" },
    ]);
  });

  it("reads refs in the order they appear, duplicates kept for the call site to dedupe", () => {
    expect(parseClueRefs("8-Down, see also 8-Down")).toEqual([
      { number: 8, direction: "down" },
      { number: 8, direction: "down" },
    ]);
  });

  it("reads a three-digit clue number", () => {
    expect(parseClueRefs("With 100-Across")).toEqual([
      { number: 100, direction: "across" },
    ]);
  });

  // The "never match" line the owner drew.
  it("does not match a bare number with no direction word", () => {
    expect(parseClueRefs("Just the number 5 alone")).toEqual([]);
  });

  it("does not match a year", () => {
    expect(parseClueRefs("Event of 1999")).toEqual([]);
    expect(parseClueRefs("In 1066 across the channel")).toEqual([]);
  });

  it("does not read a four-digit number's tail as a reference", () => {
    expect(parseClueRefs("1000 down")).toEqual([]);
    expect(parseClueRefs("12345 across")).toEqual([]);
  });

  it("does not match an enumeration like '(17)'", () => {
    expect(parseClueRefs("Some answer (17)")).toEqual([]);
  });

  it("does not read a direction word alone as a reference", () => {
    expect(parseClueRefs("ACROSS the wide river")).toEqual([]);
    expect(parseClueRefs("A quiet rundown of the day")).toEqual([]);
    expect(parseClueRefs("Downtown at dusk")).toEqual([]);
  });

  it("does not match a number glued to a direction word with no separator", () => {
    expect(parseClueRefs("12down")).toEqual([]);
  });

  it("returns [] for empty or absent text", () => {
    expect(parseClueRefs("")).toEqual([]);
    expect(parseClueRefs(undefined)).toEqual([]);
  });

  it("returns [] for prose with no reference at all", () => {
    expect(parseClueRefs("Capital of France")).toEqual([]);
  });
});
