
import { table } from 'console';
import { Stmt, Expr, Type, UniOp, BinOp, Literal, Program, FunDef, VarInit, Class, SourceLocation, DestructureLHS } from './ast';
import { NUM, BOOL, NONE, CLASS } from './utils';
import { emptyEnv } from './compiler';
import { TypeCheckError } from './error_reporting'
import { BuiltinLib } from './builtinlib';
import exp from 'constants';
import { listenerCount } from 'process';
import { IgnorePlugin } from 'webpack';

const compvars : Map<string, [string, number]> = new Map();
function generateCompvar(base : string) : string {
  const compbase = `compvar$${base}`;
  if (compvars.has(compbase)) {
    var cur = compvars.get(compbase)[1];
    const newName = compbase + (cur + 1)
    compvars.set(compbase, [newName, cur + 1]);
    return newName;
  } else {
    const newName = compbase + 1
    compvars.set(compbase, [newName, 1]);
    return newName;
  }
}
function retrieveCompvar(base : string) : string {
  const compbase = `compvar$${base}`;
  if (compvars.has(compbase)) {
    return compvars.get(compbase)[0];
  } else {
    return undefined;
  }
}

export type GlobalTypeEnv = {
  globals: Map<string, Type>,
  functions: Map<string, [Array<Type>, Type]>,
  classes: Map<string, [Map<string, Type>, Map<string, [Array<Type>, Type]>]>
}

export type LocalTypeEnv = {
  vars: Map<string, Type>,
  expectedRet: Type,
  actualRet: Type,
  topLevel: Boolean,
  loopCount: number,
  currLoop: Array<number>
}

const defaultGlobalFunctions = new Map();
BuiltinLib.forEach(x=>{
  defaultGlobalFunctions.set(x.name, x.typeSig);
})
defaultGlobalFunctions.set("print", [[CLASS("object")], NUM]);

export const defaultTypeEnv = {
  globals: new Map(),
  functions: defaultGlobalFunctions,
  classes: new Map(),
};

export function emptyGlobalTypeEnv() : GlobalTypeEnv {
  return {
    globals: new Map(),
    functions: new Map(),
    classes: new Map()
  };
}

export function emptyLocalTypeEnv() : LocalTypeEnv {
  return {
    vars: new Map(),
    expectedRet: NONE,
    actualRet: NONE,
    topLevel: true,
    loopCount: 0,
    currLoop: []
  };
}

export type TypeError = {
  message: string
}

export function equalType(t1: Type, t2: Type): boolean {
  return (
    t1 === t2 ||
    (t1.tag === "class" && t2.tag === "class" && t1.name === t2.name) ||
    (t1.tag === "set" && t2.tag == "set") || 
    (t1.tag === "list" && t2.tag === "list" && (equalType(t1.type, t2.type) || t1.type === NONE)) ||
    (t1.tag === "generator" && t2.tag === "generator" && equalType(t1.type, t2.type))
  );
}

export function isNoneOrClass(t: Type) : boolean {
  return t.tag === "none" || t.tag === "class" || t.tag === "generator";
}

export function isSubtype(env: GlobalTypeEnv, t1: Type, t2: Type) : boolean {
  return (
    equalType(t1, t2) ||
    (t1.tag === "none" && t2.tag === "class") ||
    (t1.tag === "none" && t2.tag === "list") ||
    (t1.tag === "none" && t2.tag === "set") ||
    (t1.tag === "none" && t2.tag === "generator") ||
    // can assign generator created with comprehension to generator class object
    (t1.tag === "generator" && t2.tag === "class" && t2.name === "generator") ||
    // for generator<A> and generator<B>, A needs to be subtype of B
    (t1.tag === "generator" && t2.tag === "generator" && isSubtype(env, t1.type, t2.type))
  );
}
// t1: assignment value type, t2: expected type
export function isAssignable(env : GlobalTypeEnv, t1 : Type, t2 : Type) : boolean {
  return isSubtype(env, t1, t2);
}

export function isIterable(env: GlobalTypeEnv, t1: Type) : [Boolean, Type] {
  // check if t is an iterable type
  // if true, also return type of each item in the iterable
  switch (t1.tag) {
    case "either":
      return isIterable(env, t1.left) || isIterable(env, t1.right);
    case "class":
      // check if class has next and hasnext method
      // need to talk to for-loop group
      var classMethods = env.classes.get(t1.name)[1];
      if(!(classMethods.has("next") && classMethods.has("hasnext"))) {
        return [false, undefined];
      }
      return [true, classMethods.get("next")[1]];
    // assume more iterable types will be implemented by other groups
    case "generator":
    case "list":
      return [true, t1.type];
    // case "tuple":
    // case "dictionary":
    case "set":
      return [true, t1.valueType];
    // case "string": // string group makes string a literal rather than a type
    default:
      return [false, undefined];
  }
}

export function isCompType(t: Type): Boolean {
  switch (t.tag) {
    case "generator":
    // case "list":
    // case "set":
    // case "dictionary":
      return true;
    default:
      return false;
  }
}

export function join(env : GlobalTypeEnv, t1 : Type, t2 : Type) : Type {
  return NONE
}

export function isIterableObject(env : GlobalTypeEnv, t1 : Type) : boolean {
  if(t1.tag !== "class")
    return false;
  var classMethods = env.classes.get(t1.name)[1];
  if(!(classMethods.has("next") && classMethods.has("hasnext")))
    return false;
  if(equalType(classMethods.get("next")[1], NONE) || !equalType(classMethods.get("hasnext")[1], BOOL))
    return false;
  return true;
}

