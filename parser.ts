import {parser} from "lezer-python";
import { TreeCursor} from "lezer-tree";
import { Program, Expr, Stmt, UniOp, BinOp, Parameter, Type, FunDef, VarInit, Class, Literal, SourceLocation, DestructureLHS, AssignTarget } from "./ast";
import { NUM, BOOL, NONE, CLASS, TYPE_VAR } from "./utils";
import { stringifyTree } from "./treeprinter";
import { ParseError} from "./error_reporting";

// To get the line number from lezer tree to report errors
function getSourceLocation(c : TreeCursor, s : string) : SourceLocation {
  var source_lines = s.split("\n");
  var lines = s.substring(0, c.from).split("\n");
  var line: number = lines.length;
  var previousLines = lines.slice(0,line-1).join("\n").length;
  var srcCode =  source_lines[line-1]  
  var column = s.substring(previousLines+1, c.to).length;  
  if (line === 1) {
    column = column + 1;
  }
  return { line, column, srcCode }
}

export function traverseLiteral(c : TreeCursor, s : string) : Literal<SourceLocation> {
  var location = getSourceLocation(c, s);
  switch(c.type.name) {
    case "Number":
      return {
        tag: "num",
        value: Number(s.substring(c.from, c.to)),
        a: location,
      }
    case "Boolean":
      return {
        tag: "bool",
        value: s.substring(c.from, c.to) === "True",
        a: location,
      }
    case "None":
      return {
        tag: "none",
        a: location
      }
    case "CallExpression":
      const call_str = s.substring(c.from, c.to);
      const call_name = call_str.split('(')[0];
      if(call_name == "TypeVar") {
        return {
          tag: "TypeVar",
          a: location,
        }
      }
    default:
      throw new ParseError("Not literal", location)
  }
}

