export type Payload<T> = {
  type: string
  event: string
  payload?: T
}
