import { parse } from "./parser";
import { BasicREPL } from "./repl";
import { importObject, addLibs  } from "./tests/import-object.test";

// entry point for debugging
async function debug() {
  var source = `
  a: [int] = None
  set_x: set[int] = None
  set_x = set([1,2,3])
  set_x.update([2,3,4])
  print(set_x)
  `

  // set_1 : set[int] = None
  // a : int = 0
  // b : bool = True
  // l: [int] = None
  // set_1 = set([1, 2, 3])

  // set_1.add(3)
  // set_1.add(3)
  // set_1.remove(1)
  // a = len(set_1)
  // b = 1 in set_1
  // print(a)
  // print(b)
  const ast = parse(source);
  console.log(`AST: \n ${ast}`)
  
  const repl = new BasicREPL(await addLibs());
  // const result = repl.tc(source);
  // console.log(result);
  const result = repl.run(source).then(result => {
    console.log(result);
  })
}

debug();