export function traverseExpr(c : TreeCursor, s : string) : Expr<SourceLocation> {
  var location = getSourceLocation(c, s);
  switch(c.type.name) {
    case "Number":
    case "Boolean":
    case "None":
      return { 
        a: location,
        tag: "literal", 
        value: traverseLiteral(c, s)
      }      
    case "VariableName":
      return {
        a: location,
        tag: "id",
        name: s.substring(c.from, c.to)
      }
    case "CallExpression":
      const callStr = s.substring(c.from, c.to);
      const genericRegex = /\[[A-Za-z]*\]/g;
      const genericArgs = callStr.match(genericRegex);

      c.firstChild();
      let callExpr = traverseExpr(c, s);
      c.nextSibling(); // go to arglist
      const args = traverseArguments(c, s);
      c.parent(); // pop CallExpression

      if(genericArgs) {
        const genArgsStr = genericArgs.toString();
        const commaSepArgs = genArgsStr.substring(1, genArgsStr.length - 1);
        const genTypes = commaSepArgs.split(',').map(s => typeFromString(s));
        return {
          a: location,
          tag: "call",
          name: callStr.split('[')[0],
          arguments: args,
          genericArgs: genTypes
        };
      } 

      if (callExpr.tag === "lookup") {
        return {
          a: location,
          tag: "method-call",
          obj: callExpr.obj,
          method: callExpr.field,
          arguments: args
        }
      } else if (callExpr.tag === "id") {
        const callName = callExpr.name;
        var expr : Expr<SourceLocation>;
        expr = { a: location, tag: "call", name: callName, arguments: args};
        return expr;  
      } else {
        throw new ParseError("Unknown target while parsing assignment", location);
      }

    case "ArrayExpression":
      c.firstChild(); //go into ArrayExpression, should be at [

      var elements : Array<Expr<SourceLocation>> = [];
      var firstIteration = true;
      //parse elements in list
      while(c.nextSibling()) { //next element in list, if there is one
        if(s.substring(c.from, c.to) === "]") {
          if(firstIteration) { break; } //empty list
          else {
            c.parent();
            throw new Error("Parse error at " + s.substring(c.from, c.to));
          }
        }
        elements.push(traverseExpr(c, s));
        c.nextSibling(); // Focus on either , or ]
        firstIteration = false;
      }

      if(s.substring(c.from, c.to) !== "]") { //list doesn't have a closing bracket
        c.parent();
        throw new Error("Parse error after " + s.substring(c.from, c.to));
      }

      console.log(elements)

      c.parent(); //up from ArrayExpression
      return { 
        a: location,
        tag: "listliteral", 
        elements 
      }

    case "BinaryExpression":
      c.firstChild(); // go to lhs 
      const lhsExpr = traverseExpr(c, s);
      c.nextSibling(); // go to op
      var opStr = s.substring(c.from, c.to);
      var op;
      switch(opStr) {
        case "+":
          op = BinOp.Plus;
          break;
        case "-":
          op = BinOp.Minus;
          break;
        case "*":
          op = BinOp.Mul;
          break;
        case "//":
          op = BinOp.IDiv;
          break;
        case "%":
          op = BinOp.Mod;
          break
        case "==":
          op = BinOp.Eq;
          break;
        case "!=":
          op = BinOp.Neq;
          break;
        case "<=":
          op = BinOp.Lte;
          break;
        case ">=":
          op = BinOp.Gte;
          break;
        case "<":
          op = BinOp.Lt;
          break;
        case ">":
          op = BinOp.Gt;
          break;
        case "is":
          op = BinOp.Is;
          break; 
        case "and":
          op = BinOp.And;
          break;
        case "or":
          op = BinOp.Or;
          break;
        case "in":
          c.nextSibling();
          const rhs = traverseExpr(c, s);
          c.parent();
          return {
            a: location,
            tag: "method-call",
            obj: rhs,
            method: "contains",
            arguments: [lhsExpr]
          };
        default:
          throw new ParseError("Could not parse operator at " + c.from + " " + c.to + ": " + s.substring(c.from, c.to), location)
      }
      c.nextSibling(); // go to rhs
      const rhsExpr = traverseExpr(c, s);
      c.parent();
      return {
        a: location,
        tag: "binop",
        op: op,
        left: lhsExpr,
        right: rhsExpr
      }
    case "ParenthesizedExpression":
      c.firstChild(); // Focus on (
      c.nextSibling(); // Focus on inside
      var expr = traverseExpr(c, s);
      c.nextSibling(); // Focus on )
      if(s.substring(c.from, c.to) !== ")") {
        throw new ParseError("Missing parenthesis", location);
      }
      c.parent();
      return expr;
    case "UnaryExpression":
      c.firstChild(); // Focus on op
      var opStr = s.substring(c.from, c.to);
      var op;
      switch(opStr) {
        case "-":
          op = UniOp.Neg;
          break;
        case "not":
          op = UniOp.Not;
          break;
        default:
          throw new ParseError("Could not parse op at " + c.from + " " + c.to + ": " + s.substring(c.from, c.to), location)
      }
      c.nextSibling(); // go to expr
      var expr = traverseExpr(c, s);
      c.parent();
      return {
        a: location,
        tag: "uniop",
        op: op,
        expr: expr
      }
    case "MemberExpression":
      c.firstChild(); // Focus on object
      var objExpr = traverseExpr(c, s);
      c.nextSibling(); // Focus on . or [
      var dotOrBracket = s.substring(c.from, c.to);
      if( dotOrBracket === "[") {
        var start_index: Expr<any>;
        var stop_index: Expr<any>;
        var step: Expr<any> = {
          tag: "literal",
          value: { tag: "num", value: 1 }
        };

        var indexItems = "";
        c.nextSibling();
        while (s.substring(c.from, c.to) != "]") {
          indexItems += s.substring(c.from, c.to);
          c.nextSibling();
        }
        c.parent();
        c.firstChild(); // str object name
        c.nextSibling(); // "[""
        c.nextSibling(); // start index

        if(indexItems.length === 0) {
          throw new Error("Error: there should have at least one value inside the brackets");
        }

        var sliced_indices = indexItems.split(":");
        if(sliced_indices.length > 3){
          throw new Error("Too much indices, maximum is three");
        }

        start_index = traverseExpr(c, s)

        c.parent();
        return {
          a: location,
          tag: "index",
          obj: objExpr,
          index: start_index
        }
      }

      c.nextSibling(); // Focus on property
      var propName = s.substring(c.from, c.to);
      c.parent();
      return {
        a: location,
        tag: "lookup",
        obj: objExpr,
        field: propName
      }
    case "SetExpression":
      c.firstChild();
      let setValues = new Array<Expr<any>>();
      while (c.nextSibling()) {
        let v : Expr<any> = traverseExpr(c, s);
        setValues.push(v);
        c.nextSibling();
      }
      c.parent();
      return {
        a: location,
        tag: "set",
        values: setValues
      }
    case "self":
      return {
        a: location,
        tag: "id",
        name: "self"
      };
    case "ConditionalExpression": // ternary expression
      c.firstChild(); // Focus on exprIfTrue
      var exprIfTrue = traverseExpr(c, s);
      c.nextSibling(); // Focus on if
      c.nextSibling(); // Focus on cond
      var ifcond = traverseExpr(c, s);
      c.nextSibling(); // Focus on else
      c.nextSibling(); // Focus on exprIfFalse
      var exprIfFalse = traverseExpr(c, s);
      c.parent();
      return {
        a: location,
        tag: "ternary",
        exprIfTrue: exprIfTrue,
        ifcond: ifcond,
        exprIfFalse: exprIfFalse
      };
    // comprehensions
    case "ComprehensionExpression":
    case "ArrayComprehensionExpression":
    //case "DictionaryComprehensionExpression":
    case "SetComprehensionExpression":
      c.firstChild(); // Focus on ()/[]/{}
      var compTyp : Type = NONE;
      const symbol = s.substring(c.from, c.to);
      switch (symbol) {
        case "(":
          compTyp = { tag: "generator", type: NONE };
          break;
        case "[":
          compTyp = { tag: "list", type: NONE };
          break;
        case "{":
          compTyp = { tag: "set", valueType: NONE }; // need to add dictionary case in the future
          break;
        default:
          throw new ParseError("Could not parse comprehension", location);
      }
      c.nextSibling(); // Focus on lhs
      var lhs = traverseExpr(c, s);
      c.nextSibling(); // Focus on for
      c.nextSibling(); // Focus on item
      var itemName = s.substring(c.from, c.to);
      c.nextSibling(); // Focus on in
      c.nextSibling(); // Focus on iterable expr
      var iterable = traverseExpr(c, s);
      c.nextSibling(); // Focus on if/)/]/}
      var compIfCond : Expr<SourceLocation> = undefined;
      var nextSymbol = s.substring(c.from, c.to);
      if (nextSymbol === "if") {
        c.nextSibling(); // Focus on ifcond
        compIfCond = traverseExpr(c, s);
        c.nextSibling(); // Focus on )/]/}
        nextSymbol = s.substring(c.from, c.to);
      }
      const pair = symbol + nextSymbol;
      if (pair !== "()" && pair !== "[]" && pair !== "{}") {
        throw new ParseError("Comprehension start and end mismatch", location);
      }
      c.parent();
      if (compIfCond == undefined) {
        return {
          a: location,
          tag: "comprehension",
          type: compTyp,
          lhs: lhs,
          item: itemName,
          iterable: iterable
        };
      }
      return {
        a: location,
        tag: "comprehension",
        type: compTyp,
        lhs: lhs,
        item: itemName,
        iterable: iterable,
        ifcond: compIfCond
      };
    default:
      throw new ParseError("Could not parse expr at " + c.from + " " + c.to + ": " + s.substring(c.from, c.to), location);
  }
}

