# Week 7 Update
We sucessfully got all of the tests below working. Run `npm test` to run the generics tests. Some of them had to be slightly modified because
they had compiler errors otherwise but the changes were pretty minor.

Changes to the AST ended up being: 
 * New TypeVar type separate from classes, primitives, etc: `{tag: "type-var"}`
 * Optional generic type arguments for class types.
 * Parents type array on `AST.Class` for allowing classes to inherit `Generic[T]`
 * Optional generic args for regular function call exprs.

The "remove generics" pass does mainly two things: 
 * Collects all the specializations for each TypeVar (ex. in the Introduction below, T is specialized as an int and a bool), then rename
 all the generic types to their new specialized class names (ex. Box[int] -> Box_number).
 * Creates new classes for each type var specialization (ex. in the Introduction, new classes Box_number and Box_bool would be created),
 with TypeVar T swapped out everywhere for number or bool.

# Introduction
We plan to implement generics (kind of) how python does them, like so:
```python
T: TypeVar = TypeVar('T')

class Box(Generic[T]):
   x : T = None

b1 : Box[int] = Box()
b2 : Box[bool] = Box()
```

Where the generic type is created with `TypeVar()` and the parameter `'T'` is some description for the type. The generic type can then be used by a class like above by inheriting `Generic[T]`. `T` is typed mainly so we don't need to mess with how variable declarations are already handled.

This week (week 7) we'll focus on just getting methods and maybe functions to work if it's not too much harder.

# Test cases we plan to pass:

1. Simple generic class of primitive type with function call in method call.
The following should print 10:
```python
T: TypeVar = TypeVar('T')

class Printer(Generic[T]):
   def print(self: Printer, x: T):
       print(x)

p: Printer[int] = None
p = Printer[int]()
p.print(10)
```

2. Simple generic class of two primitive types with function call in method call.
The following should print 10, then True:
```python
T: TypeVar = TypeVar('T')

class Printer(Generic[T]):
   def print(self: Printer, x: T):
       print(x)

p_int: Printer[int] = None
p_int = Printer[int]()
p_int.print(10)

p_bool: Printer[bool] = None
p_bool = Printer[bool]()
p_bool.print(True)
```

3. Simple generic class of one object type with invalid print call.
The following should error, saying something like "trying to call print with invalid arg type (Box)"
```python
T: TypeVar = TypeVar('T')

class Box(object):
    val: int = 10

class Printer(Generic[T]):
   def print(self: Printer, x: T):
       print(x)

p: Printer[Box] = None
p = Printer[Box]()
p.print(Box())
```

4. Simple generic class of one object type with invalid binop and generic return.
The following should error, saying something like "trying to do binop with invalid arg type (bool)"
```python
T: TypeVar = TypeVar('T')

class Adder(Generic[T]):
   def add(self: Printer, x: T, y: T) -> T:
       return x + y

a: Adder[bool] = None
a = Adder[bool]()
print(a.add(True, False))
```

5. Simple generic class of one object type with valid binop and generic return.
The following should print 10.
```python
T: TypeVar = TypeVar('T')

class Adder(Generic[T]):
   def add(self: Printer, x: T, y: T) -> T:
       return x + y

a: Adder[int] = None
a = Adder[int]()
print(a.add(4, 6))
```

6. Simple generic class of one object type with invalid method call.
The following should error, saying something like "trying to call Printer.print with invalid arg type (Box)"
```python
T: TypeVar = TypeVar('T')

class Box(object):
    val: int = 10

class Printer(Generic[T]):
   def print(self: Printer, x: T):
       print(x)

p: Printer[int] = None
p = Printer[int]()
p.print(Box())
```

7. Overlapping generic and identifier names. The following should give an error like "identifier T defined earlier"
```python
T: int = 0
T: TypeVar = TypeVar('T')

class Printer(Generic[T]):
   def print(self: Printer, x: T):
       print(x)

p: Printer[int] = None
p = Printer[int]()
p.print(10)
```

8. Overlapping generic and class names. The following should give an error like "unable to resolve between class T and TypeVar T".
```python
class T(object):
    pass

T: TypeVar = TypeVar('T')

class Printer(Generic[T]):
   def print(self: Printer, x: T):
       print(x)

p: Printer[int] = None
p = Printer[int]()
p.print(10)
```

9. Generic objects as parameters. The following should print 10.
```python
T: TypeVar = TypeVar('T')

class Printer(Generic[T]):
   def print(self: Printer, x: T):
       print(x)

def print_ten(p: Printer[int]):
    p.print(10)

p: Printer[int] = None
p = Printer[int]()
print_ten(p)
```

