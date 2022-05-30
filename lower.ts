import * as AST from './ast';
import * as IR from './ir';
import { Type, SourceLocation } from './ast';
import { GlobalEnv } from './compiler';
import { NUM, BOOL, NONE, CLASS } from "./utils";
import { createModuleResolutionCache } from 'typescript';
import { defaultMaxListeners } from 'events';

const nameCounters : Map<string, number> = new Map();
function generateName(base : string) : string {
  if(nameCounters.has(base)) {
    var cur = nameCounters.get(base);
    nameCounters.set(base, cur + 1);
    return base + (cur + 1);
  }
  else {
    nameCounters.set(base, 1);
    return base + 1;
  }
}

// function lbl(a: Type, base: string) : [string, IR.Stmt<[Type, SourceLocation]>] {
//   const name = generateName(base);
//   return [name, {tag: "label", a: a, name: name}];
// }

export function lowerProgram(p : AST.Program<[Type, SourceLocation]>, env : GlobalEnv) : IR.Program<[Type, SourceLocation]> {
    resetLoopLabels();
    var blocks : Array<IR.BasicBlock<[Type, SourceLocation]>> = [];
    var firstBlock : IR.BasicBlock<[Type, SourceLocation]> = {  a: p.a, label: generateName("$startProg"), stmts: [] }
    blocks.push(firstBlock);
    var inits = flattenStmts(p.stmts, blocks, env);
    return {
        a: p.a,
        funs: lowerFunDefs(p.funs, env),
        inits: [...inits, ...lowerVarInits(p.inits, env)],
        classes: lowerClasses(p.classes, env),
        body: blocks
    }
}

function lowerFunDefs(fs : Array<AST.FunDef<[Type, SourceLocation]>>, env : GlobalEnv) : Array<IR.FunDef<[Type, SourceLocation]>> {
    return fs.map(f => lowerFunDef(f, env)).flat();
}

function lowerFunDef(f : AST.FunDef<[Type, SourceLocation]>, env : GlobalEnv) : IR.FunDef<[Type, SourceLocation]> {
  var blocks : Array<IR.BasicBlock<[Type, SourceLocation]>> = [];
  var firstBlock : IR.BasicBlock<[Type, SourceLocation]> = {  a: f.a, label: generateName("$startFun"), stmts: [] }
  blocks.push(firstBlock);
  var bodyinits = flattenStmts(f.body, blocks, env);
    return {...f, inits: [...bodyinits, ...lowerVarInits(f.inits, env)], body: blocks}
}

function lowerVarInits(inits: Array<AST.VarInit<[Type, SourceLocation]>>, env: GlobalEnv) : Array<IR.VarInit<[Type, SourceLocation]>> {
    return inits.map(i => lowerVarInit(i, env));
}

function lowerVarInit(init: AST.VarInit<[Type, SourceLocation]>, env: GlobalEnv) : IR.VarInit<[Type, SourceLocation]> {
    return {
        ...init,
        value: literalToVal(init.value)
    }
}

function lowerClasses(classes: Array<AST.Class<[Type, SourceLocation]>>, env : GlobalEnv) : Array<IR.Class<[Type, SourceLocation]>> {
    return classes.map(c => lowerClass(c, env));
}

function lowerClass(cls: AST.Class<[Type, SourceLocation]>, env : GlobalEnv) : IR.Class<[Type, SourceLocation]> {
    return {
        ...cls,
        fields: lowerVarInits(cls.fields, env),
        methods: lowerFunDefs(cls.methods, env)
    }
}

function literalToVal(lit: AST.Literal<[Type, SourceLocation]>) : IR.Value<[Type, SourceLocation]> {
    switch(lit.tag) {
        case "num":
            return { ...lit, value: BigInt(lit.value), a:[NUM, lit.a[1]] }
        case "bool":
            return {...lit, a:[BOOL, lit.a[1]]}
        case "none":
            return {...lit, a:[NONE, lit.a[1]]}        
    }
}

function flattenStmts(s : Array<AST.Stmt<[Type, SourceLocation]>>, blocks: Array<IR.BasicBlock<[Type, SourceLocation]>>, env : GlobalEnv) : Array<IR.VarInit<[Type, SourceLocation]>> {
  var inits: Array<IR.VarInit<[Type, SourceLocation]>> = [];
  s.forEach(stmt => {
    inits.push(...flattenStmt(stmt, blocks, env));
  });
  return inits;
}