export function traverseArguments(c : TreeCursor, s : string) : Array<Expr<SourceLocation>> {
  c.firstChild();  // Focuses on open paren
  const args = [];
  c.nextSibling();
  while(c.type.name !== ")") {
    let expr = traverseExpr(c, s);
    args.push(expr);
    c.nextSibling(); // Focuses on either "," or ")"
    c.nextSibling(); // Focuses on a VariableName
  } 
  c.parent();       // Pop to ArgList
  return args;
}

export function traverseStmt(c : TreeCursor, s : string) : Stmt<SourceLocation> {
  var location = getSourceLocation(c, s);
  switch(c.node.type.name) {
    case "ReturnStatement":
      c.firstChild();  // Focus return keyword
      
      var value : Expr<SourceLocation>;
      if (c.nextSibling()) // Focus expression
        value = traverseExpr(c, s);
      else
        value = { a: location, tag: "literal", value: { tag: "none" } };
      c.parent();
      return { a: location, tag: "return", value };
    case "AssignStatement":
      c.firstChild(); // go to name
      // Parse LHS
      const target = traverseDestructureTargets(c, s);
      // Parse AssignOp
      c.nextSibling();
      //Parse RHS
      const rhsargs = traverseDestructureValues(c,s);
      c.parent();
      //Normal assign statements
      if(target.length==1){
        if (target[0].lhs.tag === "lookup") {
          return {
            a: location,
            tag: "field-assign",
            obj: target[0].lhs.obj,
            field: target[0].lhs.field,
            value: rhsargs[0]
          }
        } else if (target[0].lhs.tag === "id") {
          return {
            a: location,
            tag: "assign",
            name: target[0].lhs.name,
            value: rhsargs[0]
          }  
        } else if (target[0].lhs.tag === "index"){
          return {
            a: location,
            tag: "index-assign",
            obj: target[0].lhs.obj,
            index: target[0].lhs.index,
            value: rhsargs[0]
          }
        } else {
          throw new ParseError("Unknown target while parsing assignment", location);
        }
      } 
      //Destructure return
      else {
        if(rhsargs.length==1){
          return {
            a : location,
            tag : "assign-destr", 
            destr : target, 
            rhs : rhsargs[0]
          };
        }
        return {
          a : location,
          tag : "assign-destr", 
          destr : target, 
          rhs : { tag:"non-paren-vals", values:rhsargs }
        };
      }  
      
    case "ExpressionStatement":
      c.firstChild();
      const expr = traverseExpr(c, s);
      c.parent(); // pop going into stmt
      return { a: location, tag: "expr", expr: expr }
    // case "FunctionDefinition":
    //   c.firstChild();  // Focus on def
    //   c.nextSibling(); // Focus on name of function
    //   var name = s.substring(c.from, c.to);
    //   c.nextSibling(); // Focus on ParamList
    //   var parameters = traverseParameters(c, s)
    //   c.nextSibling(); // Focus on Body or TypeDef
    //   let ret : Type = NONE;
    //   if(c.type.name === "TypeDef") {
    //     c.firstChild();
    //     ret = traverseType(c, s);
    //     c.parent();
    //   }
    //   c.firstChild();  // Focus on :
    //   var body = [];
    //   while(c.nextSibling()) {
    //     body.push(traverseStmt(c, s));
    //   }
      // console.log("Before pop to body: ", c.type.name);
    //   c.parent();      // Pop to Body
      // console.log("Before pop to def: ", c.type.name);
    //   c.parent();      // Pop to FunctionDefinition
    //   return {
    //     tag: "fun",
    //     name, parameters, body, ret
    //   }
    case "IfStatement":
      c.firstChild(); // Focus on if
      c.nextSibling(); // Focus on cond
      var cond = traverseExpr(c, s);
      // console.log("Cond:", cond);
      c.nextSibling(); // Focus on : thn
      c.firstChild(); // Focus on :
      if(s.substring(c.from, c.to) !== ":") {
        throw new ParseError("Missing colon", location);
      }
      var thn = [];
      var els = [];
      while(c.nextSibling()) {  // Focus on thn stmts
        thn.push(traverseStmt(c,s));
      }
      // console.log("Thn:", thn);
      c.parent();
      
      if (c.nextSibling()) {  // Focus on else
        c.nextSibling(); // Focus on : els
        c.firstChild(); // Focus on :
        while(c.nextSibling()) { // Focus on els stmts
          els.push(traverseStmt(c, s));
        }
        c.parent();  
      }
      c.parent();
      return {
        a: location,
        tag: "if",
        cond: cond,
        thn: thn,
        els: els
      }
    case "WhileStatement":
      c.firstChild(); // Focus on while
      c.nextSibling(); // Focus on condition
      var cond = traverseExpr(c, s);
      c.nextSibling(); // Focus on body

      var body = [];
      c.firstChild(); // Focus on :
      if(s.substring(c.from, c.to) !== ":") {
        throw new ParseError("Missing colon", location);
      }
      while(c.nextSibling()) {
        body.push(traverseStmt(c, s));
      }
      c.parent(); 
      c.parent();
      return {
        a: location,
        tag: "while",
        cond,
        body
      }
    case "ForStatement":
      c.firstChild() // for
      c.nextSibling()
      //const for_var = traverseExpr(c, s)
      const for_var = traverseDestructureTargets(c, s);
      //c.nextSibling()
      // for when we implement destructuring 

      // while(s.substring(c.from, c.to) == ',') {
      //   c.nextSibling()
      //   for_var.push(traverseExpr(c, s))
      //   c.nextSibling()
      // }
      c.nextSibling()
      const iterable = traverseExpr(c,s)
      c.nextSibling()
      var body = []
      c.firstChild()
      while(c.nextSibling()) {
        body.push(traverseStmt(c, s))
      }
      c.parent()
      var elseBody = []
      if(c.nextSibling()) {
        while(s.substring(c.from, c.to) !== 'else')
          c.nextSibling()
        c.nextSibling()
        c.firstChild()
        while(c.nextSibling()) {
          elseBody.push(traverseStmt(c, s))
        }
        c.parent()
      }
      c.parent()
      return {
        a: location,
        tag: "for",
        vars: for_var,
        iterable: iterable,
        body: body,
        elseBody: elseBody
      };

    case "PassStatement":
      return { a: location, tag: "pass" }
    case "ContinueStatement":
      return { a: location, tag: "continue" }
    case "BreakStatement":
      return { a: location, tag: "break" }
    default:
      throw new ParseError("Could not parse stmt at " + c.node.from + " " + c.node.to + ": " + s.substring(c.from, c.to), location);
  }
}

