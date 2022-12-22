import { EventEmitter } from "events";
import { MetricDefinition } from "./definitions";
import { arraysEqual, getArrayAverage } from "./util/array";
import { clamp, lerp } from "./util/math";

export default class Metric extends EventEmitter {
  public index: number;
  public state: number[];
  public lerpedState: number[];
  public definition: MetricDefinition;

  private defaultState: number[];
  private lastUpdateTime: number;
  private lastChangeTime: number;
  private timeoutTimer?: NodeJS.Timer;

  constructor(definition: MetricDefinition) {
    super();

    this.defaultState = definition.defaultState || [0];
    this.definition = definition;
    this.reset();
  }

  public reset(shouldNotify?: boolean) {
    // We use the spread syntax here because otherwise javascript binds the objects
    // together, resulting in the defaultState being modified whenever state or
    // lerpedState is modified.
    this.state = [...this.defaultState];
    this.lerpedState = [...this.defaultState];
    this.lastUpdateTime = 0;
    this.lastChangeTime = 0;
    if (shouldNotify) this.notify();
  }
  
  public setState(newState: number[], force?: boolean) {
    // Sometimes null is returned from process functions in the definition file.
    // This happens when the data cannot be processed, so we just keep the current state.
    if (newState == null) return;

    const timeSinceLastUpdate = Date.now() - this.lastUpdateTime;
    const lerpAmount = clamp(timeSinceLastUpdate/2000, 0, 1);

    for (let i = 0; i < newState.length; i++) {
      if (this.definition.precision) {
        // Round the value to have 'precision' number of decimal places.

        // Note the plus sign drops any "extra" zeroes at the end (think "0 + foo").
        // It changes the result from a string into a number again, which means
        // that it uses only as many digits as necessary.

        // This method rounds incorrectly in some cases, but it should be accurate
        // enough for this use case. Later on, this could be replaced with a
        // dedicated rounding function to give more accuracy.
        newState[i] = +newState[i].toFixed(this.definition.precision);
      }
      
      if (this.definition.lerp) {
        this.lerpedState[i] = lerp(this.lerpedState[i], newState[i], lerpAmount);
      }
    }

    if (this.definition.timeout && !force) {
      if (this.timeoutTimer) {
        clearTimeout(this.timeoutTimer);
      }

      this.timeoutTimer = setTimeout(
        () => this.reset(true), 
        this.definition.timeout
      );
    }

    this.lastUpdateTime = Date.now();

    // Check if new state is different than the current state.
    const changed = !arraysEqual(this.state, newState);

    if (changed) {
      if (this.definition.cooldown && !force) {
        let timeSinceLastChange = Date.now() - this.lastChangeTime;
        if (timeSinceLastChange < this.definition.cooldown) return;
      }

      this.lastChangeTime = Date.now();
      this.state = newState;
      this.notify();
    }
  }

  private notify() {
    this.emit("changed", this.state);
  }

  get jsonData(): string {
    return JSON.stringify([this.index, this.state]);
  }
}

type MetricCallback = (metric: Metric) => void;