function flattenStmt(s : AST.Stmt<[Type, SourceLocation]>, blocks: Array<IR.BasicBlock<[Type, SourceLocation]>>, env : GlobalEnv) : Array<IR.VarInit<[Type, SourceLocation]>> {
  switch(s.tag) {
    case "assign":
      var [valinits, valstmts, vale] = flattenExprToExpr(s.value, blocks, env);
      blocks[blocks.length - 1].stmts.push(...valstmts, { a: s.a, tag: "assign", name: s.name, value: vale});
      return valinits
      // return [valinits, [
      //   ...valstmts,
      //   { a: s.a, tag: "assign", name: s.name, value: vale}
      // ]];
    case "assign-destr":
      var allinits:Array<IR.VarInit<[Type, SourceLocation]>> = []
      var lhs = s.destr
      var rhs = s.rhs
      lowerAllDestructureAssignments(blocks, lhs, rhs, env, allinits, s.a[1]);
      return allinits
    case "return":
    var [valinits, valstmts, val] = flattenExprToVal(s.value, blocks, env);
    blocks[blocks.length - 1].stmts.push(
         ...valstmts,
         {tag: "return", a: s.a, value: val}
    );
    return valinits;
    // return [valinits, [
    //     ...valstmts,
    //     {tag: "return", a: s.a, value: val}
    // ]];
  
    case "expr":
      var [inits, stmts, e] = flattenExprToExpr(s.expr, blocks, env);
      blocks[blocks.length - 1].stmts.push(
        ...stmts, {tag: "expr", a: s.a, expr: e }
      );
      return inits;
    //  return [inits, [ ...stmts, {tag: "expr", a: s.a, expr: e } ]];

    case "pass":
      return [];

    case "field-assign": {
      var [oinits, ostmts, oval] = flattenExprToVal(s.obj, blocks, env);
      var [ninits, nstmts, nval] = flattenExprToVal(s.value, blocks, env);
      if(s.obj.a[0].tag !== "class") { throw new Error("Compiler's cursed, go home."); }
      const classdata = env.classes.get(s.obj.a[0].name);
      const offset : IR.Value<[Type, SourceLocation]> = { a:s.a, tag: "wasmint", value: classdata.get(s.field)[0] };
      pushStmtsToLastBlock(blocks,
        ...ostmts, ...nstmts, {
          tag: "store",
          a: s.a,
          start: oval,
          offset: offset,
          value: nval
        });
      return [...oinits, ...ninits];
    }
    
    case "index-assign": {
      var [oinits, ostmts, oval] = flattenExprToVal(s.obj, blocks, env);
      const [iinits, istmts, ival] = flattenExprToVal(s.index, blocks, env);
      var [ninits, nstmts, nval] = flattenExprToVal(s.value, blocks, env);

      const offsetValue: IR.Value<[Type, SourceLocation]> = listIndexOffsets(iinits, istmts, ival, oval);

      if (s.obj.a[0].tag === "list") {
        pushStmtsToLastBlock(blocks,
          ...ostmts, ...istmts, ...nstmts, {
            tag: "store",
            a: s.a,
            start: oval,
            offset: offsetValue,
            value: nval
          });
        return [...oinits, ...iinits, ...ninits];
      }
      // if (s.obj.a[0].tag === "dict") {
      //   ...
      // }

      else { throw new Error("Compiler's cursed, go home."); }
    }

    case "if":
      var thenLbl = generateName("$then")
      var elseLbl = generateName("$else")
      var endLbl = generateName("$end")
      var endjmp : IR.Stmt<[Type, SourceLocation]> = { a:s.a, tag: "jmp", lbl: endLbl };
      var [cinits, cstmts, cexpr] = flattenExprToVal(s.cond, blocks, env);
      var condjmp : IR.Stmt<[Type, SourceLocation]> = { a:s.a, tag: "ifjmp", cond: cexpr, thn: thenLbl, els: elseLbl };
      pushStmtsToLastBlock(blocks, ...cstmts, condjmp);
      blocks.push({  a: s.a, label: thenLbl, stmts: [] })
      var theninits = flattenStmts(s.thn, blocks, env);
      pushStmtsToLastBlock(blocks, endjmp);
      blocks.push({  a: s.a, label: elseLbl, stmts: [] })
      var elseinits = flattenStmts(s.els, blocks, env);
      pushStmtsToLastBlock(blocks, endjmp);
      blocks.push({  a: s.a, label: endLbl, stmts: [] })
      return [...cinits, ...theninits, ...elseinits]

      // return [[...cinits, ...theninits, ...elseinits], [
      //   ...cstmts, 
      //   condjmp,
      //   startlbl,
      //   ...thenstmts,
      //   endjmp,
      //   elslbl,
      //   ...elsestmts,
      //   endjmp,
      //   endlbl,
      // ]];
    
    case "while":
      var whileStartLbl = generateName("$whilestart");
      var whilebodyLbl = generateName("$whilebody");
      var whileEndLbl = generateName("$whileend");

      pushStmtsToLastBlock(blocks, { a: s.a, tag: "jmp", lbl: whileStartLbl })
      blocks.push({  a: s.a, label: whileStartLbl, stmts: [] })
      var [cinits, cstmts, cexpr] = flattenExprToVal(s.cond, blocks, env);
      pushStmtsToLastBlock(blocks, ...cstmts, { a: s.a, tag: "ifjmp", cond: cexpr, thn: whilebodyLbl, els: whileEndLbl });

      blocks.push({  a: s.a, label: whilebodyLbl, stmts: [] })
      var bodyinits = flattenStmts(s.body, blocks, env);
      pushStmtsToLastBlock(blocks, { a:s.a, tag: "jmp", lbl: whileStartLbl });

      blocks.push({  a: s.a, label: whileEndLbl, stmts: [] })

      return [...cinits, ...bodyinits]
    
    case "for":
      var forStartLbl = generateName("$whilestart");
      var forbodyLbl = generateName("$whilebody");
      var forElseLbl = generateName("$forelse")
      var forEndLbl = generateName("$whileend");
      var iterableObject = generateName("$iterableobject")  
      
      var [iter_inits, iter_stmts, iter_expr] = flattenExprToExpr(s.iterable, blocks, env);
      
      pushStmtsToLastBlock(blocks, ...iter_stmts, {a:[NONE, s.a[1]],  tag: "assign", name: iterableObject, value: iter_expr} );
      pushStmtsToLastBlock(blocks, { tag: "jmp", lbl: forStartLbl })
      blocks.push({  a: s.a, label: forStartLbl, stmts: [] })

      let condExpr:AST.Expr<[AST.Type, SourceLocation]>  = { a:[BOOL, s.a[1]], tag: "method-call", obj: {a:s.iterable.a, tag: "id", name: iterableObject} , method: "hasnext", arguments: []}
      var [cinits, cstmts, cexpr] = flattenExprToVal(condExpr, blocks, env);
      pushStmtsToLastBlock(blocks, ...cstmts, { tag: "ifjmp", cond: cexpr, thn: forbodyLbl, els: forElseLbl });
      blocks.push({  a: s.a, label: forbodyLbl, stmts: [] })

      const iterVal: AST.Expr<[AST.Type, SourceLocation]> = {a: s.a, tag: "method-call", obj: {a:s.iterable.a, tag: "id", name: iterableObject} , method: "next", arguments: []}
      var [s_inits, s_stmts, s_expr] = flattenExprToExpr(iterVal, blocks, env);

      // pushStmtsToLastBlock(blocks, ...s_stmts, {a:[NONE, s.a[1]],  tag: "assign", name: s.vars.name, value: s_expr } );
      
      // const destructStatment: AST.Stmt <[AST.Type, AST.SourceLocation]>[]  = [];
      // destructStatment.push({a: [NONE, s.a[1]], tag: "assign-destr", destr: s.vars, rhs:s.iterable })
      // var destructinits = flattenStmts( destructStatment, blocks, env );

      var allinits:Array<IR.VarInit<[Type, SourceLocation]>> = []
      var lhs = s.vars
      var rhs = s.iterable
      lowerAllDestructureForAssignments(blocks, lhs, rhs, env, allinits, iterableObject, s.a[1]);
     // return allinits

    //  pushStmtsToLastBlock(blocks, ...s_stmts, {a:[NONE, s.a[1]],  tag: "assign", name: s.vars.name, value: s_expr } );
      
      var bodyinits = flattenStmts(s.body, blocks, env);
      pushStmtsToLastBlock(blocks, { tag: "jmp", lbl: forStartLbl });
      blocks.push({  a: s.a, label: forElseLbl, stmts: [] })

      var elsebodyinits = flattenStmts(s.elseBody, blocks, env);
      pushStmtsToLastBlock(blocks, { tag: "jmp", lbl: forEndLbl });
      blocks.push({  a: s.a, label: forEndLbl, stmts: [] })

      return [...iter_inits, ...cinits, ...s_inits, ...bodyinits, ...allinits, ...elsebodyinits, { a: s.iterable.a, name: iterableObject, type: s.iterable.a[0], value: { tag: "none" } }]
    
    case "break":
      var counter = s.loopCounter;
      pushStmtsToLastBlock(blocks, { tag: "jmp", lbl: "$whileend" + counter});
      return []
    case "continue":
      var counter = s.loopCounter;
      pushStmtsToLastBlock(blocks, { tag: "jmp", lbl: "$whilestart" + counter});
      return []
  }
}

