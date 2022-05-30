import { type } from "os";
import { stringify } from "querystring";
import { Program, Expr, Stmt, UniOp, BinOp, Parameter, Type, FunDef, VarInit, Class, Literal, SourceLocation } from "./ast";
import { CLASS, TYPE_VAR } from "./utils";

type GenericEnv = {
    typeVars: Map<string, Literal<SourceLocation>>,
    typeVarSpecializations: Map<string, Set<Type>>
}

type ClassEnv = {
    genericArgs: Map<string, Array<string>>
}

// For some reason when running tests it can't find Array.flat(), so I use this as a helper
function flat<T>(arr: T[][]): T[] {
    return [].concat(...arr);
}

export function removeGenerics(ast: Program<SourceLocation>): Program<SourceLocation> {
    // Find the TypeVars for this program. Right now I'm just searching the program global variables but ideally in the future
    // this could be done in functions and methods as well.
    let bodyTypeVars = findTypeVarInits(ast.inits);
    let genericsEnv = {typeVars: bodyTypeVars, typeVarSpecializations: new Map<string, Set<Type>>()};

    // TODO: do this for function variables too or disallow type vars as local variables
    const conflictingGlobals = ast.inits.filter(i => i.type.tag != "type-var" && bodyTypeVars.has(i.name));
    const conflictingClasses = ast.classes.filter(c => bodyTypeVars.has(c.name));
    if(conflictingGlobals.length > 0 || conflictingClasses.length > 0) {
        throw new Error("TYPE ERROR: Class name(s) or local variable name(s) in conflict with type var name");
    }


    // Find what TypeVars each class definition uses. For example:
    // class Box(Generic[T], object):
    // gives the classEnv entry Box => [T]
    const classEnv = programClassEnv(ast);

    // Now, we need to do two things: 
    // 1. For each TypeVar we need to find out which types it takes on (or how it is specialized)
    // 2. Change the Type of each generic object in the Ast from (for example) Box[int] to something like Box_number
    //  This is because we're creating a new Box_[type] class for each specialization.
    const newGlobalInits = ast.inits.map(i => {
        if(i.type.tag == "class" && i.type.genericArgs) {
            addSpecializationsForType(i.type, genericsEnv, classEnv);

            const specializationName = typeString(i.type);
            const newType = CLASS(specializationName);
            return {...i, type: newType};
        }
        return i;
    }).filter(i => i.type.tag != "type-var");

    const newStmts = ast.stmts.map(s => {
        return specializeConstructorsInStmt(s, genericsEnv, classEnv);
    });

    const newFuns = ast.funs.map(f => removeGenericsFromFun(f, genericsEnv, classEnv));

    ast.classes.forEach(classDef => addSpecializationsInClass(classDef, genericsEnv, classEnv));

    // now just replace the generic classes with the specialized classes.
    // ex. Create all the Box_number, Box_bool, etc classes for each type in genericsEnv.typeVarSpecializations["T"]
    const specializedClasses = flat(ast.classes.map(c => specializeClass(c, genericsEnv, classEnv)));
    const newClasses = specializedClasses.map(c => removeGenericsFromClass(c, genericsEnv, classEnv));

    return {...ast, inits: newGlobalInits, funs: newFuns, classes: newClasses, stmts: newStmts};
}


function findTypeVarInits(inits: Array<VarInit<SourceLocation>>): Map<string, Literal<SourceLocation>> {
    let genericNames = new Map<string, Literal<SourceLocation>>();
    inits.forEach(i => {
        if (i.type == TYPE_VAR) {
            genericNames.set(i.name, i.value);
        }
    });

    return genericNames;
}

function programClassEnv(ast: Program<SourceLocation>): ClassEnv {
    let env = {genericArgs: new Map<string, Array<string>>()};
    ast.classes.forEach(c => {
        if(c.generics != undefined && c.generics.length > 0) {
            env.genericArgs.set(c.name, c.generics);
        }
    });

    return env;
}

function getOrDefault(genericTypes: Map<string, Set<Type>>, key: string): Set<Type> {
    if (!genericTypes.has(key)) {
        genericTypes.set(key, new Set<Type>());
    }
    return genericTypes.get(key);
}