export function convertToIterableObject(env : GlobalTypeEnv, iterable: Expr<[Type, SourceLocation]>) : Expr<[Type, SourceLocation]> {
  if(iterable.a[0].tag === "list") {
    if(iterable.a[0].type.tag==="number")
      return {a: [CLASS("ListIteratorInt"), iterable.a[1]], tag: "call", name: "listToListIteratorInt", arguments: [iterable] };
    if(iterable.a[0].type.tag==="bool")
      return {a: [CLASS("ListIteratorBool"), iterable.a[1]], tag: "call", name: "listToListIteratorBool", arguments: [iterable] };
  }
  return iterable;
}


export function augmentTEnv(env : GlobalTypeEnv, program : Program<SourceLocation>) : GlobalTypeEnv {
  const newGlobs = new Map(env.globals);
  const newFuns = new Map(env.functions);
  const newClasses = new Map(env.classes);
  program.inits.forEach(init => newGlobs.set(init.name, init.type));
  program.funs.forEach(fun => newFuns.set(fun.name, [fun.parameters.map(p => p.type), fun.ret]));
  program.classes.forEach(cls => {
    const fields = new Map();
    const methods = new Map();
    cls.fields.forEach(field => fields.set(field.name, field.type));
    cls.methods.forEach(method => methods.set(method.name, [method.parameters.map(p => p.type), method.ret]));
    newClasses.set(cls.name, [fields, methods]);
  });
  return { globals: newGlobs, functions: newFuns, classes: newClasses };
}

export function tc(env : GlobalTypeEnv, program : Program<SourceLocation>) : [Program<[Type, SourceLocation]>, GlobalTypeEnv] {
  const locals = emptyLocalTypeEnv();
  const newEnv = augmentTEnv(env, program);
  const tInits = program.inits.map(init => tcInit(env, init));
  const tDefs = program.funs.map(fun => tcDef(newEnv, fun));
  const tClasses = program.classes.map(cls => tcClass(newEnv, cls));

  // program.inits.forEach(init => env.globals.set(init.name, tcInit(init)));
  // program.funs.forEach(fun => env.functions.set(fun.name, [fun.parameters.map(p => p.type), fun.ret]));
  // program.funs.forEach(fun => tcDef(env, fun));
  // Strategy here is to allow tcBlock to populate the locals, then copy to the
  // global env afterwards (tcBlock changes locals)
  const tBody = tcBlock(newEnv, locals, program.stmts);
  var lastTyp : Type = NONE;
  if (tBody.length){
    lastTyp = tBody[tBody.length - 1].a[0];
  }
  // TODO(joe): check for assignment in existing env vs. new declaration
  // and look for assignment consistency
  for (let name of locals.vars.keys()) {
    newEnv.globals.set(name, locals.vars.get(name));
  }
  const aprogram: Program<[Type, SourceLocation]> = {a: [lastTyp, program.a], inits: tInits, funs: tDefs, classes: tClasses, stmts: tBody};
  return [aprogram, newEnv];
}

export function tcInit(env: GlobalTypeEnv, init : VarInit<SourceLocation>) : VarInit<[Type, SourceLocation]> {
  const tcVal = tcLiteral(init.value);
  if (isAssignable(env, tcVal.a[0], init.type)) {
    return {...init, a: [NONE, init.a], value: tcVal};
  } else {
    throw new TypeCheckError("Expected type `" + init.type + "`; got type `" + tcVal.a[0] + "`", init.a);
  }
}

export function tcDef(env : GlobalTypeEnv, fun : FunDef<SourceLocation>) : FunDef<[Type, SourceLocation]> {
  var locals = emptyLocalTypeEnv();
  locals.expectedRet = fun.ret;
  locals.topLevel = false;
  fun.parameters.forEach(p => locals.vars.set(p.name, p.type));
  var tcinits: VarInit<[Type, SourceLocation]>[] = [];
  fun.inits.forEach(init => {
    const tcinit = tcInit(env, init);
    tcinits.push(tcinit);
    locals.vars.set(init.name, tcinit.type);
  });
  
  const tBody = tcBlock(env, locals, fun.body);
  if (!isAssignable(env, locals.actualRet, locals.expectedRet))
    throw new TypeCheckError(`expected return type of block: ${JSON.stringify(locals.expectedRet)} does not match actual return type: ${JSON.stringify(locals.actualRet)}`, fun.a);
  return {...fun, a:[NONE, fun.a], body: tBody, inits: tcinits};
}

export function tcClass(env: GlobalTypeEnv, cls : Class<SourceLocation>) : Class<[Type, SourceLocation]> {
  const tFields = cls.fields.map(field => tcInit(env, field));
  const tMethods = cls.methods.map(method => tcDef(env, method));
  const init = cls.methods.find(method => method.name === "__init__") // we'll always find __init__
  if (init.parameters.length !== 1 || 
    init.parameters[0].name !== "self" ||
    !equalType(init.parameters[0].type, CLASS(cls.name)) ||
    init.ret !== NONE)
    throw new TypeCheckError("Cannot override __init__ type signature", cls.a);
  return {a: [NONE, cls.a], name: cls.name, generics: cls.generics, fields: tFields, methods: tMethods};
}