function lowerAllDestructureForAssignments(blocks: { a?: [AST.Type, AST.SourceLocation]; label: string; stmts: IR.Stmt<[AST.Type, AST.SourceLocation]>[]; }[], lhs: AST.DestructureLHS<[AST.Type, AST.SourceLocation]>[], rhs: AST.Expr<[AST.Type, AST.SourceLocation]>, env: GlobalEnv, allinits: Array<IR.VarInit<[Type, SourceLocation]>>,iterableObject: string ,dummyLoc:SourceLocation) {
  let lhs_index = 0
  let rhs_index = 0
  let rhs_vals = [rhs]
  while (lhs_index < lhs.length && rhs_index < rhs_vals.length) {
    let l = lhs[lhs_index].lhs
    let r = rhs_vals[rhs_index]
    if(r.a[0].tag==="class"){ //for all iterable classes
      var [valinits, valstmts, va] = flattenExprToVal(r, blocks, env);
      allinits.push(...valinits);
      pushStmtsToLastBlock(blocks, ...valstmts);
      const iterClassName = r.a[0].name;
      if(va.tag==="id"){
        var dummyNext: AST.Expr<[Type, SourceLocation]> = { tag: "method-call", obj: {a:rhs.a, tag: "id", name: iterableObject}, method: `next`, arguments: [] , a:[{ tag: "none" }, dummyLoc]}
        var dummyHasNext: AST.Expr<[Type, SourceLocation]> = { tag: "method-call", obj: {a:rhs.a, tag: "id", name: iterableObject},method: `hasnext`, arguments: [] , a:[{ tag: "none" }, dummyLoc]}        
        //will probably fail for cases like 'a,b,c = range(1,3),5
        while(lhs_index < lhs.length){
          l = lhs[lhs_index].lhs
          var [inits, stmts, val] = flattenExprToVal(dummyHasNext, blocks, env);
          pushStmtsToLastBlock(blocks, ...stmts);
          allinits.push(...inits);
          lowerDestructAssignment(blocks, l, dummyNext, env, allinits);
          lhs_index++;
        }
        rhs_index++;
      }
    }
    if(lhs_index < lhs.length && rhs_index < rhs_vals.length){
      l = lhs[lhs_index].lhs
      r = rhs_vals[rhs_index]
      if(lhs[lhs_index].isStarred){
        var rev_lhs_index = lhs.length-1
        var rev_rhs_index = rhs_vals.length - 1
        while(rev_lhs_index > lhs_index){
          l = lhs[rev_lhs_index].lhs
          r = rhs_vals[rev_rhs_index]
          lowerDestructAssignment(blocks, l, r, env, allinits);
          rev_rhs_index--;
          rev_lhs_index--;
        }
        const rhs_exprs = rhs_vals.slice(lhs_index, rev_rhs_index+1);
        l = lhs[lhs_index].lhs
        if(rhs_exprs.length!==0){
          lowerStarredAssignments(l, rhs_exprs, blocks, env, allinits);
          console.log(lhs_index, rhs_index)
          break;
        }
      } else {
        lowerDestructAssignment(blocks, l, r, env, allinits);
        rhs_index++;
        lhs_index++;
      }
    }else break;
  }


}
function lowerAllDestructureAssignments(blocks: { a?: [AST.Type, AST.SourceLocation]; label: string; stmts: IR.Stmt<[AST.Type, AST.SourceLocation]>[]; }[], lhs: AST.DestructureLHS<[AST.Type, AST.SourceLocation]>[], rhs: AST.Expr<[AST.Type, AST.SourceLocation]>, env: GlobalEnv, allinits: Array<IR.VarInit<[Type, SourceLocation]>>, dummyLoc:SourceLocation) {
  switch(rhs.tag){
    case "non-paren-vals":
    case "set":
      var rhs_vals = rhs.values
      destructAllAssignments(blocks, lhs, rhs_vals, env, allinits, dummyLoc)
      break;
    case "listliteral":
      var rhs_vals = rhs.elements
      destructAllAssignments(blocks, lhs, rhs_vals, env, allinits, dummyLoc)
      break;
    case "id": 
      if(rhs.a[0].tag==="list"){ //TODO set on rhs, for starred exprs? how to check length..can add a length check in tc
        //1. open rhs as index asign==> a,b = c ==> a,b = c[0], c[1]
        let lhs_index = 0
        var rhs_vals: AST.Expr<[AST.Type, AST.SourceLocation]>[] = []
        while(lhs_index < lhs.length){
          rhs_vals.push({a:rhs.a, tag:"index", 
          obj:{a:rhs.a, tag:"id", name:rhs.name}, 
          index:{a:[rhs.a[0].type, rhs.a[1]],tag:"literal", value:{a:[rhs.a[0].type, rhs.a[1]], tag:"num", value:lhs_index}}})
          lhs_index++;
        }
        destructAllAssignments(blocks, lhs, rhs_vals, env, allinits, dummyLoc)
      } else if(rhs.a[0].tag==="class"){
        destructAllAssignments(blocks, lhs, [rhs], env, allinits, dummyLoc)
      }
      break;
    case "call":
      if(rhs.a[0].tag==="list"){
        let lhs_index = 0
        var rhs_vals: AST.Expr<[AST.Type, AST.SourceLocation]>[] = []
        while(lhs_index < lhs.length){
          rhs_vals.push({a:rhs.a, tag:"index", 
          obj:{a:rhs.a, tag:"call", name:rhs.name, arguments:rhs.arguments}, 
          index:{a:[rhs.a[0].type, rhs.a[1]],tag:"literal", value:{a:[rhs.a[0].type, rhs.a[1]], tag:"num", value:lhs_index}}})
          lhs_index++;
        }
        destructAllAssignments(blocks, lhs, rhs_vals, env, allinits, dummyLoc)
      } else if(rhs.a[0].tag==="class"){
        destructAllAssignments(blocks, lhs, [rhs], env, allinits, dummyLoc)
      }
      break;
    case "lookup":
      if(rhs.a[0].tag==="list"){
        let lhs_index = 0
        var rhs_vals: AST.Expr<[AST.Type, AST.SourceLocation]>[] = []
        while(lhs_index < lhs.length){
          rhs_vals.push({a:rhs.a, tag:"index", 
          obj:{a:rhs.a, tag:"lookup", obj:rhs.obj, field:rhs.field}, 
          index:{a:[rhs.a[0].type, rhs.a[1]],tag:"literal", value:{a:[rhs.a[0].type, rhs.a[1]], tag:"num", value:lhs_index}}})
          lhs_index++;
        }
        destructAllAssignments(blocks, lhs, rhs_vals, env, allinits, dummyLoc)
      } 
      break;
    default:
      throw new Error("Not supported rhs for destructuring!")
    }
}