function typeFromString(s: string): Type {
  switch(s) {
    case "int": return NUM;
    case "bool": return BOOL;
    case "TypeVar": return TYPE_VAR;
    default: return CLASS(s);
  }
}

function traverseDestructureTargets(c: TreeCursor, s: string):DestructureLHS<SourceLocation>[] {
  const lhsargs : DestructureLHS<SourceLocation>[] = [];
  var location = getSourceLocation(c, s);
  var hasStarred = 0;

  do{
    if(c.name === "AssignOp") 
      break;
    else if (c.type.name === "in") 
      break;
    else if (c.type.name === ",") 
      continue;
    else {
      var lhs = traverseDestructureLHS(c,s);
      if(lhs.isStarred){
        hasStarred = hasStarred + 1
        if (hasStarred > 1)
          throw new ParseError("Multiple starred expressions.", location)
      }
      lhsargs.push(lhs)
    } 
  } while(c.nextSibling())
  // check if we want normal assignment expressions to have * or not

  return lhsargs;
}
/** This function takes in input to destructure. 
 * Input of kind i,j,k (lhs) of an assignment expression.
 * @returns DestructureLHS
 */
function traverseDestructureLHS(c: TreeCursor, s: string):DestructureLHS<SourceLocation> {
  let isIgnore = false;
  let isStarred = false;
  // 1. check if star in from of variable name
  if (c.name === "*") {
    isStarred = true;
    c.nextSibling();
  }
  const lhs = traverseAssignTarget(c,s);
  // 3. check if ignore is encountered 
  if (lhs.tag === "id" && lhs.name === "_"){
    isIgnore = true;
  }
  return {lhs, isIgnore, isStarred};
}

