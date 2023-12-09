export interface Payload<T> {
  type: string
  event: string
  payload?: T
}
