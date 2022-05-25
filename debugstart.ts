import { TreeCursor } from "lezer-tree";
import { parser } from "lezer-python";
import { parse } from "./parser";
import { tc } from "./type-check";
import { BasicREPL } from "./repl";
import { importObject, addLibs } from "./tests/import-object.test";
import { augmentEnv, Config } from "./runner";
import { lowerProgram } from "./lower";
import { compile } from "./compiler";

// entry point for debugging
async function debug() {
  var source = `s:str = "asdf"
  print(len(s))`


  // set_1.add(3)
  // set_1.add(3)
  // set_1.remove(1)
  // a = len(set_1)
  // b = 1 in set_1
  // print(a)
  // print(b)
  const ast = parse(source);
  
  const repl = new BasicREPL(await addLibs());
  const result = repl.tc(source);
  console.log(result);
  // const result = repl.run(source).then(result => {
  //   console.log(result);
  // })
}

debug();