function destructAllAssignments(blocks: { a?: [AST.Type, AST.SourceLocation]; label: string; stmts: IR.Stmt<[AST.Type, AST.SourceLocation]>[]; }[], lhs: AST.DestructureLHS<[Type, SourceLocation]>[], rhs_vals: AST.Expr<[AST.Type, AST.SourceLocation]>[], env: GlobalEnv, allinits: IR.VarInit<[AST.Type, AST.SourceLocation]>[], dummyLoc: AST.SourceLocation) {
  let lhs_index = 0
  let rhs_index = 0
  while (lhs_index < lhs.length && rhs_index < rhs_vals.length) {
    let l = lhs[lhs_index].lhs
    let r = rhs_vals[rhs_index]
    if(r.a[0].tag==="class"){ //for all iterable classes
      var [valinits, valstmts, va] = flattenExprToVal(r, blocks, env);
      allinits.push(...valinits);
      pushStmtsToLastBlock(blocks, ...valstmts);
      const iterClassName = r.a[0].name;
      if(va.tag==="id"){
        var dummyNext: AST.Expr<[Type, SourceLocation]> = { tag: "call", name: `${iterClassName}$next`, arguments: [va] , a:[{ tag: "none" }, dummyLoc]}
        var dummyHasNext: AST.Expr<[Type, SourceLocation]> = { tag: "call", name: `${iterClassName}$hasnext`, arguments: [va] , a:[{ tag: "none" }, dummyLoc]}
      
        //will probably fail for cases like 'a,b,c = range(1,3),5
        while(lhs_index < lhs.length){
          l = lhs[lhs_index].lhs
          var [inits, stmts, val] = flattenExprToVal(dummyHasNext, blocks, env);
          pushStmtsToLastBlock(blocks, ...stmts);
          allinits.push(...inits);
          lowerDestructAssignment(blocks, l, dummyNext, env, allinits);
          lhs_index++;
        }
        rhs_index++;
      }

    }
    if(lhs_index < lhs.length && rhs_index < rhs_vals.length){
      l = lhs[lhs_index].lhs
      r = rhs_vals[rhs_index]
      if(lhs[lhs_index].isStarred){
        var rev_lhs_index = lhs.length-1
        var rev_rhs_index = rhs_vals.length - 1
        while(rev_lhs_index > lhs_index){
          l = lhs[rev_lhs_index].lhs
          r = rhs_vals[rev_rhs_index]
          lowerDestructAssignment(blocks, l, r, env, allinits);
          rev_rhs_index--;
          rev_lhs_index--;
        }
        const rhs_exprs = rhs_vals.slice(lhs_index, rev_rhs_index+1);
        l = lhs[lhs_index].lhs
        if(rhs_exprs.length!==0){
          lowerStarredAssignments(l, rhs_exprs, blocks, env, allinits);
          console.log(lhs_index, rhs_index)
          break;
        }
      } else {
        lowerDestructAssignment(blocks, l, r, env, allinits);
        rhs_index++;
        lhs_index++;
      }
    }else break;
  }
}

function lowerStarredAssignments(l: AST.AssignTarget<[Type, SourceLocation]>, rhs_exprs: AST.Expr<[Type, SourceLocation]>[], blocks: { a?: [Type, SourceLocation]; label: string; stmts: IR.Stmt<[Type, SourceLocation]>[]; }[], 
  env: GlobalEnv, allinits: IR.VarInit<[AST.Type, AST.SourceLocation]>[]) {
  const newListName = generateName("newList");
  const allocList : IR.Expr<[Type, SourceLocation]> = { tag: "alloc", amount: { tag: "wasmint", value: rhs_exprs.length + 1 } };
  var inits : Array<IR.VarInit<[Type, SourceLocation]>> = [];
  var stmts : Array<IR.Stmt<[Type, SourceLocation]>> = [];
  var storeLength : IR.Stmt<[Type, SourceLocation]> = {
    tag: "store",
    start: { tag: "id", name: newListName },
    offset: { tag: "wasmint", value: 0 },
    value: { a: [{tag: "number"}, rhs_exprs[0].a[1]], tag: "num", value: BigInt(rhs_exprs.length) }
  }
  const assignsList : IR.Stmt<[Type, SourceLocation]>[] = rhs_exprs.map((e, i) => {
    const [init, stmt, val] = flattenExprToVal(e, blocks, env);
    inits = [...inits, ...init];
    stmts = [...stmts, ...stmt];
    return {
      tag: "store",
      start: { tag: "id", name: newListName },
      offset: { tag: "wasmint", value: i+1 },
      value: val
    }
  })
  allinits.push({ name: newListName, type: l.a[0], value: { tag: "none" } }, ...inits);
  // var [valstmts, vale] = [
  //   [ { a: l.a, tag: "assign", name: newListName, value: allocList }, ...stmts, storeLength, ...assignsList ],
  //   { a: l.a, tag: "value", value: { a: l.a, tag: "id", name: newListName } }
  // ];
  //blocks[blocks.length - 1].stmts.push(...valstmts, { a: l.a, tag: "assign", name: l.name, value: vale});
  //console.log({ a: l.a, tag: "assign", name: newListName, value: allocList }, ...stmts, storeLength, ...assignsList,{ a: l.a, tag: "assign", name: l.name, value: { a: l.a, tag: "value", value: { a: l.a, tag: "id", name: newListName }}})
  //@ts-ignore
  pushStmtsToLastBlock(blocks, { a: l.a, tag: "assign", name: newListName, value: allocList }, ...stmts, storeLength, ...assignsList,{ a: l.a, tag: "assign", name: l.name, value: { a: l.a, tag: "value", value: { a: l.a, tag: "id", name: newListName }}})

}

