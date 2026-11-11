export class Ring<A> {
  private values: A[] = [];
  private next = 0;
  private readonly capacity: number;
  constructor(capacity: number) {
    this.capacity = capacity;
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error("Invalid capacity");
  }
  append(value: A) {
    this.values[this.next] = value;
    this.next = (this.next + 1) % this.capacity;
  }
  read(): A[] {
    return this.values.length < this.capacity
      ? [...this.values]
      : [...this.values.slice(this.next), ...this.values.slice(0, this.next)];
  }
}