export function tcBlock(env : GlobalTypeEnv, locals : LocalTypeEnv, stmts : Array<Stmt<SourceLocation>>) : Array<Stmt<[Type, SourceLocation]>> {
  var tStmts = stmts.map(stmt => tcStmt(env, locals, stmt));
  return tStmts;
}

export function tcStmt(env : GlobalTypeEnv, locals : LocalTypeEnv, stmt : Stmt<SourceLocation>) : Stmt<[Type, SourceLocation]> {
  switch(stmt.tag) {
    case "assign":
      const tValExpr = tcExpr(env, locals, stmt.value);
      console.log(tValExpr)
      var nameTyp;
      if (locals.vars.has(stmt.name)) {
        nameTyp = locals.vars.get(stmt.name);
      } else if (env.globals.has(stmt.name)) {
        nameTyp = env.globals.get(stmt.name);
      } else {
        throw new TypeCheckError("Unbound id: " + stmt.name, stmt.a);
      }
      console.log("nameTyp: ", nameTyp);
      console.log("left: ", tValExpr.a[0] );
      if(!isAssignable(env, tValExpr.a[0], nameTyp)) 
        throw new TypeCheckError("`" + tValExpr.a[0].tag + "` cannot be assigned to `" + nameTyp.tag + "` type", stmt.a);
      return {a: [NONE, stmt.a], tag: stmt.tag, name: stmt.name, value: tValExpr};
    case "assign-destr":
      var tDestr: DestructureLHS<[Type, SourceLocation]>[] = tcDestructureTargets(stmt.destr, env, locals);

      var tRhs: Expr<[Type, SourceLocation]> = tcDestructureValues(tDestr, stmt.rhs, env, locals, stmt.a);
      return {a: [NONE, stmt.a], tag: stmt.tag, destr: tDestr, rhs:tRhs}
     
    case "expr":
      const tExpr = tcExpr(env, locals, stmt.expr);
      return {a: tExpr.a, tag: stmt.tag, expr: tExpr};
    case "if":
      var tCond = tcExpr(env, locals, stmt.cond);
      const tThn = tcBlock(env, locals, stmt.thn);
      const thnTyp = locals.actualRet;
      locals.actualRet = NONE;
      const tEls = tcBlock(env, locals, stmt.els);
      const elsTyp = locals.actualRet;
      if (tCond.a[0] !== BOOL) 
        throw new TypeCheckError("Condition Expression Must be a bool", stmt.a);
      if (thnTyp !== elsTyp)
        locals.actualRet = { tag: "either", left: thnTyp, right: elsTyp }
      return {a: [thnTyp, stmt.a], tag: stmt.tag, cond: tCond, thn: tThn, els: tEls};
    case "return":
      if (locals.topLevel)
        throw new TypeCheckError("cannot return outside of functions", stmt.a);
      const tRet = tcExpr(env, locals, stmt.value);
      if (!isAssignable(env, tRet.a[0], locals.expectedRet)) 
        throw new TypeCheckError("expected return type `" + (locals.expectedRet as any).tag + "`; got type `" + (tRet.a[0] as any).tag + "`", stmt.a);
      locals.actualRet = tRet.a[0];
      return {a: tRet.a, tag: stmt.tag, value:tRet};
    case "while":
      var tCond = tcExpr(env, locals, stmt.cond);
      locals.loopCount = locals.loopCount+1;
      locals.currLoop.push(locals.loopCount);
      const tBody = tcBlock(env, locals, stmt.body);
      locals.currLoop.pop();
      if (!equalType(tCond.a[0], BOOL)) 
        throw new TypeCheckError("Condition Expression Must be a bool", stmt.a);
      return {a: [NONE, stmt.a], tag:stmt.tag, cond: tCond, body: tBody};
    case "for":
      var tVars = tcDestructureTargets(stmt.vars, env, locals);
      var tIterable = tcExpr(env, locals, stmt.iterable);
      tIterable = convertToIterableObject(env, tIterable);
      var [isIterator, tIterableRet] = isIterable(env, tIterable.a[0])
      if(!isIterator)
        throw new TypeCheckError("Not an iterable: " + tIterable.a[0], stmt.a);
      var tIterable = tcDestructureIterables(tVars, tIterable, env, locals, stmt.a);
      locals.loopCount = locals.loopCount+1;
      locals.currLoop.push(locals.loopCount);
      var tForBody = tcBlock(env, locals, stmt.body);
      locals.currLoop.pop();
      if(stmt.elseBody !== undefined) {
        const tElseBody = tcBlock(env, locals, stmt.elseBody);
        return {a: [NONE, stmt.a], tag: stmt.tag, vars: tVars, iterable: tIterable, body: tForBody, elseBody: tElseBody};
      }
      return {a: [NONE, stmt.a], tag: stmt.tag, vars: tVars, iterable: tIterable, body: tForBody};
    case "break":
      if(locals.currLoop.length === 0)
        throw new TypeCheckError("break cannot exist outside a loop", stmt.a);
      return {a: [NONE, stmt.a], tag: stmt.tag, loopCounter: locals.currLoop[locals.currLoop.length-1]};
    case "continue":
      if(locals.currLoop.length === 0)
        throw new TypeCheckError("continue cannot exist outside a loop", stmt.a);
      return {a: [NONE, stmt.a], tag: stmt.tag, loopCounter: locals.currLoop[locals.currLoop.length-1]};
    case "pass":
      return {a: [NONE, stmt.a], tag: stmt.tag};
    case "field-assign":
      var tObj = tcExpr(env, locals, stmt.obj);
      var tVal = tcExpr(env, locals, stmt.value);
      if (tObj.a[0].tag !== "class") 
        throw new TypeCheckError("field assignments require an object", stmt.a);
      if (!env.classes.has(tObj.a[0].name)) 
        throw new TypeCheckError("field assignment on an unknown class", stmt.a);
      const [fields, _] = env.classes.get(tObj.a[0].name);
      if (!fields.has(stmt.field)) 
        throw new TypeCheckError(`could not find field ${stmt.field} in class ${tObj.a[0].name}`, stmt.a);
      if (!isAssignable(env, tVal.a[0], fields.get(stmt.field)))
        throw new TypeCheckError(`could not assign value of type: ${tVal.a[0]}; field ${stmt.field} expected type: ${fields.get(stmt.field)}`, stmt.a);
      return {...stmt, a: [NONE, stmt.a], obj: tObj, value: tVal};
    case "index-assign":
      var tObj = tcExpr(env, locals, stmt.obj);
      var tIndex = tcExpr(env, locals, stmt.index);
      var tVal = tcExpr(env, locals, stmt.value);
      if (tIndex.a[0].tag != "number") {
        // if (tObj.a[0].tag === "dict") {
        //   ...
        // }
        throw new TypeCheckError(`Index is of non-integer type \`${tIndex.a[0].tag}\``, stmt.a);
      }
      if (tObj.a[0].tag === "list") {
        if (!isAssignable(env, tVal.a[0], tObj.a[0].type)) {
          throw new TypeCheckError(`Could not assign value of type: ${tVal.a[0].tag}; List expected type: ${tObj.a[0].type.tag}`, stmt.a);
        }
        return { ...stmt, a: [NONE, stmt.a], obj: tObj, index: tIndex, value: tVal };
      }
      throw new TypeCheckError(`Type \`${tObj.a[0].tag}\` does not support item assignment`, stmt.a); // Can only index-assign lists and dicts
  }
}