/** This function takes in input to destructure. 
 * Input of kind 2,3,4 (rhs) of an assignment expression.
 * @returns Array<Expr<SourceLocation>>
 */
function traverseDestructureValues(c: TreeCursor, s: string): Array<Expr<SourceLocation>> {
  // Parse RHS
  const rhsargs:Expr<SourceLocation>[] = [];
  do{
    if(c.name === "AssignOp") 
      break;
    else if (c.type.name === ",") 
      continue;
    else 
      var rhs = traverseExpr(c,s);
      rhsargs.push(rhs)
  
  }while(c.nextSibling())

  return rhsargs;
}

function traverseAssignTarget(c: TreeCursor, s: string):AssignTarget<SourceLocation> {
  var location = getSourceLocation(c, s);
  const lhs = traverseExpr(c,s);
  // 2. LHS is valid expression type : "id" | "lookup" 
  if (lhs.tag!=="id" && lhs.tag!=="lookup" && lhs.tag !== "index") {
    throw new ParseError("Cannot have "+ lhs.tag + " expression at LHS while parsing assignment statements.", location)
  }
  return lhs;
}

export function traverseType(c : TreeCursor, s : string) : Type {
  // For now, always a VariableName
  if (c.firstChild()) {
    if (s.substring(c.from, c.to) === "set") {
      c.nextSibling();
      c.nextSibling();
      let vt : Type = traverseType(c, s);
      c.parent();
      return {tag: "set", valueType: vt};
    }
    c.parent();
  }
  let name = s.substring(c.from, c.to);
  switch(name) {
    case "int": return NUM;
    case "bool": return BOOL;
    case "TypeVar": return TYPE_VAR;
    default:
      //list type
      if(c.type.name === "ArrayExpression") {
        c.firstChild(); // focus on [
        c.nextSibling();
        const type = traverseType(c, s);
        c.nextSibling(); 
        if(s.substring(c.from, c.to) !== "]") { //missing closing square bracket
          c.parent();
          throw new Error("Parse error at " + s.substring(c.from, c.to));
        }
        c.parent(); //up from ArrayExpression

        return {tag: "list", type};
    } else {
      //object
      const genericRegex = /\[[A-Za-z]*\]/g;
      const genericArgs = name.match(genericRegex);
      if(genericArgs) {
        const className = name.split('[')[0];
        const genericNamesStr = genericArgs.toString();
        const genericNames = genericNamesStr.substring(1, genericNamesStr.length - 1).split(',');
        const genericTypes = genericNames.map(gn => typeFromString(gn));
        return CLASS(className, genericTypes);
      } else {
        return CLASS(name);
      }
    }      
  }
}