function lowerDestructAssignment(blocks: {
  a?: [AST.Type, AST.SourceLocation]; label: string;
  //   return [name, {tag: "label", a: a, name: name}];
  // }
  stmts: IR.Stmt<[AST.Type, AST.SourceLocation]>[];
}[], l: AST.AssignTarget<[AST.Type, AST.SourceLocation]>, r: AST.Expr<[AST.Type, AST.SourceLocation]>, env: GlobalEnv, allinits:IR.VarInit<[AST.Type, AST.SourceLocation]>[]) {

  if(l.tag === "lookup"){
    var [oinits, ostmts, oval] = flattenExprToVal(l.obj, blocks, env);
    var [ninits, nstmts, nval] = flattenExprToVal(r, blocks, env);
    if(l.obj.a[0].tag !== "class") { throw new Error("Compiler's cursed, go home."); }
    const classdata = env.classes.get(l.obj.a[0].name);
    const offset : IR.Value<[Type, SourceLocation]> = { tag: "wasmint", value: classdata.get(l.field)[0] };
    pushStmtsToLastBlock(blocks,
      ...ostmts, ...nstmts, {
        tag: "store",
        a: l.a,
        start: oval,
        offset: offset,
        value: nval
      });
    allinits.push(...oinits, ...ninits);
  }
  else if(l.tag === "id" && l.name!=="_"){
    var [valinits, valstmts, vale] = flattenExprToExpr(r,blocks, env);
    //@ts-ignore
    //name always in id cases
    blocks[blocks.length - 1].stmts.push(...valstmts, { a: l.a, tag: "assign", name: l.name, value: vale});
    allinits.push(...valinits);
  } 
  else if (l.tag === "index"){
    var [oinits, ostmts, oval] = flattenExprToVal(l.obj, blocks, env);
    const [iinits, istmts, ival] = flattenExprToVal(l.index, blocks, env);
    var [ninits, nstmts, nval] = flattenExprToVal(r, blocks, env);

    const offsetValue: IR.Value<[Type, SourceLocation]> = listIndexOffsets(iinits, istmts, ival, oval);

    if (l.obj.a[0].tag === "list") {
      pushStmtsToLastBlock(blocks,
        ...ostmts, ...istmts, ...nstmts, {
          tag: "store",
          a: l.a,
          start: oval,
          offset: offsetValue,
          value: nval
        });
      allinits.push(...oinits, ...iinits, ...ninits);
    }
    // if (s.obj.a[0].tag === "dict") {
    //   ...
    // }

    else { throw new Error("Compiler's cursed, go home."); }

  }
}

