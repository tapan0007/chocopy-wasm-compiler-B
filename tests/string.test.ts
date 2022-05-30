import { assertPrint, assertFail, assertTCFail, assertTC } from "./asserts.test";
import { NUM, BOOL, NONE, CLASS } from "./helpers.test"

describe("string test", () => {
  // 1
  assertTC("test case 1: var definition for string", `s:str = "asdf"\ns`, CLASS("str"));
  // 2
  assertPrint("test case 2: print string", `s:str = "asdf"\nprint(s)`, [`asdf`]);
  //2.5
  assertPrint("test case 2.5: print string", `print("asdf")`, [`asdf`]);
  // 3
  assertPrint(
    "test case 3: index accessing",
    `
    s:str = "asdf"
    print(s[1])`,
    ["s"]
  );

  // 4
  assertFail(
    "test case 4: index out of range error, should be a runtime error",
    `s:str = "asdf"
      print(s[5])`
  )
  // 5
  assertPrint(
    "test case 5: get the length of string",
    `s:str = "asdf"
      print(len(s))`,
    ["4"]
  )
  // 6
  assertTCFail(
    "test case 6: immutable",
    `s:str = "asdf"
      s[1] = "p"`
  )

  //7
  assertPrint("test case 7: compare two strings using their ascii values",
    `s1:str = "ab"
  s2:str = "abc"
  print(s1 < s2)`, [`True`])
  //7.5
  assertPrint("test case 7.5: compare two strings using their ascii values",
    `print("abcd" < "abc")`, [`False`])
  //7.6
  assertPrint("test case 7.6: compare two strings using their ascii values",
    `print("abcd" > "abc")`, [`True`])
  //8
  assertPrint("test case 8: check if two strings are equal",
    `s1:str = "ab"
  s2:str = "abc"
  print(s1 == s2)`, [`False`])
  //8.5
  assertPrint("test case 8.5: check if two strings are equal",
    `s1:str = "abc"
  s2:str = "abc"
  print(s1 == s2)`, [`True`])
  //9
  assertPrint("test case 9: concat two strings",
    `s1:str = "abc"
  s2:str = "def"
  print(s1+s2)`, [`abcdef`])

  //10
  assertTCFail("test case 10: should report type error ", `s:int = "asd"`);

  //11
  assertPrint("test case 11: use string as function parameters",
    `def f(s:str)->str:
    return s
  print(f("asd"))`,
    [`asd`]);

  //12
  assertPrint("test case 12: use string as class fields",
    `class C(object):
    s:str = "asd"
    def gets(self: C)->str:
      return self.s
  c:C = None
  c = C()
  print(c.gets())`, [`asd`]);

  //13 index access + compare
  assertPrint("test case 13: index access + compare",
    `s1:str = "abcd"
  s2:str = "bcde"
  print(s1[3]==s2[3])`, [`False`]);

  assertPrint("test case 13.5: index access + compare",
    `s1:str = "abcd"
  s2:str = "bcde"
  print(s1[3]==s2[2])`, [`True`]);

  //14 index access with funciton parameter
  assertPrint("test case 14: index access with funciton parameter",
    `def f(s:str, i:int)->str:
    return s[i]
  print(f("asd", 2))`,
    [`d`]);

  assertFail("test case 14.5: index access out of range with funciton parameter",
    `
  def f(s:str, i:int)->str:
    return s[i]
  f("asd", 3)`);

  //15 index access with method parameter
  assertPrint("test case 15: index access with method parameter",
    `
  class C(object):
    s:str = "asd"
    def gets(self: C, i:int)->str:
      return self.s[i]
  c:C = None
  c = C()
  print(c.gets(1))`, [`s`]);

  assertFail("test case 15.5: index access out of range with method parameter",
    `
  class C(object):
    s:str = "asd"
    def gets(self: C, i:int)->str:
      return self.s[i]
  c:C = None
  c = C()
  print(c.gets(10))`);

  //16 index access with function parameter + compare
  assertPrint("test case 16: index access with function parameter + compare",
    `
  def f(s:str, i:int, t:str, j:int)->bool:
    return s[i] > t[j]
  print(f("asd", 1, "fgh", 1))`,
    [`True`]);

  assertPrint("test case 16.5: index access with function parameter + compare",
    `
  def f(s:str, i:int, t:str, j:int)->bool:
    return s[i] > t[j]
  print(f("asd", 2, "fgh", 1))`,
    [`False`]);

  //17 index access with method parameter + compare
  assertPrint("test case 17: index access with method parameter + compare",
    `
  class C(object):
    def greater(self: C, s1: str, i: int, s2: str, j: int) -> bool:
      return s1[i] > s2[j]
  
  c: C = None
  c = C()
  print(c.greater("asd", 1, "fgh", 1))`,
    [`True`]);

  //17.5 index access with method parameter + compare
  assertPrint("test case 17.5: index access with method parameter + compare",
    `
  class C(object):
    def greater(self: C, s1: str, i: int, s2: str, j: int) -> bool:
      return s1[i] > s2[j]
  
  c: C = None
  c = C()
  print(c.greater("asd", 2, "fgh", 1))`,
    [`False`]);

  //18 index access with class member as index
  assertPrint("test case 18: index access with class member as index",
    `
  class C(object):
    i: int = 0
    def setIndex(self: C, x: int) -> None:
      self.i = x
      return None
    def StrIndexValue(self: C, s: str) -> None:
      print(s[self.i])
      return None
  
  c: C = None
  c = C()
  c.setIndex(0)
  c.StrIndexValue("asd")`,
    [`a`]);

  //18.5 index access with class member as index
  assertFail("test case 18.5: index access with class member as index",
    `
  class C(object):
    i: int = 0
    def setIndex(self: C, i: int) -> None:
      self.i = i
      return
    def StrIndexValue(self: C, s1: str) -> None:
      print(s1[self.i])
      return
  
  c: C = None
  c = C()
  c.setIndex(3)
  c.StrIndexValue("asd")`);

  //19 index access with class member as index + compare
  assertPrint("test case 19: index access with class member as index + compare",
    `
  class C(object):
    i: int = 0
    j: int = 0
    def setIndices(self: C, i: int, j: int):
      self.i = i
      self.j = j
      return
    def greater(self: C, s1: str, s2: str) -> bool:
      return s1[self.i] > s2[self.j]
  
  c: C = None
  c = C()
  c.setIndices(0, 0)
  print(c.greater("asd", "fgh"))`,
    [`False`]);

  //19.5 index access with class member as index + compare
  assertPrint("test case 19.5: index access with class member as index + compare",
    `
  class C(object):
    i: int = 0
    j: int = 0
    def setIndices(self: C, i: int, j: int):
      self.i = i
      self.j = j
      return
    def greater(self: C, s1: str, s2: str) -> bool:
      return s1[self.i] > s2[self.j]
  
  c: C = None
  c = C()
  c.setIndices(1, 0)
  print(c.greater("asd", "fgh"))`,
    [`True`]);

  //20  compare + index access + concat
  assertPrint("test case 20: compare + index access + concat",
    `
  class C(object):
    i: int = 0
    j: int = 0
    def setIndices(self: C, i: int, j: int):
      self.i = i
      self.j = j
      return
    def greater(self: C, s1: str, s2: str) -> str:
      if s1[self.i] > s2[self.j]:
        return s1+s2
      else:
        return s1
  
  c: C = None
  c = C()
  c.setIndices(0, 0)
  print(c.greater("asd", "fgh"))`,
    [`asd`]);

  //20.5  compare + index access + concat
  assertPrint("test case 20.5: compare + index access + concat",
    `
  class C(object):
    i: int = 0
    j: int = 0
    def setIndices(self: C, i: int, j: int):
      self.i = i
      self.j = j
      return
    def greater(self: C, s1: str, s2: str) -> str:
      if s1[self.i] > s2[self.j]:
        return s1+s2
      else:
        return s1
  
  c: C = None
  c = C()
  c.setIndices(1, 0)
  print(c.greater("asd", "fgh"))`,
    [`asdfgh`]);

});




