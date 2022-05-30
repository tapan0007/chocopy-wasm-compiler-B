# Week 6 updating

## 10 Test Cases

Sadly, all we can do right now are simply math functions. Other builtin functions, like reduce, map and filter, are related to the implmentation of iterable Object, Generics and polymorphism. So maybe we will write these high level functions later.

### Factorial

input: 
c : int = 4
print(factorial(c))
Output: 
24

### Max

input: 
c : int = 3
d: int = 2
print(max(factorial(c), factorial(d)))
Output: 
6

### Pow

input: 
c : int = 3
d: int = 2
print(pow(c, d))
Output: 
9

### Randint

input: 
a : int = 0
b : int = 5
print(randint(a,b))
Output: 
A random integer between 0 and 5

### Randrange

input: 
a : int = 0
b: int = 101
print(randrange(0, 101, 2))
Output: 
A random even integer from 0 to 100

### Time

input: 
print(time())
Output: 
1436428326(the current time stamp)

### LCM (least common multiple)

input: 
1
Output: 
12
15
8

### GCD (greatest common divisor)

input: 
print(gcd(4,6))
print(gcd(3,5))
print(gcd(2,8))
Output: 
2
1
2

### Combination

input: 
print(comb(4,2))
print(comb(10,3))
print(comb(20,5))
Output: 
6
120
15504

### Perm

input: 
print(perm(4,2))
print(perm(10,3))
print(perm(20,5))
Output: 
12
720
1860480

## AST/IR changes to make

Since we will have to high-level functions, we suggest to add another basic type function like below in ast.ts

Type = 

​	|... 

​	| {

​		tag: "function",

​		params: Type[],

​		ret: Type,

​	}

## New functions and datatypes

Adding the function type to our compiler would help our team to build high-level functions like map and reduce.

Also we would like to add some import functions as we mentioned in the first section.

factorial :: int -> int

pow :: int -> int -> int

randint :: int -> int -> int

randrange :: int -> int -> int -> int

time :: () -> int

lcm :: int -> int -> int

gcd :: int -> int -> int

comb :: int -> int -> int

perm :: int -> int -> int

## Value representation and memory layout

we think a better way to represent functions is to place them all, including methods and functions, into the v table. And a function     is just a int32 variable in wasm indicating the its index in vtable. In this way, we can treat functions just like any other variables, so we can write high-level functions like map and reduce.

A rough thinking is to do this step in lower.ts/lowerFunDef. When we define a function, we actually do the following thing

from 

def f(x:int)->int

​	xxx

to 

1. Add a new function to vtable, the name can be like this $$function{# of function index} so it won't affect the user name space
2. assign f, which is of type {tag:"function", params: [int], ret: int}, with the function index in vtable.

$$FunDef { name = $$function{index of function}, ...}

f = Value{ tag:"number", value = {index of function}}





# Week 7 updating



## What we did in week 7

- We added 10 functions, including factorial, randint, randrange, gcd, lcm, perm, time, sleep, int, bool, into the builtin library.

- We refactored the way adding builtin functions. We add a file builtinlib.ts which is used to store built-in functions. Now we don't need to write code everywhere to add a builtin function. Just adding several lines in builtinlib.ts would work.

- We delete builtin1 and builtin2 in ast.ts and ir.ts. Now all function calls go through the {tag:call} logic. The reason behind this is that we will have some built-in functions that have more than 2 parameters, so builtin1 and builtin2 are not suitable and scalable now.

- We rewrite the print function. Now it can take multiple inputs and prints them!

- We have add some auto tests.

## Some examples

<img src="/Users/lisu/Library/Application Support/typora-user-images/image-20220513144346745.png" alt="image-20220513144346745" style="zoom:50%;" />



<img src="/Users/lisu/Library/Application Support/typora-user-images/image-20220513144536363.png" alt="image-20220513144536363" style="zoom:50%;" />

<img src="/Users/lisu/Library/Application Support/typora-user-images/image-20220513144627281.png" alt="image-20220513144627281" style="zoom:50%;" />

<img src="/Users/lisu/Library/Application Support/typora-user-images/image-20220513144730806.png" alt="image-20220513144730806" style="zoom:50%;" />

## What we plan to do next week

Since lists and strings and all kinds of builtin Classes (e.g. Function) are not implemented in week7, and will be implemented in week 8, We plan to write some builtin Functions about them. For example

len([1,2,3,4,5]) => 5

[1,2,3] + [4,5,6] => [1,2,3,4,5,6]

print([1,2,3])=> "[1,2,3]"

Also, we can do have some system calls.

create("file.txt") # create file.txt

fd = open("file.txt") # open file.txt

read(fd, 10) # read 10 bytes from file.txt

write(fd, "23213") # write 23213 to file.txt

close(fd) # close file.txt

delete("file.txt") # delete file.txt

create("file.txt")