function flattenExprToExpr(e : AST.Expr<[Type, SourceLocation]>, blocks: Array<IR.BasicBlock<[Type, SourceLocation]>>, env : GlobalEnv) : [Array<IR.VarInit<[Type, SourceLocation]>>, Array<IR.Stmt<[Type, SourceLocation]>>, IR.Expr<[Type, SourceLocation]>] {
  switch(e.tag) {
    case "uniop":
      var [inits, stmts, val] = flattenExprToVal(e.expr, blocks, env);
      return [inits, stmts, {
        ...e,
        expr: val
      }];
    case "binop":
      var [linits, lstmts, lval] = flattenExprToVal(e.left, blocks, env);
      var [rinits, rstmts, rval] = flattenExprToVal(e.right, blocks, env);
      return [[...linits, ...rinits], [...lstmts, ...rstmts], {
          ...e,
          left: lval,
          right: rval
        }];
    case "call":
      if (e.name === "set") {
        if (!e.arguments) {
          // construct empty set
          const newSetName = generateName("newSet");
          // size will be 10 for now
          const allocSet : IR.Expr<[Type, SourceLocation]> = {tag: "alloc", amount: {tag: "wasmint", value: 10}};
          return [
            [ { name: newSetName, type: e.a[0], value: { tag: "none" } } ],
            [ { tag: "assign", name: newSetName, value: allocSet } ],
            { a: e.a, tag: "value", value: { a: e.a, tag: "id", name: newSetName } }
          ]; 
        } else {
          const callpairs = e.arguments.map(a => flattenExprToVal(a, blocks, env));
          const callinits = callpairs.map(cp => cp[0]).flat();
          const callstmts = callpairs.map(cp => cp[1]).flat();
          const callvals = callpairs.map(cp => cp[2]).flat();
          return [ callinits, callstmts,
            {
              ...e,
              arguments: callvals
            }
          ];  
        }
      }
      const callpairs = e.arguments.map(a => flattenExprToVal(a, blocks, env));
      const callinits = callpairs.map(cp => cp[0]).flat();
      const callstmts = callpairs.map(cp => cp[1]).flat();
      const callvals = callpairs.map(cp => cp[2]).flat();
      return [ callinits, callstmts,
        {
          ...e,
          arguments: callvals
        }
      ];
    case "method-call": {
      const [objinits, objstmts, objval] = flattenExprToVal(e.obj, blocks, env);
      const argpairs = e.arguments.map(a => flattenExprToVal(a, blocks, env));
      const arginits = argpairs.map(cp => cp[0]).flat();
      const argstmts = argpairs.map(cp => cp[1]).flat();
      const argvals = argpairs.map(cp => cp[2]).flat();
      var objTyp = e.obj.a[0];
      if(objTyp.tag === "set") {
        const callMethod : IR.Expr<[Type, SourceLocation]> = { a: e.a, tag: "call", name: `set$${e.method}`, arguments: [objval, ...argvals] }
        return [
          [...objinits, ...arginits],
          [...objstmts, ...argstmts],
          callMethod
        ];
      }
      if(objTyp.tag !== "class") { // I don't think this error can happen
        throw new Error("Report this as a bug to the compiler developer, this shouldn't happen " + objTyp.tag);
      }
      const className = objTyp.name;
      const checkObj : IR.Stmt<[Type, SourceLocation]> = { a: e.a, tag: "expr", expr: { a: e.a, tag: "call", name: `assert_not_none`, arguments: [objval]}}
      const callMethod : IR.Expr<[Type, SourceLocation]> = { a:e.a, tag: "call", name: `${className}$${e.method}`, arguments: [objval, ...argvals] }
      return [
        [...objinits, ...arginits],
        [...objstmts, checkObj, ...argstmts],
        callMethod
      ];
    }
    case "lookup": {
      const [oinits, ostmts, oval] = flattenExprToVal(e.obj, blocks, env);
      if(e.obj.a[0].tag !== "class") { throw new Error("Compiler's cursed, go home"); }
      const classdata = env.classes.get(e.obj.a[0].name);
      const [offset, _] = classdata.get(e.field);
      return [oinits, ostmts, {
        a: e.a,
        tag: "load",
        start: oval,
        offset: { tag: "wasmint", value: offset }}];
    }
    case "index":
      const [oinits, ostmts, oval] = flattenExprToVal(e.obj, blocks, env);
      const [iinits, istmts, ival] = flattenExprToVal(e.index, blocks, env);

      // if(equalType(e.a[0], CLASS("str"))){
      //   return [[...oinits, ...iinits], [...ostmts, ...istmts], {tag: "call", name: "str$access", arguments: [oval, ival]} ]
      // }
      if (e.obj.a[0].tag === "list") { 
        const offsetValue: IR.Value<[Type, SourceLocation]> = listIndexOffsets(iinits, istmts, ival, oval);
        return [[...oinits, ...iinits], [...ostmts, ...istmts], {
          a: e.a,
          tag: "load",
          start: oval,
          offset: offsetValue
        }];
      }
      // if(e.obj.a[0].tag === "dict")){
      //   ...
      // }
      // if(e.obj.a[0].tag === "tuple")){
      //   ...
      // }
      throw new Error("Compiler's cursed, go home");
    case "construct":
      const classdata = env.classes.get(e.name);
      const fields = [...classdata.entries()];
      const newName = generateName("newObj");
      const alloc : IR.Expr<[Type, SourceLocation]> = { a:e.a, tag: "alloc", amount: { a:e.a, tag: "wasmint", value: fields.length } };
      const assigns : IR.Stmt<[Type, SourceLocation]>[] = fields.map(f => {
        const [_, [index, value]] = f;
        return {
          a: e.a,
          tag: "store",
          start: { tag: "id", name: newName },
          offset: { tag: "wasmint", value: index },
          value: value
        }
      });

      return [
        [ { name: newName, type: e.a[0], value: { a: e.a, tag: "none" } }],
        [ { a: e.a, tag: "assign", name: newName, value: alloc }, ...assigns,
          { a: e.a, tag: "expr", expr: { a: e.a, tag: "call", name: `${e.name}$__init__`, arguments: [{ a: e.a, tag: "id", name: newName }] } }
        ],
        { a: e.a, tag: "value", value: { a: e.a, tag: "id", name: newName } }
      ];
    case "listliteral":
      const newListName = generateName("newList");
      const allocList : IR.Expr<[Type, SourceLocation]> = { tag: "alloc", amount: { tag: "wasmint", value: e.elements.length + 1 } };
      var inits : Array<IR.VarInit<[Type, SourceLocation]>> = [];
      var stmts : Array<IR.Stmt<[Type, SourceLocation]>> = [];
      var storeLength : IR.Stmt<[Type, SourceLocation]> = {
        tag: "store",
        start: { tag: "id", name: newListName },
        offset: { tag: "wasmint", value: 0 },
        value: { a: [{tag: "number"}, e.a[1]], tag: "num", value: BigInt(e.elements.length) }
      }
      const assignsList : IR.Stmt<[Type, SourceLocation]>[] = e.elements.map((e, i) => {
        const [init, stmt, val] = flattenExprToVal(e, blocks, env);
        inits = [...inits, ...init];
        stmts = [...stmts, ...stmt];
        return {
          tag: "store",
          start: { tag: "id", name: newListName },
          offset: { tag: "wasmint", value: i+1 },
          value: val
        }
      })
      return [
        [ { name: newListName, type: e.a[0], value: { tag: "none" } }, ...inits ],
        [ { a: e.a, tag: "assign", name: newListName, value: allocList }, ...stmts, storeLength, ...assignsList ],
        { a: e.a, tag: "value", value: { a: e.a, tag: "id", name: newListName } }
      ];
    case "id":
      return [[], [], {a: e.a, tag: "value", value: { ...e }} ];
    case "literal":
      return [[], [], {a: e.a, tag: "value", value: literalToVal(e.value) } ];
    case "set":
      const newSetName = generateName("newSet");
      // 10 buckets for now
      const allocSet : IR.Expr<[Type, SourceLocation]> = {tag: "alloc", amount: {tag: "wasmint", value: 10}};
      //const allocSet : IR.Expr<[Type, SourceLocation]> = {tag: "alloc", amount: {tag: "wasmint", value: e.contents.length}};
      var inits : Array<IR.VarInit<[Type, SourceLocation]>> = [];
      var stmts : Array<IR.Stmt<[Type, SourceLocation]>> = [];
      const assignsSet : IR.Stmt<[Type, SourceLocation]>[] = e.values.map((e, _) => {
        const [init, stmt, value] = flattenExprToVal(e, blocks, env);
        inits = [...inits, ...init];
        stmts = [...stmts, ...stmt];
        return {
          a: e.a,
          tag: "expr",
          expr: { a: e.a, tag: "call", name: `set$add`, arguments: [{ tag: "id", name: newSetName}, value]}
        }
      })
      return [
        [ { a: e.a, name: newSetName, type: e.a[0], value: { tag: "none" } }, ...inits ],
        //[ { tag: "assign", name: newSetName, value: allocSet }, ...stmts, storeLength, ...assignsSet ], 
        [ { tag: "assign", name: newSetName, value: allocSet }, ...stmts, ...assignsSet ],
        { a: e.a, tag: "value", value: { a: e.a, tag: "id", name: newSetName } }
      ];
    case "ternary":
    case "comprehension":
      return flattenExprToExprWithBlocks(e, blocks, env);
  }
}