export function tcDestructure(env : GlobalTypeEnv, locals : LocalTypeEnv, destr : DestructureLHS<SourceLocation>) : DestructureLHS<[Type, SourceLocation]> {
  
  // If it is an Ignore variable, do an early return as we don't need
  // to type-check
  if (destr.lhs.tag === "id" && destr.lhs.name === "_") {
    return {...destr, a:[NONE, destr.a], lhs : {...destr.lhs, a: [NONE, destr.lhs.a]}}
  }

  var tcAt = tcExpr(env, locals, destr.lhs)
  // Will never come here, handled in parser
  //@ts-ignore
  return {...destr, a:[tcAt.a[0], destr.a], lhs:tcAt}
}

function tcDestructureTargets(destr: DestructureLHS<SourceLocation>[], env: GlobalTypeEnv, locals: LocalTypeEnv) : DestructureLHS<[Type, SourceLocation]>[]{
  return destr.map(r => tcDestructure(env, locals, r));
}

function tcDestructureIterables(tDestr: DestructureLHS<[Type, SourceLocation]>[], tRhs: Expr<[Type, SourceLocation]>, env: GlobalTypeEnv, locals: LocalTypeEnv, stmtLoc: SourceLocation) : Expr<[Type, SourceLocation]>{
  var hasStarred = false;
      tDestr.forEach(r => {
        hasStarred = hasStarred || r.isStarred
  })
  tcAssignTargets(env, locals, tDestr, [tRhs], hasStarred)
  return tRhs
}


function tcDestructureValues(tDestr: DestructureLHS<[Type, SourceLocation]>[], rhs:Expr<SourceLocation>, env: GlobalTypeEnv, locals: LocalTypeEnv, stmtLoc: SourceLocation) : Expr<[Type, SourceLocation]>{
  var tRhs: Expr<[Type, SourceLocation]> =  tcExpr(env, locals, rhs);

  var hasStarred = false;
      tDestr.forEach(r => {
        hasStarred = hasStarred || r.isStarred
  })

  switch(tRhs.tag) {
    case "lookup":
    case "id":
    case "method-call":
    case "binop":
      checkArbitraryTypes(locals, tDestr, tRhs.a[0], hasStarred, stmtLoc)
      return tRhs;

    case "set":
    case "non-paren-vals":
      //Code only when RHS is of type literals
      if(checkDestrLength(tDestr, tRhs.values, hasStarred)) {
          tcAssignTargets(env, locals, tDestr, tRhs.values, hasStarred)
          return tRhs
      }
      else throw new TypeCheckError("length mismatch left and right hand side of assignment expression.", stmtLoc)

    case "call":
      if(tRhs.a[0].tag === "class"){ 
        tcAssignTargets(env, locals, tDestr, [tRhs], hasStarred)
        return tRhs
      } 
      checkArbitraryTypes(locals, tDestr, tRhs.a[0], hasStarred, stmtLoc)
      return tRhs;
      

    case "listliteral":
      if(checkDestrLength(tDestr, tRhs.elements, hasStarred)) {
        tcAssignTargets(env, locals, tDestr, tRhs.elements, hasStarred)
        return tRhs
      }
      else throw new TypeCheckError("length mismatch left and right hand side of assignment expression.", stmtLoc)
      
    default:
      throw new Error("not supported expr type for destructuring")
  }
}

