
import { readFileSync } from "fs";
import { BuiltinLib} from "../builtinlib";
import * as RUNTIME_ERROR from '../runtime_error'

import { BOOL, CLASS, NONE, NUM } from "../utils";
// import { Type } from "../ast";
enum Type { Num, Bool, None, String }

function stringify(typ: Type, arg: any, mem?: WebAssembly.Memory): string {
  switch (typ) {
    case Type.Num:
      return (arg as number).toString();
    case Type.Bool:
      return (arg as boolean) ? "True" : "False";
    case Type.None:
      return "None";
    case Type.String:
      var bytes = new Uint8Array(mem.buffer, arg, 4);
      var length = ((bytes[0] & 0xFF) | (bytes[1] & 0xFF) << 8 | (bytes[2] & 0xFF) << 16 | (bytes[3] & 0xFF) << 24);
      console.log(length); // length is correct
      var char_bytes = new Uint8Array(mem.buffer, arg + 4, length);
      console.log(char_bytes[0]);
      var string = new TextDecoder('utf8').decode(char_bytes);
      return string
  }
}

function print(typ: Type, arg: any, mem?: WebAssembly.Memory): any {
  importObject.output += stringify(typ, arg, mem);
  importObject.output += "\n";
  return arg;
}

function index_out_of_bounds(length: any, index: any): any {
  if (index < 0 || index >= length)
    throw new Error(`RUNTIME ERROR: Index ${index} out of bounds`);
  return index;
}

export async function addLibs() {
  const memory = new WebAssembly.Memory({ initial: 10, maximum: 100 });
  const bytes = readFileSync("build/memory.wasm");
  const setBytes = readFileSync("build/sets.wasm");
  const stringBytes = readFileSync("build/string.wasm");
  const memoryModule = await WebAssembly.instantiate(bytes, { js: { mem: memory } })
  importObject.libmemory = memoryModule.instance.exports;
  const setModule = await WebAssembly.instantiate(setBytes, { ...importObject, js: { mem: memory } })
  importObject.libset = setModule.instance.exports;
  const stringModule = await WebAssembly.instantiate(stringBytes, { ...importObject, js: { mem: memory } })
  importObject.libstring = stringModule.instance.exports;
  importObject.memory_values = memory;
  importObject.js = { memory };
  importObject.imports.print_str =  (arg: number) => print(Type.String, arg, memory);
  return importObject;
}

export const importObject: any = {
  imports: {
    // we typically define print to mean logging to the console. To make testing
    // the compiler easier, we define print so it logs to a string object.
    //  We can then examine output to see what would have been printed in the
    //  console.
    index_out_of_bounds: (length: any, index: any) => index_out_of_bounds(length, index),
    division_by_zero: (arg: number, line: number, col: number) => RUNTIME_ERROR.division_by_zero(arg, line, col),
    assert_not_none: (arg: any, line: number, col: number) => RUNTIME_ERROR.assert_not_none(arg, line, col),
    stack_push: (line: number) => RUNTIME_ERROR.stack_push(line),
    stack_clear: () => RUNTIME_ERROR.stack_clear(),
    print: (arg: any) => print(Type.Num, arg),
    print_num: (arg: number) => print(Type.Num, arg),
    print_bool: (arg: number) => print(Type.Bool, arg),
    print_none: (arg: number) => print(Type.None, arg),
    ...BuiltinLib.reduce((o: Record<string, Function>, key) => Object.assign(o, { [key.name]: key.body }), {}),
  },

  output: "",
};