// This creates the mangled string for generic object types.
// For example, it turns Box[int] to Box_number
function typeString(type: Type): string {
    let name = "";
    if(type.tag=="class") {
        name = type.name;

        if(type.genericArgs) {
            type.genericArgs.forEach(ga => {
                name += "_" + typeString(ga);
            });
        }

        return name;
    } else if(type.tag == "either") {
        return typeString(type.left) + "#" + typeString(type.right); 
    } else if(type.tag == "list") {
        const name = type.tag + "_" + typeString(type.type);
        return name;
    } else if(type.tag == "set") {
        const name = type.tag + "_" + typeString(type.valueType);
        return name;
    } else if(type.tag == "generator") {
        const name = type.tag + "_" + typeString(type.type);
        return name;
    } else {
        return type.tag;
    }
}

function addSpecializationsForType(type: Type, genericsEnv: GenericEnv, classEnv: ClassEnv) {
    if(type.tag != "class" || !type.genericArgs) {
        return;
    }

    const classTypeVars = classEnv.genericArgs.get(type.name);
    type.genericArgs.forEach((ga, i) => {
        if(ga.tag != "class" || !genericsEnv.typeVars.has(ga.name)) {
            const classTypeVar = classTypeVars[i];
            let specializations = getOrDefault(genericsEnv.typeVarSpecializations, classTypeVar);
            specializations.add(ga);
        }
    });
}

function specializeConstructorsInStmt(stmt: Stmt<SourceLocation>, genericsEnv: GenericEnv, classEnv: ClassEnv): Stmt<SourceLocation> {
    switch(stmt.tag) {
        case "assign": {
            const newVal = specializeConstructorsInExpr(stmt.value, genericsEnv, classEnv);
            return {...stmt, value: newVal};
        }
        case "assign-destr": {
            const newRhs = specializeConstructorsInExpr(stmt.rhs, genericsEnv, classEnv);
            return {...stmt, rhs: newRhs};
        }
        case "return": {
            const newVal = specializeConstructorsInExpr(stmt.value, genericsEnv, classEnv);
            return {...stmt, value: newVal};
        }
        case "expr": {
            const newExpr = specializeConstructorsInExpr(stmt.expr, genericsEnv, classEnv);
            return {...stmt, expr: newExpr};
        }
        case "field-assign": {
            const newObj = specializeConstructorsInExpr(stmt.obj, genericsEnv, classEnv);
            const newVal = specializeConstructorsInExpr(stmt.value, genericsEnv, classEnv);
            return {...stmt, obj: newObj, value: newVal};
        }
        case "index-assign": {
            const newObj = specializeConstructorsInExpr(stmt.obj, genericsEnv, classEnv);
            const newVal = specializeConstructorsInExpr(stmt.value, genericsEnv, classEnv);
            return {...stmt, obj: newObj, value: newVal};
        }
        case "if": {
            const newCond = specializeConstructorsInExpr(stmt.cond, genericsEnv, classEnv);
            const newThn = stmt.thn.map(s => specializeConstructorsInStmt(s, genericsEnv, classEnv));
            const newEls = stmt.els.map(s => specializeConstructorsInStmt(s, genericsEnv, classEnv));
            return {...stmt, cond: newCond, thn: newThn, els: newEls};
        }
        case "while": {
            const newCond = specializeConstructorsInExpr(stmt.cond, genericsEnv, classEnv);
            const newBody = stmt.body.map(s => specializeConstructorsInStmt(s, genericsEnv, classEnv));
            return {...stmt, cond: newCond, body: newBody};
        }
        case "for" : {
            const newVars = specializeConstructorsInExpr(stmt.vars, genericsEnv, classEnv);
            const newIterable = specializeConstructorsInExpr(stmt.iterable, genericsEnv, classEnv);
            const newBody = stmt.body.map(s => specializeConstructorsInStmt(s, genericsEnv, classEnv));
            let newElseBody = null;
            if(stmt.elseBody) {
                newElseBody = stmt.elseBody.map(s => specializeConstructorsInStmt(s, genericsEnv, classEnv));
            }
            return {...stmt, vars: newVars, iterable: newIterable, body: newBody, elseBody: newElseBody};
        }
        default:
            return stmt;
    }
}

