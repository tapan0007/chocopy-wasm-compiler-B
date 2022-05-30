import "mocha";
import { expect } from "chai";
import { BasicREPL } from "../repl";
import { Value } from "../ast";
import { importObject, addLibs } from "./import-object.test";
import {run, typeCheck} from "./helpers.test";
import { fail } from 'assert'



// Clear the output before every test
beforeEach(function () {
  importObject.output = "";
});

// suppress console logging so output of mocha is clear
before(function () {
  console.log = function () {};
});

export function assert(name: string, source: string, expected: Value) {
  it(name, async () => {
    const repl = new BasicREPL(importObject);
    const result = await repl.run(source);
    expect(result).to.deep.eq(expected);
  });
}

export function asserts(name: string, pairs: Array<[string, Value]>) {
  const repl = new BasicREPL(importObject);

  it(name, async () => {
    for (let i = 0; i < pairs.length; i++) {
      const result = await repl.run(pairs[i][0]);
      expect(result).to.deep.eq(pairs[i][1]);
    }
  });
}

// Assert an error gets thrown at runtime
export function assertFail(name: string, source: string) {
  it(name, async () => {
    try {
      await run(source);
      fail("Expected an exception");
    } catch (err) {
      expect(err.message).to.contain("RUNTIME ERROR:");
    }
  });
}

// Assert an error gets thrown at runtime
export function assertSomeFail(name: string, source: string) {
  it(name, async () => {
    try {
      await run(source);
      fail("Expected an exception");
    } catch (err) {
    }
  });
}


export function assertPrint(name: string, source: string, expected: Array<string>) {
  it(name, async () => {
    await run(source);
    const output = importObject.output;
    expect(importObject.output.trim().split("\n")).to.deep.eq(expected);
  });
}

export function assertTC(name: string, source: string, result: any) {
  it(name, async () => {
      const typ = typeCheck(source);
      expect(typ).to.deep.eq(result);
  });
}

export function assertTCFail(name: string, source: string) {
  it(name, async () => {
    expect(function(){
      typeCheck(source);
  }).to.throw('TYPE ERROR:');
  });
}

export function assertParserFail(name: string, source: string) {
  it(name, async () => {
    expect(function(){
      typeCheck(source);
  }).to.throw('PARSE ERROR:');
  });
}

export function assertOptimize(name: string, source: string, astOpt: boolean = true, irOpt: boolean = true) {
  it(name, async () => {
    const repl0 = new BasicREPL(await addLibs());
    const v0 = await repl0.run(source, false, false);
    const watLen0 = repl0.watCode.length;
    const repl1 = new BasicREPL(await addLibs());
    const v1 = await repl1.run(source, astOpt, irOpt);
    const watLen1 = repl1.watCode.length;
    expect(watLen0).gt(watLen1);
    expect(v0).deep.eq(v1);
  });
}

export function assertPass(name: string, source: string, astOpt: boolean = true, irOpt: boolean = true) {
  it(name, async () => {
    const repl0 = new BasicREPL(await addLibs());
    const v0 = await repl0.run(source, false, false);
    const watLen0 = repl0.watCode.length;
    const repl1 = new BasicREPL(await addLibs());
    const v1 = await repl1.run(source, astOpt, irOpt);
    const watLen1 = repl1.watCode.length;
    expect(watLen0).gte(watLen1);
    expect(v0).deep.eq(v1);
  });
}