function flattenExprToExprWithBlocks(e : AST.Expr<[Type, SourceLocation]>, blocks: Array<IR.BasicBlock<[Type, SourceLocation]>>, env : GlobalEnv) : [Array<IR.VarInit<[Type, SourceLocation]>>, Array<IR.Stmt<[Type, SourceLocation]>>, IR.Expr<[Type, SourceLocation]>] {
  switch(e.tag) {
    case "ternary":
      var [tinits, tstmts, tval] = flattenExprToExpr(e.exprIfTrue, blocks, env);
      var [finits, fstmts, fval] = flattenExprToExpr(e.exprIfFalse, blocks, env);
      var [condinits, condstmts, condval] = flattenExprToVal(e.ifcond, blocks, env);

      const resultName = generateName("resultVal");
      const resultInit : IR.VarInit<[Type, SourceLocation]> = { name: resultName, type: e.a[0], value: { tag: "none" } };

      var thenLbl = generateName("$ternaryThen");
      var elseLbl = generateName("$ternaryElse");
      var endLbl = generateName("$ternaryEnd");
      
      const condjmp : IR.Stmt<[Type, SourceLocation]> = { tag: "ifjmp", cond: condval, thn: thenLbl, els: elseLbl };
      const endjmp : IR.Stmt<[Type, SourceLocation]> = { tag: "jmp", lbl: endLbl };

      const assignTrue : IR.Stmt<[Type, SourceLocation]> = { tag: "assign", name: resultName, value: tval };
      const assignFalse : IR.Stmt<[Type, SourceLocation]> = { tag: "assign", name: resultName, value: fval };

      // in case of a lonely ternary expression in the program
      if (blocks.length == 0) {
        blocks.push({ a: e.a, label: generateName("$ternaryBlock"), stmts: [] });
      }
      
      pushStmtsToLastBlock(blocks, ...condstmts)
      pushStmtsToLastBlock(blocks, condjmp);
      blocks.push({ a: e.a, label: thenLbl, stmts: [...tstmts, assignTrue] });
      pushStmtsToLastBlock(blocks, endjmp);
      blocks.push({ a: e.a, label: elseLbl, stmts: [...fstmts, assignFalse] });
      pushStmtsToLastBlock(blocks, endjmp);
      blocks.push({ a: e.a, label: endLbl, stmts: [] });

      return [[...tinits, ...condinits, ...finits, resultInit],
        [],
        { a: e.a, tag: "value", value: { a: e.a, tag: "id", name: resultName } }
      ];
    case "comprehension":
      // obtain the iterable obj
      const [objinits, objstmts, objval] = flattenExprToVal(e.iterable, blocks, env);
      var objTyp = e.iterable.a[0];
      if(objTyp.tag !== "class") { // I don't think this error can happen
        throw new Error("Report this as a bug to the compiler developer, this shouldn't happen " + objTyp.tag);
      }
      const objClassName = objTyp.name;
      const checkObj : IR.Stmt<[Type, SourceLocation]> = { a: e.a, tag: "expr", expr: { a: e.a, tag: "call", name: `assert_not_none`, arguments: [objval]}};
      // method calls
      const callHasnext : IR.Expr<[Type, SourceLocation]> = { a: e.a, tag: "call", name: `${objClassName}$hasnext`, arguments: [objval] };
      const callNext : IR.Expr<[Type, SourceLocation]> = { a: e.a, tag: "call", name: `${objClassName}$next`, arguments: [objval] }

      const whileStartLbl = generateName("$whilestart");
      const whilebodyLbl = generateName("$whilebody");
      const whileEndLbl = generateName("$whileend");

      // jump to start
      pushStmtsToLastBlock(blocks, ...objstmts, checkObj, { tag: "jmp", lbl: whileStartLbl });
      blocks.push({  a: e.a, label: whileStartLbl, stmts: [] });
      // call hasnext
      const hasnextValName = generateName("condVal");
      const hasnextVal : IR.VarInit<[Type, SourceLocation]> = { name: hasnextValName, type: { tag: "bool" }, value: { tag: "bool", value: false } };
      const hasnextValAssign : IR.Stmt<[Type, SourceLocation]> =  { tag: "assign", name: hasnextValName, value: callHasnext };
      const hasnext : IR.Value<[Type, SourceLocation]> = { a: e.a, tag: "id", name: hasnextValName };
      const hasnextjmp : IR.Stmt<[Type, SourceLocation]> = { tag: "ifjmp", cond: hasnext, thn: whilebodyLbl, els: whileEndLbl };
      pushStmtsToLastBlock(blocks, hasnextValAssign, hasnextjmp);

      // body: call next and print result
      blocks.push({  a: e.a, label: whilebodyLbl, stmts: [] })
      const nextValName = e.item;
      var nextValType = undefined;
      switch (e.a[0].tag) {
        case "generator":
        case "list":
          nextValType = e.a[0].type;
          break;
        case "set":
        // case "dictionary":
          nextValType = e.a[0].valueType;
          break;
        case "class":
          nextValType = NONE; // any way to access type info here?
          break;
        default:
          throw new Error("Iterable is cursed, go home!");
      }
      const nextVal : IR.VarInit<[Type, SourceLocation]> = { name: nextValName, type: nextValType, value: { tag: "none" } };
      const nextValAssign : IR.Stmt<[Type, SourceLocation]> =  { tag: "assign", name: nextValName, value: callNext };

      // push call to next to blocks before lhs statements get pushed on the next line
      pushStmtsToLastBlock(blocks, nextValAssign);

      // TODO: assign-destructure
      // evaluate lhs
      const [linits, lstmts, lval] = flattenExprToExpr(e.lhs, blocks, env); // careful with ternary case
      const nextYieldName = generateName("nextYield");
      const nextYield : IR.VarInit<[Type, SourceLocation]> = { name: nextYieldName, type: lval.a[0], value: { tag: "none" } };
      const nextYieldAssign : IR.Stmt<[Type, SourceLocation]> =  { tag: "assign", name: nextYieldName, value: lval };
      // for this milestone, we just print out the values
      const callPrint : IR.Stmt<[Type, SourceLocation]> = { tag: "expr", expr: { tag: "call", name: "print_num", arguments: [{ a: e.a, tag: "id", name: nextYieldName }] } };

      // if condition
      const condThenLbl = generateName("$then");
      const condEndLbl = generateName("$end");
      const condElseLbl = generateName("$else");
      var cinits : IR.VarInit<[Type, SourceLocation]>[] = []
      var cstmts : IR.Stmt<[Type, SourceLocation]>[] = []
      var cval : IR.Value<[Type, SourceLocation]> = { tag: "bool", value: true };
      if (e.ifcond != undefined) {
        [cinits, cstmts, cval] = flattenExprToVal(e.ifcond, blocks, env);
      }

      // TODO: store generated values on heap
      if (e.a[0].tag === "generator") {
        const newName = generateName("newGen");
        // generator has two fields: size (number of elements generated), and addr (start address)
        const size = 0; // TODO: how to know the number of elements generated at this level?
        const startAddr = 0; // TODO: decide start address of generator, might need help from list data structure
        const alloc : IR.Expr<[Type, SourceLocation]> = { tag: "alloc", amount: { tag: "wasmint", value: 2 } };
        const assigns : IR.Stmt<[Type, SourceLocation]>[] = [
          {
            tag: "store",
            start: { tag: "id", name: newName },
            offset: { tag: "wasmint", value: 0 },
            value: { tag: "wasmint", value: size }
          },
          {
            tag: "store",
            start: { tag: "id", name: newName },
            offset: { tag: "wasmint", value: 1 },
            value: { tag: "wasmint", value: startAddr }
          }
        ];
      }

      const condJmp : IR.Stmt<[Type, SourceLocation]> = { tag: "ifjmp", cond: cval, thn: condThenLbl, els: condElseLbl };
      const endJmp : IR.Stmt<[Type, SourceLocation]> = { tag: "jmp", lbl: condEndLbl };

      pushStmtsToLastBlock(blocks, ...lstmts, ...cstmts, condJmp);
      blocks.push({ a: e.a, label: condThenLbl, stmts: [nextYieldAssign] });
      pushStmtsToLastBlock(blocks, endJmp);
      blocks.push({ a: e.a, label: condElseLbl, stmts: [] });
      pushStmtsToLastBlock(blocks, endJmp);
      blocks.push({ a: e.a, label: condEndLbl, stmts: [{ tag: "jmp", lbl: whileStartLbl }] });

      blocks.push({  a: e.a, label: whileEndLbl, stmts: [] });

      return [
        [...objinits, ...cinits, ...linits, hasnextVal, nextVal, nextYield],
        [],
        { tag: "value", value: {tag: "bool", value: false} } // what should I return here?
      ]
  }
}