10. Generic objects as fields. The following should print 10.
```python
T: TypeVar = TypeVar('T')

class Printer(Generic[T]):
   def print(self: Printer, x: T):
       print(x)

class IntPrinterWrapper(object):
    int_printer: Printer[int] = None
    def print_int(self: PrintIntWrapper, x: int):
        self.int_printer.print(x)

ip: IntPrinterWrapper = None
ip = IntPrinterWrapper()
ip.print_int(10)
```

11. Multiple TypeVars
```python
T: TypeVar = TypeVar('T')
U: TypeVar = TypeVar('U')

class Printer(Generic[T, U]):
   def print1(self: Printer, x: T):
       print(x)
   def print2(self: Printer, x: U):
       print(x)

p: Printer[int, bool] = None
p = Printer[int, bool]()
p.print1(10)
p.print2(False)
```

# Planned additions to the AST
We plan to add a new TypeVar type like so: 
```typescript
| {tag: "type-var", name: string }
```
We may potentially add other fields for features like constraints in future weeks.

We also plan to add two new fields to Class:
```typescript
supers: Array<string>, type_vars: Array<string>
```
So we know whether a class is inheriting `object` or `Generic` and what TypeVars `Generic[...]` has.
This also tracks with how the inheritance team is implementing multiple inheritance in the AST.

# Other additions to the codebase
We plan to add a new pass before the type checker to create new classes for each specific type a generic class is created with. By the end of this pass, there should not be anything in the AST of type 'TypeVar', but instead specific types like 'int', 'class', etc. In the future for function calls, we might manually call tcExpr on arguments to figure out what types a generic function is using.

# Milestone 2

For milestone 2, I plan to scale down things a bit since my partner dropped the class.

## Minor fixes
First, I want to fix a few bugs I forgot to test:
1. Support classes with multiple type vars (should work but there were some parsing bugs). As an example:
```python
T: TypeVar = TypeVar('T')
U: TypeVar = TypeVar('U')
def Box(Generic[T, U]):
    x: T = ()
    y: U = ()
b: Box[int, bool] = None
b = Box[int, bool]()
print(b.x)
print(b.y)
```
2. Monomorphize generic class constructor calls everywhere in code (before it was only in the global body). As an example:
```python
T: TypeVar = TypeVar('T')
def Box(Generic[T]):
    x: T = ()
def create_box() -> Box[int]:
    return Box[int]()
b: Box[int] = None
b = create_box()
print(b.x)
```

3. Error when a type var that was not in the class definition is used by a class. As an example:
```python
T: TypeVar = TypeVar('T')
U: TypeVar = TypeVar('U')
def Box(Generic[T]):
    val: U = ()
```

## Fields

I also plan to implement generic fields, which you can see being used in the above tests. I plan to add a special universal initializer syntax (like in c++ but a different syntax) to initialize both classes and primitives. The syntax will look like: 
```python
x: T = ()
```
It will initialize bools to False, ints to 0, and classes to None

Along with the above tests, here are a few tests I would like to pass for generic fields.
1. Simple generic field
```python
T: TypeVar = TypeVar('T')
def Box(Generic[T]):
    x: T = ()
b: Box[int] = None
b = Box[int]()
print(b.x)
```
Should print 0

2. Simple generic field, two specializations
```python
T: TypeVar = TypeVar('T')
def Box(Generic[T]):
    x: T = ()
b0: Box[int] = None
b0 = Box[int]()
print(b0.x)
b1: Box[bool] = None
b1 = Box[bool]()
print(b1.x)
```
Should print 0, False

3. Invalid specialization
```python
T: TypeVar = TypeVar('T')
def Box(Generic[T]):
    x: T = ()
def Thing(object):
    v: int = 0
b: Box[Thing] = None
b = Box[Thing]()
print(b.x)
```
Should error and print something like "cannot print object"

4. Invalid binop
```python
T: TypeVar = TypeVar('T')
class Adder(Generic[T]):
    x: T = 0
    y: T = 0
    def new(self: Adder[T], x: T, y: T) -> T:
        self.x = x
        self.y = y
    def add(self: Adder[T]) -> T:
       return self.x + self.y
a: Adder[int] = None
a = Adder[int]()
print(a.add(1, 2))
```
Should print 3.

5. Invalid binop
```python
T: TypeVar = TypeVar('T')
class Adder(Generic[T]):
    x: T = 0
    y: T = 0
    def new(self: Adder[T], x: T, y: T) -> T:
        self.x = x
        self.y = y
    def add(self: Adder[T]) -> T:
       return self.x + self.y
a: Adder[bool] = None
a = Adder[bool]()
print(a.add(True, False))
```
Should error and print something like "invalid type for binop +"

6. Invalid field assignment
```python
T: TypeVar = TypeVar('T')
def Box(Generic[T]):
    x: T = ()
b: Box[int] = None
b = Box[int]()
b.x = False
```
Should error something like "Cannot assign bool to int"

The previous tests testing generic objects as parameters and fields should of course also still work on top of these.

If there's time, I also might consider implementing generic functions.