function specializeConstructorsInExpr(expr: Expr<SourceLocation>, genericsEnv: GenericEnv, classEnv: ClassEnv): Expr<SourceLocation> {
    switch(expr.tag) {
    case "binop":
        const newLeft = specializeConstructorsInExpr(expr.left, genericsEnv, classEnv);
        const newRight = specializeConstructorsInExpr(expr.right, genericsEnv, classEnv);
        return {...expr, left: newLeft, right: newRight};
    case "uniop":
        const newExpr = specializeConstructorsInExpr(expr.expr, genericsEnv, classEnv);
        return {...expr, expr: newExpr};
    case "call":
        const newArgs = expr.arguments.map(argExpr => specializeConstructorsInExpr(argExpr, genericsEnv, classEnv));
        if (classEnv.genericArgs.has(expr.name)) {
            let newName = expr.name;
            expr.genericArgs.forEach(ga => {
                newName += '_' + typeString(ga);
            })

            return {...expr, name: newName, arguments: newArgs};
        }
        return {...expr, arguments: newArgs};
    case "lookup": {
        const newObj = specializeConstructorsInExpr(expr.obj, genericsEnv, classEnv);
        return {...expr, obj: newObj};
    }
    case "listliteral":
        const newElems = expr.elements.map(elem => specializeConstructorsInExpr(elem, genericsEnv, classEnv));
        return {...expr, elements: newElems};
    case "index": {
        const newObj = specializeConstructorsInExpr(expr.obj, genericsEnv, classEnv);
        const newIdx = specializeConstructorsInExpr(expr.index, genericsEnv, classEnv);
        return {...expr, obj: newObj, index: newIdx};
    }
    case "method-call": {
        const newObj = specializeConstructorsInExpr(expr.obj, genericsEnv, classEnv);
        const newArgs = expr.arguments.map(arg => specializeConstructorsInExpr(arg, genericsEnv, classEnv));
        return {...expr, obj: newObj, arguments: newArgs};
    }
    case "set": {
        const newVals = expr.values.map(val => specializeConstructorsInExpr(val, genericsEnv, classEnv));
        return {...expr, values: newVals};
    }
    case "comprehension": {
        const newLhs = specializeConstructorsInExpr(expr.lhs, genericsEnv, classEnv);
        const newIterable = specializeConstructorsInExpr(expr.iterable, genericsEnv, classEnv);
        let newIfCond = null;
        if(expr.ifcond) {
            newIfCond = specializeConstructorsInExpr(expr.ifcond, genericsEnv, classEnv);
        }

        return {...expr, lhs: newLhs, iterable: newIterable, ifcond: newIfCond};
    }
    case "ternary": {
        const newExprIfTrue = specializeConstructorsInExpr(expr.exprIfTrue, genericsEnv, classEnv);
        const newIfCond = specializeConstructorsInExpr(expr.ifcond, genericsEnv, classEnv);
        const newExprIfFalse = specializeConstructorsInExpr(expr.exprIfFalse, genericsEnv, classEnv);
        return {...expr, exprIfTrue: newExprIfTrue, ifcond: newIfCond, exprIfFalse: newExprIfFalse};
    }
    case "non-paren-vals": {
        const newVals = expr.values.map(val => specializeConstructorsInExpr(val, genericsEnv, classEnv));
        return {...expr, values: newVals};
    }
    default:
        return expr;
    }
}

function removeGenericsFromFun(fun: FunDef<SourceLocation>, genericsEnv: GenericEnv, classEnv: ClassEnv): FunDef<SourceLocation> {
    const newInits = fun.inits.map(i => {
        if(i.type.tag == "class" && i.type.genericArgs) {
            addSpecializationsForType(i.type, genericsEnv, classEnv);
            
            const specializationName = typeString(i.type);
            const newType = CLASS(specializationName);
            return {...i, type: newType};
        }
        return i;
    });

    const newParams = fun.parameters.map(p => {
        if(p.type.tag == "class" && p.type.genericArgs) {
            addSpecializationsForType(p.type, genericsEnv, classEnv);

            const specializationName = typeString(p.type);
            const newType = CLASS(specializationName);
            return {...p, type: newType};
        }
        return p;
    });

    let newRet = fun.ret;
    if(fun.ret.tag == "class" && fun.ret.genericArgs) {
        addSpecializationsForType(fun.ret, genericsEnv, classEnv);

        const specializationName = typeString(fun.ret);
        newRet = CLASS(specializationName);
    }

    const newBody = fun.body.map(s => specializeConstructorsInStmt(s, genericsEnv, classEnv));

    return {...fun, parameters: newParams, ret: newRet, inits: newInits, body: newBody};
}