function flattenExprToVal(e : AST.Expr<[Type, SourceLocation]>, blocks: Array<IR.BasicBlock<[Type, SourceLocation]>>, env : GlobalEnv) : [Array<IR.VarInit<[Type, SourceLocation]>>, Array<IR.Stmt<[Type, SourceLocation]>>, IR.Value<[Type, SourceLocation]>] {
  var [binits, bstmts, bexpr] = flattenExprToExpr(e, blocks, env);
  if(bexpr.tag === "value") {
    return [binits, bstmts, bexpr.value];
  }
  else {
    var newName = generateName("valname");
    var setNewName : IR.Stmt<[Type, SourceLocation]> = {
      tag: "assign",
      a: e.a,
      name: newName,
      value: bexpr 
    };
    // TODO: we have to add a new var init for the new variable we're creating here.
    // but what should the default value be?
    return [
      [...binits, { a: e.a, name: newName, type: e.a[0], value: { a: e.a, tag: "none" } }],
      [...bstmts, setNewName],  
      {tag: "id", name: newName, a: e.a}
    ];
  }
}


function listIndexOffsets(iinits: IR.VarInit<[AST.Type, AST.SourceLocation]>[], istmts: IR.Stmt<[AST.Type, AST.SourceLocation]>[], ival: IR.Value<[AST.Type, AST.SourceLocation]>, oval: IR.Value<[AST.Type, AST.SourceLocation]>) : IR.Value<[AST.Type, AST.SourceLocation]> {
  // Check index is in bounds
  var listLength = generateName("listlength");
  var setLength : IR.Stmt<[Type, SourceLocation]> = {
    tag: "assign",
    a: ival.a,
    name: listLength,
    value: {
      a: ival.a,
      tag: "load",
      start: oval,
      offset: { tag: "wasmint", value: 0 }} 
  };
  iinits.push({ a: ival.a, name: listLength, type: {tag: "number"}, value: { tag: "none" } })
  istmts.push(setLength);
  const checkIndex: IR.Stmt<[Type, SourceLocation]> = { a: ival.a, tag: "expr", expr: { a: ival.a, tag: "call", name: `index_out_of_bounds`, arguments: [{tag: "id", name: listLength, a: ival.a}, ival]}}
  istmts.push(checkIndex);

  // Get rest of index offsets
  const value1: IR.Value<[Type, SourceLocation]> = { a: ival.a, tag: "wasmint", value: 1 };
  const indexAdd1Expr: IR.Expr<[Type, SourceLocation]> = {  a: ival.a, tag: "binop", op: AST.BinOp.Plus, left: ival, right: value1};
  const offsetName = generateName("offsetname");
  const offsetInit: IR.VarInit<[Type, SourceLocation]> = { a: ival.a, name: offsetName, type: {tag: "number"}, value: { tag: "none" } }
  iinits.push(offsetInit);
  const setOffset : IR.Stmt<[Type, SourceLocation]> = { tag: "assign", a: ival.a, name: offsetName, value: indexAdd1Expr };
  istmts.push(setOffset);
  const offsetValue: IR.Value<[Type, SourceLocation]> = {tag: "id", name: offsetName, a: ival.a}
  return offsetValue;
}

function pushStmtsToLastBlock(blocks: Array<IR.BasicBlock<[Type, SourceLocation]>>, ...stmts: Array<IR.Stmt<[Type, SourceLocation]>>) {
  blocks[blocks.length - 1].stmts.push(...stmts);
}

function resetLoopLabels() {
  const labels = ["$whilestart", "$whilebody", "$whileend" ,"$forelse"]
 labels.forEach(label => {
   nameCounters.delete(label)
 });
  return;
}
