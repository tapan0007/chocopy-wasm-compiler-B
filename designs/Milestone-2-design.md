# Destructuring Assignment - Milestone 2 Design

For Milestone 2, we aim to support the following test cases : 

## Test Cases

### Valid Cases

1. Destructuring with lists on RHS

```
a : int = 0
b : int = 0
c : [int] = None
a,b,c = [1,2,[3,4]]
assert(a == 1)
assert(b == 2)
assert(c == [3,4])
```

2. Destructuring with sets and lists on RHS

```
a : int = 0
c : [int] = None
a,_,c = {1,2,[3,4]}
assert(a == 1)
assert(c == [3,4])
```

3. Destructuring with Range and other values on RHS

```
a : int = 0
b : int = 0
c : int = 0
a,b,c = 2, range(0,2)
assert(a == 2)
assert(b == 0)
assert(c == 1)
```

4. Destructuring with Range and Starred Expressions

```
a : int = 0
b : [int] = None
a, *b = 2, range(0,2)
assert(a == 2)
assert(b == [0,1])
```

5. Destructuring with Lists and Starred Expressions

```
a : int = 0
b : int = 0
c : [int] = None
a,b,*c = [1,2,3,4]
assert(a == 1)
assert(b == 2)
assert(c == [3,4])
```

6. Destructuring with strings

```
a : str = "a"
b : str = "b"
c : str = "c"
a,b,c = "abc", "bcd", "cd"
assert(a == "abc")
assert(b == "bcd")
assert(c == "cd")
```

7. Destructuring in _for_ loops

```
a:[int] = None
b:[int] = None
i:int = 0
j:int = 0
a = [2,3]
b = [3,4]
for i,j in a, b :
    print(i+j)
```

**Expected Output**
```
5

7
```

8. Destructuring with List Indexing as LHS and RHS

```
x : int = 0
y : int = 5
a:[int] = None
b:[int] = None
a = [2,3]
b = [3,4]
x, a[0] = b[0], y
assert(a == [3, 3])
assert(x == 3)
```


### Error Cases

1. Type Error thrown while destructuring due to mismatch of arguments length while unpacking

```
a : int = 0
b : int = 0
c : [int] = None
a,b,c = {1,{2,3}}
```

**Expected Output**

`TYPE ERROR : length mismatch left and right hand side of assignment expression`


2. Type Error thrown while destructuring due to mismatch of arguments type while unpacking

```
a : int = 0
b : int = 0
c : [bool] = None
a,b,c = {1,{2,3}}
```

**Expected Output**

`TYPE ERROR : Type Mismatch while destructuring assignment`

3. Runtime Error thrown due to Iterator

```
a : int = 0
b : int = 0
a, b = range(0,1)
```

**Expected Output**

`RUNTIME ERROR : Not enough values to unpack`

4. Type Error due to starred expression type

```
a : int = 0
b : int = 0
c : bool = True
a,b,*c = 1,2,[True, False]
```

**Expected Output**

`TYPE ERROR : Type Mismatch while destructuring assignment`


## Changes Required

### AST
* To support Lists, we firstly need to extend our RHS support to “listliteral” and “index” and unpack the values in a similar fashion as non-parenthesized RHS. 
* For assignment of lists to a variable, we will already have a “list” type added in “Type”, which will extend similarly like other types.
* We also need to add “index” as valid LHS expressions, so we will need to add “index” in DestructureLHS type.
* To support sets and nested sets, we need to  extend our RHS support to “bracket” and unpack the values in a similar fashion as non-parenthesized RHS.
* There will be a change in current list comprehension AST to support destructuring on LHS.

    **Current AST:**
  `{  a?: A, tag: "for", vars: Expr<A>, iterable: Expr<A>, body: Array<Stmt<A>>, elseBody?: Array<Stmt<A>> }`
  
    **New AST:**
  `{  a?: A, tag: "for", vars: DestructureLHS<A>[], iterable: Expr<A>, body: Array<Stmt<A>>, elseBody?: Array<Stmt<A>> }`
   
   So, we need to change the lhs as "DestructureLHS<A>[]" which is a type that currently supports normal destructuring assignments LHS.
   Iterables will be similarly handled with an Expr<A> as in destructuring RHS.

    

### Parser, Type-Check, Lower
* By extending our AST as described and simultaneously adding support in parser, type-checker and lower, we will be able to run the above examples successfully.
* Currently, range iterator is unpacked as values, in milestone 2, we plan to unpack it even as lists. For that we need to extend our code in lower to assign iterator values as lists to starred expressions on LHS.
* We currently support range, but we have to append the functionality to pop a runtime error while unpacking range/iterators. While converting our ast to lower, we need to add a check for the hasNext function augmenting with a **runtime check** in our WASM code for if we have a next value and LHS is over and vice versa for when LHS still has a value and no next value from iterator.
* We plan to extend destructuring support for “for” loops and list comprehensions as well wherein we plan to apply destructuring as LHS in syntax of for loops and comprehensions, but we will pursue this extension after we have successfully implemented destructuring in above mentioned cases. 


### Built-in Libraries
No changes to built-in libraries for this functionality.