export function traverseParameters(c : TreeCursor, s : string) : Array<Parameter<null>> {
  var location = getSourceLocation(c, s);
  c.firstChild();  // Focuses on open paren
  const parameters = [];
  c.nextSibling(); // Focuses on a VariableName
  while(c.type.name !== ")") {
    let name = s.substring(c.from, c.to);
    c.nextSibling(); // Focuses on "TypeDef", hopefully, or "," if mistake
    let nextTagName = c.type.name; // NOTE(joe): a bit of a hack so the next line doesn't if-split
    if(nextTagName !== "TypeDef") { throw new ParseError("Missed type annotation for parameter " + name, location)};
    c.firstChild();  // Enter TypeDef
    c.nextSibling(); // Focuses on type itself
    let typ = traverseType(c, s);
    c.parent();
    c.nextSibling(); // Move on to comma or ")"
    parameters.push({name, type: typ});
    c.nextSibling(); // Focuses on a VariableName
  }
  c.parent();       // Pop to ParamList
  return parameters;
}

export function traverseVarInit(c : TreeCursor, s : string) : VarInit<SourceLocation> {
  var location = getSourceLocation(c, s);
  c.firstChild(); // go to name
  var name = s.substring(c.from, c.to);
  c.nextSibling(); // go to : type

  if(c.type.name !== "TypeDef") {
    c.parent();
    throw new ParseError("invalid variable init", location);
  }
  c.firstChild(); // go to :
  c.nextSibling(); // go to type
  const type = traverseType(c, s);
  c.parent();
  
  c.nextSibling(); // go to =
  c.nextSibling(); // go to value
  var value = traverseLiteral(c, s);
  c.parent();

  return { a: location, name, type, value }
}

export function traverseFunDef(c : TreeCursor, s : string) : FunDef<SourceLocation> {
  var location = getSourceLocation(c, s);
  c.firstChild();  // Focus on def
  c.nextSibling(); // Focus on name of function
  var name = s.substring(c.from, c.to);
  c.nextSibling(); // Focus on ParamList
  var parameters = traverseParameters(c, s)
  c.nextSibling(); // Focus on Body or TypeDef
  let ret : Type = NONE;
  if(c.type.name === "TypeDef") {
    c.firstChild();
    ret = traverseType(c, s);
    c.parent();
    c.nextSibling();
  }
  c.firstChild();  // Focus on :
  var inits = [];
  var body = [];
  
  var hasChild = c.nextSibling();

  while(hasChild) {
    if (isVarInit(c, s)) {
      inits.push(traverseVarInit(c, s));
    } else {
      break;
    }
    hasChild = c.nextSibling();
  }

  while(hasChild) {
    body.push(traverseStmt(c, s));
    hasChild = c.nextSibling();
  } 
  
  // console.log("Before pop to body: ", c.type.name);
  c.parent();      // Pop to Body
  // console.log("Before pop to def: ", c.type.name);
  c.parent();      // Pop to FunctionDefinition
  return { a: location, name, parameters, ret, inits, body }
}

function traverseGenerics(c: TreeCursor, s: string): Array<string> {
  let typeVars: Array<string> = [];

  c.firstChild(); // focus on (
  c.nextSibling(); // focus on type
  while(c.type.name !== ")") {
    const type = traverseType(c, s);
    if(type.tag=="class" && type.name=="Generic" && type.genericArgs != undefined && type.genericArgs.length > 0) {
      type.genericArgs.forEach(ga => {
        if(ga.tag=="class") {
          typeVars.push(ga.name);
        } else {
          throw new Error("Expected TypeVar in Generic[] args");
        }
      });
    }
    c.nextSibling(); // focus on , or )
    c.nextSibling(); // focus on type
  }

  c.parent();       // Pop to ArgList
  return typeVars;
}

