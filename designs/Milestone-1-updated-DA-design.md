# Destructuring Assignment - Design

For Milestone 1, we have supported the following test cases. We have supported the basic destructuring assignment operations along with Parse and Type Errors in this milestone end-end.

## Test Cases

### Valid Cases

1. Basic Destructuring with builtins

```python
a:int = 0
b:int = 0
a,b = abs(-10), max(min(5, 7),6)
assert(a == 10)
assert(b == 6)
```

2. Destructuring with a function call on RHS

```python
def f(x:int)->int:
    return x

a:int = 0
b:int = 0
a,b = 5,f(6)

assert(a == 5)
assert(b == 6)
```

3. Destructuring with _ (Ignore) 

```
x : int = 0
y : int  = 0
x,_, y = 5, 6, 7
assert(x == 5)
assert(y == 7)
```

4. Destructuring with class field lookup

```
class C(object):
 x : int = 123

x : int = 0
y : bool = False
c : C = None
c = C()

x,c.x, y = 5, 10, True

assert(x == 5)
assert(c.x == 10)
assert(y == True)
```

5. Destructuring with Binary and Unary Expressions on RHS

```
def f() -> int:
 return 5

x : int = 0
y : int = 0
z : int = 0

x, y, z = f() + 20 , 10, -20
assert(x == 25)
assert(y == 10)
assert(z == -20)
```

6. Destructuring with an extra comma

```
a:int = 0
a,  = 5,
assert(a==5)
```

7. Destructuring with IDs on both sides

```
a:int = 0
b:int = 6
c:int = 7
d:int = 10
a,b = c,d
assert(a==7)
assert(b==10)
```



### Error Cases

1. Type Error thrown while destructuring due to unbound IDs

```python
a,b = 5,6
```

_Expected Output_ : 
```
TYPE ERROR : Unbound id: a
```

2. Type Error thrown while destructuring due to inconsistent types

```python
a:int = 0
b:int = 0
a, b = 5, False
```

_Expected Output_ : 
```
TYPE ERROR : Type Mismatch while destructuring assignment
```

3. Type Error thrown while destructuring due to mismatch of arguments while unpacking

```python
a:int = 0
b:int = 0
a, b = 5, 6, 7
```

_Expected Output_ : 
```
TYPE ERROR : length mismatch left and right hand side of assignment expression.
```


4. Parse Error thrown while destructuring due to binary expression on LHS

```python
a:int = 0
b:int = 0
a + 5, b = 5, 6
```

_Expected Output_ : 
```
PARSE ERROR : Cannot have binop expression at LHS while parsing assignment statements
```


5. Parse Error thrown while destructuring due to incorrect syntax

```python
a:int = 0
b:int = 0
 ,  = 5,4
```

_Expected Output_ : 
```
PARSE ERROR : Could not parse stmt at 21 22: ,at line 3
```

6. Type Error for incorrect LHS type

```
x : int = 10

def f() -> int:
 return x

a:int = 0
b:int = 0
a, f() = abs(-10), max(min(5, 7),6)

```
_Expected Output_ : 
```
PARSE ERROR : Cannot have call expression at LHS while parsing assignment statement
```



## Changes Made

### AST

**New AST**:
```
expr = 
| { a?: A, tag: "assign-destr", destr: DestructureLHS<A>[], rhs:Expr<A>[] }

export type DestructureLHS<A> = { a?: A, lhs: AssignTarget, isStarred : boolean, isIgnore : boolean}

export type AssignTarget = 
| { tag : "id", name : string}
| { tag : "lookup", obj: Expr<A>, field: string }

```

### Design Decisions made:
* We chose to constrain the type of expressions supported on the LHS of Destructuring to be "ID" or "Lookup" expressions. This has been achieved using the DestructureLHS type defined in the AST
* We created booleans isStarred and isIgnore to handle \* and \_ cases
* We unpacked the Destructure Statement to individual Assignment Statements in *lower.ts* so that compiler processes them appropriately.
* We implemented an algorithm for Type Checking types in LHS vs RHS keeping in view the \_ and \* cases.


### IR
No changes in IR as Destructure is unpacked as Assign Statement in *lower.ts*

### Built-in Libraries
No changes to built-in libraries for this functionality.

### Type Checker
As part of the TypeChecker for Milestone 1, we have supported : 

- LHS variables are declared (following ChocoPy recommendation of declaration before definition)
- LHS is valid expression type : "id" | "lookup" | "starred" | "ignore" (Predefined types handled recursively)
- RHS is valid assignment type : "literal" | "id"
- If we encounter above assignment types, we check the length of subsequent targets with lhs.
- Type of individual assignments with Ignore and Starred.

### Parser
For the parser in Milestone 1, we have supported : 

- Parsing of multiple variables and values on LHS and RHS
- Parsing of "\_" and "\*\_" for ignore and starred id cases 
- Parsing *BinaryExpression*, *CallExpression*, *Builtins* 
- Check for parse errors for id and syntax.