function checkArbitraryTypes(env: LocalTypeEnv, tDestr: DestructureLHS<[Type, SourceLocation]>[], rhsType : Type, hasStarred : boolean, stmtLoc: SourceLocation) {
  if (rhsType.tag === "list" || rhsType.tag === "set") {
    tDestr.forEach(r => {

      if (r.isIgnore) {
        return
      }

      //@ts-ignore
      if (!r.isStarred && !isAssignable(env, r.lhs.a[0], rhsType.type) || r.isStarred && !isAssignable(env, r.lhs.a[0].type, rhsType.type)) {
        throw new TypeCheckError("Type Mismatch while destructuring assignment", r.lhs.a[1])
      }
    })
  } else {throw new TypeCheckError(`cannot unpack ${rhsType.tag}`, stmtLoc)}
}

function checkDestrLength(tDestr: DestructureLHS<[Type, SourceLocation]>[], tRhs : Expr<[Type, SourceLocation]>[], hasStarred : boolean): boolean {
  
  //TODO logic has to change - when all iterables are introduced
  var isIterablePresent = checkIterablePresence(tRhs)

  // TODO : Consider starred expressions
  if (tDestr.length === tRhs.length || 
    (hasStarred && tDestr.length < tRhs.length)||
    (hasStarred && tDestr.length-1 === tRhs.length) || 
    isIterablePresent) {
      return true
  }

  return false

}

function checkIterablePresence(values : Expr<[Type, SourceLocation]>[]): boolean {
  var isIterablePresent = false
  values.forEach(r => {
    //@ts-ignore
    if(r.a[0].tag==="class") { 
      isIterablePresent = true;
    }
  })
  return isIterablePresent
}


/** Function to check types of destructure assignments */
function tcAssignTargets(env: GlobalTypeEnv, locals: LocalTypeEnv, tDestr: DestructureLHS<[Type, SourceLocation]>[], tRhs: Expr<[Type, SourceLocation]>[], hasStarred: boolean) {
  
  let lhs_index = 0
  let rhs_index = 0

  while (lhs_index < tDestr.length && rhs_index < tRhs.length) {
    if (tDestr[lhs_index].isStarred) {
      break;
    } else if (tDestr[lhs_index].isIgnore) {
      lhs_index++
      rhs_index++
    } else {
      //@ts-ignore
      if(tRhs[rhs_index].a[0].tag==="class") {
        //FUTURE: support range class added by iterators team, currently supports range class added from code
        //@ts-ignore
        var clsName = tRhs[rhs_index].a[0].name
        if (env.classes.get(clsName)[1].get('next')==null) {
          throw new TypeCheckError(`Iterator ${clsName} doesn't have next function.`, tDestr[lhs_index].lhs.a[1])
        }
        var expectedRhsType:Type = env.classes.get(clsName)[1].get('next')[1];
        //checking type of lhs with type of return of iterator
        //Length mismatch from iterables will be RUNTIME ERRORS
        if(!isAssignable(env, tDestr[lhs_index].lhs.a[0], expectedRhsType)) {
          throw new TypeCheckError("Type Mismatch while destructuring assignment", tDestr[lhs_index].lhs.a[1])
        } else {
          lhs_index++
          rhs_index++
        }
      } else if (!isAssignable(env, tDestr[lhs_index].lhs.a[0], tRhs[rhs_index].a[0])) {
          throw new TypeCheckError("Type Mismatch while destructuring assignment", tDestr[lhs_index].lhs.a[1])
      } else {
        lhs_index++
        rhs_index++
      }
    }
  
  }


  let rev_lhs_index = tDestr.length - 1;
  let rev_rhs_index = tRhs.length - 1;  
  // Only doing this reverse operation in case of starred
  if (hasStarred) {
    if (lhs_index === tDestr.length - 1 && rhs_index === tRhs.length) {
      return
    } else {
      while (rev_lhs_index > lhs_index) {
        if (tDestr[rev_lhs_index].isIgnore) {
          rev_rhs_index--
          rev_lhs_index--
        } else if (!isAssignable(env, tDestr[rev_lhs_index].lhs.a[0], tRhs[rev_rhs_index].a[0])) {
          throw new TypeCheckError("Type Mismatch while destructuring assignment", tDestr[rev_lhs_index].lhs.a[1])
        } else {
          rev_rhs_index--
          rev_lhs_index--
        }
      }
    }
  }


  //Check starred expression type vs remaining values
  if (hasStarred && rev_rhs_index >= lhs_index) {
    // Get type of the starred expression
    if (tDestr[lhs_index].lhs.a[0].tag !== "list") {
      throw new TypeCheckError("Unsupported Type for starred expression destructuring", tDestr[lhs_index].lhs.a[1])
    }

    if (tRhs[rev_rhs_index].a[0].tag==="class") {
      //@ts-ignore
      var clsName = tRhs[rev_rhs_index].a[0].name
      if (env.classes.get(clsName)[1].get('next')==null) {
        throw new TypeCheckError(`Iterator ${clsName} doesn't have next function.`, tDestr[lhs_index].lhs.a[1])
      }
      var expectedRhsType:Type = env.classes.get(clsName)[1].get('next')[1];
      //checking type of lhs with type of return of iterator
      //Length mismatch from iterables will be RUNTIME ERRORS
      //@ts-ignore
      if(!isAssignable(env, tDestr[lhs_index].lhs.a[0].type, expectedRhsType)) {
        throw new TypeCheckError("Type Mismatch while destructuring assignment", tDestr[lhs_index].lhs.a[1])
      } 
    } //@ts-ignore  
    else if (!isAssignable(env, tDestr[lhs_index].lhs.a[0].type, tRhs[rev_rhs_index].a[0])) {
      throw new TypeCheckError("Type Mismatch while destructuring assignment", tDestr[lhs_index].lhs.a[1])
    } 
    rev_rhs_index--
  }
  
}

