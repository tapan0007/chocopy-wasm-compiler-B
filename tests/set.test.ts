import { assertPrint, assertTCFail, assertTC, assertFail } from "./asserts.test";
import { NUM, BOOL, NONE, CLASS } from "./helpers.test"

describe("set-functionalities", () => {

    assertPrint("initialize-set", `
    set_1 : set[int] = None
    set_1 = {1,2}
    print(set_1)`, ["1", "2"]);

    assertPrint("set-add", `
    set_1 : set[int] = None
    set_1 = {1,2}
    set_1.add(3)
    print(set_1)`, ["1", "2", "3"]);

    assertPrint("set-add-in", `
    set_1 : set[int] = None
    set_1 = {1,2,11}
    set_1.add(3)
    print(11 in set_1)`, [`True`]);

    assertPrint("set-add-not-in", `
    set_1 : set[int] = None
    set_1 = {1,2}
    set_1.add(3)
    print(4 in set_1)`, [`False`]);

    assertPrint("set-add-duplicate", `
    set_1 : set[int] = None
    set_1 = {1,2}
    set_1.add(1)
    print(set_1)`, ["1", "2"]);

    assertPrint("set-remove", `
    set_1 : set[int] = None
    set_1 = {1,2}
    set_1.remove(1)
    print(set_1)`, ["2"]);

    assertPrint("set-remove-in", `
    set_1 : set[int] = None
    set_1 = {1,2}
    set_1.remove(1)
    print(1 in set_1)`, [`False`]);

    assertPrint("set-constructor", `
    set_1: set[int] = None
    set_1 = set({1, 2})
    print(set_1)`, ["1", "2"])

    assertPrint("set-update-len", `
    set_1: set[int] = None
    set_1 = set({1, 2})
    set_1.update({3, 4})
    print(set_1.length())`, [`4`])

    assertPrint("set-update", `
    set_1: set[int] = None
    set_1 = set({1, 2})
    set_1.update({3, 4})
    print(set_1)`, ["1", "2", "3", "4"])

    assertPrint("set-update", `
    set_1: set[int] = None
    set_1 = set([1, 2, 2])
    set_1.update([4,3,4])
    print(set_1)`, ["1", "2", "3", "4"])

    assertPrint("set-firstItem", `
    set_1: set[int] = None
    set_1 = set([3,2,11, 1])
    set_1.update([10, 0, 0])
    print(set_1.firstItem() )
    `, ["10"])

    assertPrint("set-firstItem-after-bucketRemove", `
    set_1: set[int] = None
    set_1 = set([3, 1, 2])
    set_1.remove(1)
    print(set_1.firstItem() )
    `, ["2"])

    assertPrint("set-firstItem-after-itemRemove", `
    set_1: set[int] = None
    set_1 = set([1,11,22,2])
    set_1.remove(1)
    print(set_1.firstItem() )
    `, ["11"])

    assertPrint("set-hasnext", `
    set_1: set[int] = None
    set_1 = set([3,2,1, 22])
    print(set_1.hasnext(22) )
    `, [`True`])

    assertPrint("set-multiple-items-1bucket", `
    set_1: set[int] = None
    set_1 = set([3,33,2,1, 22])
    print(set_1)
    `, ["1", "2", "22", "3", "33"])

    assertPrint("set-multiple-items-remove", `
    set_1: set[int] = None
    set_1 = set([3,33,2,1])
    set_1.remove(33)
    print(set_1)
    `, ["1", "2", "3"])

    assertPrint("set-hasnext-after-remove", `
    set_1: set[int] = None
    set_1 = set([3,33,2,1])
    set_1.remove(33)
    print(set_1.hasnext(3) )
    `, [`False`])

    // 3rd bucket: 3->33->13 ==> 3->13
    assertPrint("set-hasnext-after-remove", `
    set_1: set[int] = None
    set_1 = set([3,33,2,1, 13])
    set_1.remove(33)
    print(set_1.hasnext(3) )
    `, [`True`])

    assertPrint("set-next", `
    set_1: set[int] = None
    set_1 = set([3,33,2,1, 13])
    print(set_1.next(33) )
    `, ["13"])

    assertPrint("set-next-nextBucket", `
    set_1: set[int] = None
    set_1 = set([3,33,2,1, 13])
    set_1.remove(3)
    print(set_1.next(2) )
    `, ["33"])

    assertPrint("set-next-nextBucket", `
    set_1: set[int] = None
    set_1 = set([3,33,2,1, 11])
    set_1.remove(11)
    print(set_1.next(1) )
    `, ["2"])

    assertPrint("set-next-nextBucket-after-bucketRemove", `
    set_1: set[int] = None
    set_1 = set([3,33,2,1, 13])
    set_1.remove(2)
    set_1.remove(3)
    print(set_1.next(1) )
    `, ["33"])
});
