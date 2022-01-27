import { EventEmitter } from "events";
import { MetricDefinition } from "./definitions";

export default class Metric extends EventEmitter {
  public index: number;
  public value: number;
  public definition: MetricDefinition;

  private lastChangeTime: number;

  constructor(definition: MetricDefinition) {
    super();
    this.definition = definition;
    this.value = 0;
    this.lastChangeTime = 0;
  }
  
  public setValue(value: number) {
    // Sometimes null is returned from process functions in the definition file.
    // This happens when the data cannot be processed, so we should just ignore
    // the value (which keeps the previous state).
    if (value == null) return;

    if (this.definition.precision) {
      // Round the value to have 'precision' number of decimal places.

      // Note the plus sign drops any "extra" zeroes at the end (think "0 + foo").
      // It changes the result from a string into a number again, which means
      // that it uses only as many digits as necessary.

      // This method rounds incorrectly in some cases, but it should be accurate
      // enough for this use case. Later on, this could be replaced with a
      // dedicated rounding function to give more accuracy.
      value = +value.toFixed(this.definition.precision);
    }

    // Check if value has changed since it was last set.
    if (value != this.value) {
      if (this.definition.cooldown) {
        let timeSinceLastChange = Date.now() - this.lastChangeTime;
        if (timeSinceLastChange < this.definition.cooldown) return;
      }
      
      this.value = value;
      this.lastChangeTime = Date.now();
      this.emit("changed", value);
    }
  }

  get data(): string {
    return JSON.stringify([this.index, this.value]);
  }
}

type MetricCallback = (metric: Metric) => void;