import {BehaviorSubject} from 'rxjs'

export function ngBehaviorSubject<T> (initValue: T, afflix: string = '$'): any {
  return function (target: any, propKey: string | symbol): void {

    const name: string = propKey.toString()
    const selectId = `__obs_${name}__`
    const name$ = `${name}${afflix}`
    const behaviorSub: BehaviorSubject<T> = new BehaviorSubject(initValue)

    target[selectId] = initValue
    let val: T = initValue

    /**
     * todo 考虑继承是否有问题
     */

    Object.defineProperties(target, {
      [name]: {
        enumerable: true,
        configurable: true,
        get (): T {
          return val
        },
        set (value: T): void {
          val = value
          target[name$].next(value)
        }
      },

      [name$]: {
        enumerable: false,
        configurable: true,
        get (): BehaviorSubject<T> {
          return behaviorSub
        }
      }
    })

  }
}