export function traverseClass(c : TreeCursor, s : string) : Class<SourceLocation> {
  var location = getSourceLocation(c, s);
  const fields : Array<VarInit<SourceLocation>> = [];
  const methods : Array<FunDef<SourceLocation>> = [];
  c.firstChild();
  c.nextSibling(); // Focus on class name
  const className = s.substring(c.from, c.to);
  c.nextSibling(); // Focus on arglist/superclass
  const generics = traverseGenerics(c, s);
  c.nextSibling(); // Focus on body
  c.firstChild();  // Focus colon
  while(c.nextSibling()) { // Focuses first field
    if (isVarInit(c, s)) {
      fields.push(traverseVarInit(c, s));
    } else if (isFunDef(c, s)) {
      methods.push(traverseFunDef(c, s));
    } else {
      throw new ParseError(`Could not parse the body of class: ${className}`, location);
    }
  } 
  c.parent();
  c.parent();

  if (!methods.find(method => method.name === "__init__")) {
    if(generics.length > 0) {
      const genericTypes = generics.map(g => CLASS(g));
      methods.push({ a: location, name: "__init__", parameters: 
        [{ name: "self", type: CLASS(className, genericTypes) }], ret: NONE, inits: [], body: [] 
      });
    } else {
      methods.push({ a: location, name: "__init__", parameters: [{ name: "self", type: CLASS(className) }], ret: NONE, inits: [], body: [] });
    }
  }
  return {
    a: location,
    name: className,
    generics,
    fields,
    methods
  };
}

export function traverseDefs(c : TreeCursor, s : string) : [Array<VarInit<SourceLocation>>, Array<FunDef<SourceLocation>>, Array<Class<SourceLocation>>] {
  const inits : Array<VarInit<SourceLocation>> = [];
  const funs : Array<FunDef<SourceLocation>> = [];
  const classes : Array<Class<SourceLocation>> = [];

  while(true) {
    if (isVarInit(c, s)) {
      inits.push(traverseVarInit(c, s));
    } else if (isFunDef(c, s)) {
      funs.push(traverseFunDef(c, s));
    } else if (isClassDef(c, s)) {
      classes.push(traverseClass(c, s));
    } else {
      return [inits, funs, classes];
    }
    c.nextSibling();
  }

}

export function isVarInit(c : TreeCursor, s : string) : Boolean {
  if (c.type.name === "AssignStatement") {
    c.firstChild(); // Focus on lhs
    c.nextSibling(); // go to : type

    const isVar = c.type.name as any === "TypeDef";
    c.parent();
    return isVar;  
  } else {
    return false;
  }
}

export function isFunDef(c : TreeCursor, s : string) : Boolean {
  return c.type.name === "FunctionDefinition";
}

export function isClassDef(c : TreeCursor, s : string) : Boolean {
  return c.type.name === "ClassDefinition";
}

export function traverse(c : TreeCursor, s : string) : Program<SourceLocation> {
  var location = getSourceLocation(c, s);
  switch(c.node.type.name) {
    case "Script":
      const inits : Array<VarInit<SourceLocation>> = [];
      const funs : Array<FunDef<SourceLocation>> = [];
      const classes : Array<Class<SourceLocation>> = [];
      const stmts : Array<Stmt<SourceLocation>> = [];
      var hasChild = c.firstChild();

      while(hasChild) {
        if (isVarInit(c, s)) {
          inits.push(traverseVarInit(c, s));
        } else if (isFunDef(c, s)) {
          funs.push(traverseFunDef(c, s));
        } else if (isClassDef(c, s)) {
          classes.push(traverseClass(c, s));
        } else {
          break;
        }
        hasChild = c.nextSibling();
      }

      while(hasChild) {
        stmts.push(traverseStmt(c, s));
        hasChild = c.nextSibling();
      } 
      c.parent();
      return { a: location, funs, inits, classes, stmts };
    default:
      throw new ParseError("Could not parse program at " + c.node.from + " " + c.node.to, location);
  }
}

export function parse(source : string) : Program<SourceLocation> {
  const t = parser.parse(source);
  const str = stringifyTree(t.cursor(), source, 0);
  return traverse(t.cursor(), source);
}
