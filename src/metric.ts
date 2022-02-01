import { EventEmitter } from "events";
import { MetricDefinition } from "./definitions";
import { arraysEqual } from "./util/array";

export default class Metric extends EventEmitter {
  public index: number;
  public values: number[];
  public definition: MetricDefinition;

  private defaultValues: number[];
  private lastChangeTime: number;
  private timeoutTimer?: NodeJS.Timer;

  constructor(definition: MetricDefinition) {
    super();

    this.defaultValues = definition.defaultValues || [0];
    this.definition = definition;
    this.reset();
  }

  public reset() {
    this.values = this.defaultValues;
    this.lastChangeTime = 0;
    this.notify();
  }
  
  public update(values: number[], ignoreCooldown?: boolean) {
    // Sometimes null is returned from process functions in the definition file.
    // This happens when the data cannot be processed, so we should just ignore
    // the value (which keeps the previous state).
    if (values == null) return;

    if (this.definition.precision) {
      // Round the value to have 'precision' number of decimal places.

      // Note the plus sign drops any "extra" zeroes at the end (think "0 + foo").
      // It changes the result from a string into a number again, which means
      // that it uses only as many digits as necessary.

      // This method rounds incorrectly in some cases, but it should be accurate
      // enough for this use case. Later on, this could be replaced with a
      // dedicated rounding function to give more accuracy.
      for (let i = 0; i < values.length; i++) {
        values[i] = +values[i].toFixed(this.definition.precision);
      }
    }

    if (this.definition.timeout) {
      if (this.timeoutTimer) {
        clearTimeout(this.timeoutTimer);
      }

      this.timeoutTimer = setTimeout(
        () => this.reset(), 
        this.definition.timeout
      );
    }

    // Check if value has changed since it was last set.
    const changed = !arraysEqual(this.values, values);

    if (changed) {
      if (this.definition.cooldown && !ignoreCooldown) {
        let timeSinceLastChange = Date.now() - this.lastChangeTime;
        if (timeSinceLastChange < this.definition.cooldown) return;
      }

      this.lastChangeTime = Date.now();
      this.values = values;
      this.notify();
    }
  }

  private notify() {
    this.emit("changed", this.values);
  }

  get jsonData(): string {
    return JSON.stringify([this.index, this.values]);
  }
}

type MetricCallback = (metric: Metric) => void;