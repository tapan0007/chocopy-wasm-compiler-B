import { assertPrint, assertFail, assertTCFail, assertTC, assertSomeFail } from "./asserts.test";
import { NUM, BOOL, NONE, CLASS } from "./helpers.test"

describe("Generic tests", () => {
  // 1
  assertPrint("simple-one-generic", `T: TypeVar = TypeVar('T')

  class Printer(Generic[T]):
     def print(self: Printer[T], x: T):
         print(x)
  
  pInt: Printer[int] = None
  pInt = Printer[int]()
  pInt.print(10)`, [`10`]);

  assertPrint("simple-two-generic", `T: TypeVar = TypeVar('T')

  class Printer(Generic[T]):
     def print(self: Printer[T], x: T):
         print(x)
  
  pInt: Printer[int] = None
  pBool: Printer[bool] = None
  
  pInt = Printer[int]()
  pInt.print(10)
  
  pBool = Printer[bool]()
  pBool.print(True)`, [`10`, `True`]);

  assertSomeFail("invalid-specialization", `T: TypeVar = TypeVar('T')

  class Box(object):
      val: int = 10
  
  class Printer(Generic[T]):
     def print(self: Printer[T], x: T):
         print(x)
  
  p: Printer[Box] = None
  p = Printer[Box]()
  p.print(Box())`);

  assertTCFail("invalid-binop", `T: TypeVar = TypeVar('T')

  class Adder(Generic[T]):
     def add(self: Adder[T], x: T, y: T) -> T:
         return x + y
  
  a: Adder[int] = None
  a = Adder[int]()
  print(a.add(True, False))`);

  assertPrint("valid-binop", `T: TypeVar = TypeVar('T')

  class Adder(Generic[T]):
     def add(self: Adder[T], x: T, y: T) -> T:
         return x + y
  
  a: Adder[int] = None
  a = Adder[int]()
  print(a.add(4, 6))`, ['10']);

  assertTCFail("invalid param", `T: TypeVar = TypeVar('T')

  class Box(object):
      val: int = 10
    
  class Printer(Generic[T]):
     def print(self: Printer[T], x: T):
         print(x)
    
  p: Printer[int] = None
  p = Printer[int]()
  p.print(Box())`);

  assertTCFail("conflicting-global", `T: int = 0
  T: TypeVar = TypeVar('T')
  
  class Printer(Generic[T]):
     def print(self: Printer[T], x: T):
         print(x)
    
  p: Printer[int] = None
  p = Printer[int]()
  p.print(10)`);

  assertTCFail("conflicting-class", `T: TypeVar = TypeVar('T')
  class T(object):
    def __init__(self: T):
        pass

  class Printer(Generic[T]):
    def print(self: Printer[T], x: T):
        print(x)
   
   p: Printer[int] = None
   p = Printer[int]()
   p.print(10)`);

  assertPrint("generics-as-args", `
  T: TypeVar = TypeVar('T')
  
  class Printer(Generic[T]):
    def print(self: Printer[T], x: T):
        print(x)

  def print_ten(p: Printer[int]):
    p.print(10)
    
  p: Printer[int] = None
  p = Printer[int]()
  print_ten(p)`, ['10']);

  assertPrint("generics-as-fields", `
  T: TypeVar = TypeVar('T')
  
  class IntPrinterWrapper(object):
    intPrinter: Printer[int] = None

    def print_int(self: IntPrinterWrapper, x: int):
        self.intPrinter.print(x)

  class Printer(Generic[T]):
    def print(self: Printer[T], x: T):
        print(x)
    
  ip: IntPrinterWrapper = None
  ip = IntPrinterWrapper()
  ip.intPrinter = Printer[int]()
  ip.print_int(10)`, ['10']);

  // ----- Milestone 2 tests ----- //

  assertPrint("simple-generic-field", `
  T: TypeVar = TypeVar('T')

  class Box(Generic[T]):
      x: T = {}

  b: Box[int] = None
  b = Box[int]()
  print(b.x)`, ['0']);

  assertPrint("two-generic-field-specializations", `
  T: TypeVar = TypeVar('T')
  class Box(Generic[T]):
      x: T = {}

  b0: Box[int] = None
  b1: Box[bool] = None
  b0 = Box[int]()
  print(b0.x)

  b1 = Box[bool]()
  print(b1.x)`, ['0', 'False']);

  assertSomeFail("invalid-field-specialization", `
  T: TypeVar = TypeVar('T')

  class Box(Generic[T]):
      x: T = {}

  class Thing(object):
      v: int = 0

  b: Box[Thing] = None
  b = Box[Thing]()
  print(b.x)`);

  assertPrint("valid-field-binop", `
  T: TypeVar = TypeVar('T')

  class Adder(Generic[T]):
      x: T = {}
      y: T = {}
      def new(self: Adder[T], x: T, y: T) -> Adder[T]:
          self.x = x
          self.y = y
          return self

      def add(self: Adder[T]) -> T:
        return self.x + self.y

  a: Adder[int] = None
  a = Adder[int]()
  a = a.new(1, 2)
  print(a.add())`, ['3']);

  assertTCFail("invalid-field-binop", `
  T: TypeVar = TypeVar('T')

  class Adder(Generic[T]):
      x: T = {}
      y: T = {}
      def new(self: Adder[T], x: T, y: T) -> Adder[T]:
          self.x = x
          self.y = y
          return self

      def add(self: Adder[T]) -> T:
        return self.x + self.y

  a: Adder[bool] = None
  a = Adder[bool]()
  a = a.new(False, True)
  print(a.add())`);

  assertTCFail("invalid-field-assign", `
  T: TypeVar = TypeVar('T')
  class Box(Generic[T]):
      x: T = {}

  b: Box[int] = None
  b = Box[int]()
  b.x = False`);

  assertPrint("two-typevars", `
  T: TypeVar = TypeVar('T')
  U: TypeVar = TypeVar('U')
  class Box(Generic[T, U]):
      x: T = {}
      y: U = {}

  b: Box[int,bool] = None
  b = Box[int,bool]()
  print(b.x)
  print(b.y)`, ['0', 'False']);

  assertPrint("ctor-in-function", `
  T: TypeVar = TypeVar('T')
  class Box(Generic[T]):
      x: T = {}

  def create_box() -> Box[int]:
      return Box[int]()

  b: Box[int] = None
  b = create_box()
  print(b.x)`, ['0']);

  assertTCFail("invalid-typevar-in-class", `
  T: TypeVar = TypeVar('T')
  U: TypeVar = TypeVar('U')
  class Box(Generic[T]):
      val: U = {}
      
  x: Box[int] = None
  x.val = 0`);

  assertPrint("lists-as-generics", `
  T: TypeVar = TypeVar('T')

  class Box(Generic[T]):
    x: T = {}

  b: Box[[int]] = None
  b = Box[[int]]()
  b.x = [0, 1, 2]
  print(b.x[1])
  `, ["1"]);

});