function removeGenericsFromType(type: Type, variant: Map<string, Type>): Type {
    if(type.tag == "class" && type.genericArgs){
        const newGenericArgs = type.genericArgs.map(argType => {
            return removeGenericsFromType(argType, variant);
        });

        return {...type, genericArgs: newGenericArgs};
    } else if (type.tag == "list") {
        const newType = removeGenericsFromType(type.type, variant);
        return {...type, type: newType};
    } else if (type.tag == "set") {
        const newType = removeGenericsFromType(type.valueType, variant);
        return {...type, valueType: newType};
    } else if (type.tag == "class" && variant.has(type.name)) {
        return variant.get(type.name);
    }
    return type;
}

function addSpecializationsInClass(classDef: Class<SourceLocation>, genericsEnv: GenericEnv, classEnv: ClassEnv) {
    classDef.fields.forEach(f =>
        addSpecializationsForType(f.type, genericsEnv, classEnv)
    );

    classDef.methods.forEach(m => {
        m.inits.forEach(i => addSpecializationsForType(i.type, genericsEnv, classEnv));
        m.parameters.forEach(p => addSpecializationsForType(p.type, genericsEnv, classEnv));
        addSpecializationsForType(m.ret, genericsEnv, classEnv);
    });
}

function defaultValue(type: Type, prevVal: Literal<SourceLocation>): Literal<SourceLocation> {
    let newValue = prevVal;
    if(type.tag == "number") {
        newValue = {...newValue, tag: "num", value: 0};
    } else if (type.tag == "bool") {
        newValue = {...newValue, tag: "bool", value: false};
    }

    return newValue;
}

function specializeClass(classDef: Class<SourceLocation>, genericsEnv: GenericEnv, classEnv: ClassEnv): Array<Class<SourceLocation>> {
    if(classDef.generics == undefined || classDef.generics.length == 0) {
        return [classDef];
    }

    const typeVarNames = classDef.generics;

    let allVariants = [new Map<string, Type>()];
    typeVarNames.forEach(name => {
        let newAllVariants: Array<Map<string, Type>> = [];
        let specializationsForTypeVar = genericsEnv.typeVarSpecializations.get(name)
        if(!specializationsForTypeVar) {
            return;
        }

        specializationsForTypeVar.forEach(type => {
            newAllVariants = newAllVariants.concat(allVariants.map(v => {
                let newV = new Map<string, Type>(v);
                newV.set(name, type);
                return newV;
            }));
        });

        allVariants = newAllVariants;
    });

    const newClasses = allVariants.map(variant => {
        let newName = classDef.name;
        variant.forEach(t => {newName += "_" + typeString(t);});

        const newFields = classDef.fields.map(field => {
            const newType = removeGenericsFromType(field.type, variant);
            const newValue = defaultValue(newType, field.value);

            return {...field, type: newType, value: newValue};
        });

        const newMethods = classDef.methods.map(method => {
            const newInits = method.inits.map(init => {
                const newType = removeGenericsFromType(init.type, variant);
                const newValue = defaultValue(newType, init.value);
                return {...init, type: newType, value: newValue};
            });

            const newParams = method.parameters.map(param => {
                const newType = removeGenericsFromType(param.type, variant);
                return {...param, type: newType};
            })

            const newRet = removeGenericsFromType(method.ret, variant);

            return {...method, inits: newInits, parameters: newParams, ret: newRet};
        });

        // TODO: get rid of Generic parent objects

        return {...classDef, name: newName, fields: newFields, methods: newMethods};
    });


    return newClasses;
}

function removeGenericsFromClass(classDef: Class<SourceLocation>, genericsEnv: GenericEnv, classEnv: ClassEnv): Class<SourceLocation> {
    // Second, rename all specialized generics like with functions, ex. Box[int] to Box_int.
    
    const newFields = classDef.fields.map(f => {
        if(f.type.tag != "class") {
            return f;
        }

        const specializationName = typeString(f.type);
        const newType = CLASS(specializationName);
        return {...f, type: newType};
    });

    const newMethods = classDef.methods.map(m => removeGenericsFromFun(m, genericsEnv, classEnv));

    return {...classDef, fields: newFields, methods: newMethods};
}