export function tcExpr(env : GlobalTypeEnv, locals : LocalTypeEnv, expr : Expr<SourceLocation>) : Expr<[Type, SourceLocation]> {
  switch(expr.tag) {
    case "set":
      let tc_val = expr.values.map((e) => tcExpr(env, locals, e));
      let tc_type = tc_val.map((e) => e.a[0]);
      let set_type = new Set<Type>();
      tc_type.forEach(t=>{
        set_type.add(t)
      });
      if (set_type.size > 1){
        throw new TypeCheckError("Bracket attribute error")
      }
      var t: Type ={tag: "set", valueType: tc_type[0]};
      var a: SourceLocation = expr.a;
      // return {...expr, a: [t, a]};
      return {...expr, a: [t, a], values: tc_val};
    case "literal": 
      const tcVal : Literal<[Type, SourceLocation]> = tcLiteral(expr.value)
      return {...expr, a: [tcVal.a[0], expr.a], value: tcVal};
    case "binop":
      const tLeft = tcExpr(env, locals, expr.left);
      const tRight = tcExpr(env, locals, expr.right);
      const tBin = {...expr, left: tLeft, right: tRight};
      switch(expr.op) {
        case BinOp.Plus:
        case BinOp.Minus:
        case BinOp.Mul:
        case BinOp.IDiv:
        case BinOp.Mod:
          if(equalType(tLeft.a[0], NUM) && equalType(tRight.a[0], NUM)) { return {...tBin, a: [NUM, expr.a]}}
          else { throw new TypeCheckError("Type mismatch for numeric op" + expr.op, expr.a); }
        case BinOp.Eq:
        case BinOp.Neq:
          if(tLeft.a[0].tag === "class" || tRight.a[0].tag === "class") throw new TypeCheckError("cannot apply operator '==' on class types", expr.a)
          if(equalType(tLeft.a[0], tRight.a[0])) { return {...tBin, a: [BOOL, expr.a]} ; }
          else { throw new TypeCheckError("Type mismatch for op" + expr.op, expr.a);}
        case BinOp.Lte:
        case BinOp.Gte:
        case BinOp.Lt:
        case BinOp.Gt:
          if(equalType(tLeft.a[0], NUM) && equalType(tRight.a[0], NUM)) { return {...tBin, a: [BOOL, expr.a]} ; }
          else { throw new TypeCheckError("Type mismatch for op" + expr.op, expr.a); }
        case BinOp.And:
        case BinOp.Or:
          if(equalType(tLeft.a[0], BOOL) && equalType(tRight.a[0], BOOL)) { return {...tBin, a: [BOOL, expr.a]} ; }
          else { throw new TypeCheckError("Type mismatch for boolean op" + expr.op, expr.a); }
        case BinOp.Is:
          if(!isNoneOrClass(tLeft.a[0]) || !isNoneOrClass(tRight.a[0]))
            throw new TypeCheckError("is operands must be objects", expr.a);
          return {...tBin, a: [BOOL, expr.a]};
      }
    case "uniop":
      const tExpr = tcExpr(env, locals, expr.expr);
      const tUni = {...expr, a: tExpr.a, expr: tExpr}
      switch(expr.op) {
        case UniOp.Neg:
          if(equalType(tExpr.a[0], NUM)) { return tUni }
          else { throw new TypeCheckError("Type mismatch for op" + expr.op, expr.a);}
        case UniOp.Not:
          if(equalType(tExpr.a[0], BOOL)) { return tUni }
          else { throw new TypeCheckError("Type mismatch for op" + expr.op, expr.a);}
      }
    case "id":
      // check if id is used for comprehension
      const compvarName = retrieveCompvar(expr.name);
      if (env.globals.has(compvarName)) {
        return {...expr, a: [env.globals.get(compvarName), expr.a], name: compvarName};
      }
      if (locals.vars.has(expr.name)) {
        return {...expr, a: [locals.vars.get(expr.name), expr.a]};
      } else if (env.globals.has(expr.name)) {
        return {...expr, a: [env.globals.get(expr.name), expr.a]};
      } else {
        throw new TypeCheckError("Unbound id: " + expr.name, expr.a);
      }
    case "listliteral":
      if(expr.elements.length == 0) {
        const elements: Expr<[Type, SourceLocation]>[] = [];
        return {...expr, elements, a: [{tag: "list", type: NONE}, expr.a]};
      }

      const elementsWithTypes: Array<Expr<[Type, SourceLocation]>> = [];

      const checked0 = tcExpr(env, locals, expr.elements[0]);
      const proposedType = checked0.a[0]; //type of the 1st element in list
      elementsWithTypes.push(checked0);

      //check that all other elements have the same type as the first element
      //TODO: account for the case where the first element could be None and the rest are objects of some class
      for(let i = 1; i < expr.elements.length; i++) {
        const checkedI = tcExpr(env, locals, expr.elements[i]);
        const elementType = checkedI.a[0];

        //TODO: make error message better, use the name of the class if it's an object
        //also update condition to account for subtypes
        if(!isAssignable(env, elementType, proposedType)) {
          throw new TypeError("List has incompatible types: " + elementType.tag + " and " + proposedType.tag);
        }

        elementsWithTypes.push(checkedI); //add expression w/ type annotation to new elements list
      }

      return {...expr, elements: elementsWithTypes, a: [{tag: "list", type: proposedType}, expr.a]};
    case "index":
      var tObj: Expr<[Type, SourceLocation]> = tcExpr(env, locals, expr.obj);
      var tIndex: Expr<[Type, SourceLocation]> = tcExpr(env, locals, expr.index);
      if (tIndex.a[0].tag !== "number") {
        // if (tObj.a[0].tag === "dict") {
        //   ...
        // }
        throw new TypeCheckError(`Index is of non-integer type \`${tIndex.a[0].tag}\``);
      }
      // if (equalType(tObj.a[0], CLASS("str"))) {
      //   return { a: [{ tag: "class", name: "str" }, expr.a], tag: "index", obj: tObj, index: tIndex };
      // }
      if (tObj.a[0].tag === "list") {
        return { ...expr, a: [tObj.a[0].type, expr.a], obj: tObj, index: tIndex }; 
      }
      // if (tObj.a[0].tag === "tuple") {
      //   ...
      // }
      throw new TypeCheckError(`Cannot index into type \`${tObj.a[0].tag}\``); // Can only index into strings, list, dicts, and tuples
    case "call":
      if (expr.name === "print") {
        if (expr.arguments.length===0)
          throw new TypeCheckError("print needs at least 1 argument");
        const tArgs = expr.arguments.map(arg => tcExpr(env, locals, arg));
        return {...expr, a: [NONE, expr.a], arguments: tArgs};
      } 
      if(env.classes.has(expr.name)) {
        // surprise surprise this is actually a constructor
        const tConstruct : Expr<[Type, SourceLocation]> = { a: [CLASS(expr.name), expr.a], tag: "construct", name: expr.name };

        const [_, methods] = env.classes.get(expr.name);
        if (methods.has("__init__")) {
          const [initArgs, initRet] = methods.get("__init__");
          if (expr.arguments.length !== initArgs.length - 1)
            throw new TypeCheckError("__init__ didn't receive the correct number of arguments from the constructor", expr.a);
          if (initRet !== NONE) 
            throw new TypeCheckError("__init__  must have a void return type", expr.a);
          return tConstruct;
        } else {
          return tConstruct;
        }
      } else if(env.functions.has(expr.name)) {
        const [argTypes, retType] = env.functions.get(expr.name);
        const tArgs = expr.arguments.map(arg => tcExpr(env, locals, arg));
        console.log(tArgs);

        if(argTypes.length === expr.arguments.length &&
           tArgs.every((tArg, i) => isAssignable(env, tArg.a[0], argTypes[i]))) {
             return {...expr, a: [retType, expr.a], arguments: tArgs};
           } else {
            throw new TypeCheckError("Function call type mismatch: " + expr.name, expr.a);
           }
      } else if (expr.name === "set") {
        if (expr.arguments.length > 1){
          throw new Error("Set constructor can only contain element with length 1");
        }
        if (expr.arguments[0].tag !== "set"){
          throw new Error("Set constructor can only accept bracket variable");
        }
        var initial_value = tcExpr(env, locals, expr.arguments[0]);
        console.log("hello", {...expr, a: initial_value.a, arguments: [initial_value]})
        return {...expr, a: initial_value.a, arguments: [initial_value]};
      } else if (expr.name == "iter") {
          if(expr.arguments.length != 1)
            throw new TypeCheckError("iter() only accepts an iterator", expr.a) 
          const tArgs = expr.arguments.map(arg => tcExpr(env, locals, arg));
          if(!isIterable(env, tArgs[0].a[0])[0])
            throw new TypeCheckError("iter() only accepts an iterator", expr.a) 
          return convertToIterableObject(env, tArgs[0])
      } else if (expr.name == "next") {
          if(expr.arguments.length != 1)
            throw new TypeCheckError("iter() only accepts an iterator", expr.a) 
          const tArgs = expr.arguments.map(arg => tcExpr(env, locals, arg));
            if(!isIterableObject(env, tArgs[0].a[0]))
              throw new TypeCheckError("next() only accepts an iterator", expr.a) 
            //@ts-ignore
            const [_, methods] = env.classes.get(tArgs[0].a[0].name);
            const [methodArgs, methodRet] = methods.get(expr.name);
          return { a: [ methodRet, expr.a], tag: "method-call", obj: tArgs[0], method: "next", arguments: []}
      } else {
        throw new TypeCheckError("Undefined function: " + expr.name, expr.a);
      }
    case "lookup":
      var tObj = tcExpr(env, locals, expr.obj);
      if (tObj.a[0].tag === "class") {
        if (env.classes.has(tObj.a[0].name)) {
          const [fields, _] = env.classes.get(tObj.a[0].name);
          if (fields.has(expr.field)) {
            return {...expr, a: [fields.get(expr.field), expr.a], obj: tObj};
          } else {
            throw new TypeCheckError(`could not found field ${expr.field} in class ${tObj.a[0].name}`, expr.a);
          }
        } else {
          throw new TypeCheckError("field lookup on an unknown class", expr.a);
        }
      } else {
        throw new TypeCheckError("field lookups require an object", expr.a);
      }
    case "method-call":
      var tObj = tcExpr(env, locals, expr.obj);
      var tArgs = expr.arguments.map(arg => tcExpr(env, locals, arg));
      if (tObj.a[0].tag === "class") {
        if (env.classes.has(tObj.a[0].name)) {
          const [_, methods] = env.classes.get(tObj.a[0].name);
          if (methods.has(expr.method)) {
            const [methodArgs, methodRet] = methods.get(expr.method);
            const realArgs = [tObj].concat(tArgs);
            if(methodArgs.length === realArgs.length &&
              methodArgs.every((argTyp, i) => isAssignable(env, realArgs[i].a[0], argTyp))) {
                return {...expr, a: [methodRet, expr.a], obj: tObj, arguments: tArgs};
              } else {
               throw new TypeCheckError(`Method call type mismatch: ${expr.method} --- callArgs: ${JSON.stringify(realArgs)}, methodArgs: ${JSON.stringify(methodArgs)}`, expr.a );
              }
          } else {
            throw new TypeCheckError(`could not found method ${expr.method} in class ${tObj.a[0].name}`, expr.a);
          }
        } else {
          throw new TypeCheckError("method call on an unknown class", expr.a);
        }
      } else if (tObj.a[0].tag === 'set'){
        const set_method = ["add", "remove", "get", "contains", "length"]
        if (set_method.includes(expr.method)){
          tArgs.forEach(t => {
            if (t.tag === "literal"&&tObj.a[0].tag === 'set'){
              if (t.value.a[0] !== tObj.a[0].valueType){
                throw new TypeCheckError("Mismatched Type when calling method")
              }
            }else{
              throw new TypeCheckError("Unknown Type when calling method")
            }
          })
        }else{
          throw new TypeCheckError("Unknown Set Method Error");
        }
        if (expr.method === "contains"){
          return {...expr, a: [BOOL, expr.a], obj: tObj, arguments: tArgs};
        }else if(expr.method === "add"){
          return {...expr, a: [NONE, expr.a], obj: tObj, arguments: tArgs};
        }else if(expr.method === "remove"){
          return {...expr, a: [NONE, expr.a], obj: tObj, arguments: tArgs};
        } else if(expr.method === "length"){
          return {...expr, a: [NUM, expr.a], obj: tObj, arguments: tArgs};
        }
        return {...expr, a:tObj.a, obj: tObj, arguments: tArgs}
      } else {
        throw new TypeCheckError("method calls require an object", expr.a);
      }
    case "ternary":
      const tExprIfTrue = tcExpr(env, locals, expr.exprIfTrue);
      const tIfCond = tcExpr(env, locals, expr.ifcond);
      const tExprIfFalse = tcExpr(env, locals, expr.exprIfFalse);
      if (!equalType(tIfCond.a[0], BOOL)) {
        throw new TypeCheckError("if condition must be a bool");
      }
      const exprIfTrueTyp = tExprIfTrue.a[0];
      const exprIfFalseTyp = tExprIfFalse.a[0];
      if (equalType(exprIfTrueTyp, exprIfFalseTyp)) {
        return { ...expr, a: [exprIfTrueTyp, expr.a], exprIfTrue: tExprIfTrue, ifcond: tIfCond, exprIfFalse: tExprIfFalse };
      }
      const eitherTyp : Type = { tag: "either", left: exprIfTrueTyp, right: exprIfFalseTyp };
      return { ...expr, a: [eitherTyp, expr.a], exprIfTrue: tExprIfTrue, ifcond: tIfCond, exprIfFalse: tExprIfFalse };
    case "comprehension":
      const tIterable = tcExpr(env, locals, expr.iterable);
      const [iterable, itemTyp] = isIterable(env, tIterable.a[0])
      if (!iterable) {
        throw new TypeCheckError(`Type ${tIterable.a[0]} is not iterable`);
      }
      // shadow item name always globally
      const newItemName = generateCompvar(expr.item);
      env.globals.set(newItemName, itemTyp);
      var tCompIfCond = undefined;
      if (expr.ifcond) {
        tCompIfCond = tcExpr(env, locals, expr.ifcond);
        if (!equalType(tCompIfCond.a[0], BOOL)) {
          throw new TypeCheckError("if condition must be a bool");
        }
      }
      const tLhs = tcExpr(env, locals, expr.lhs);
      // TODO: need to talk to the other groups
      if (expr.type.tag == "generator" 
        || expr.type.tag == "list"
      ) {
        expr.type = { ...(expr.type), type: itemTyp };
      }
      if (expr.type.tag == "set"
        // || expr.type.tag == "dictionary"
      ) {
        expr.type = { ...(expr.type), valueType: itemTyp };
      }
      // delete comp var name from globals
      env.globals.delete(newItemName);
      return { ...expr, a: [expr.type, expr.a], lhs: tLhs, item: newItemName, iterable: tIterable, ifcond: tCompIfCond };

    case "non-paren-vals":
      const nonParenVals = expr.values.map((val) => tcExpr(env, locals, val));
      return { ...expr, a: [NONE, expr.a], values: nonParenVals };
  
    default: throw new TypeCheckError(`unimplemented type checking for expr: ${expr}`, expr.a);
  }
}

export function tcLiteral(literal : Literal<SourceLocation>) : Literal<[Type, SourceLocation]> {
  var typ : Type;
  switch(literal.tag) {
    case "bool": 
      typ = BOOL;
      break;
    case "num": 
      typ =  NUM;
      break;
    case "none": 
      typ =  NONE;
      break;
    default: throw new Error(`unknown type: ${literal.tag}`)
  }
  return {...literal, a: [typ, literal.a]}
}
