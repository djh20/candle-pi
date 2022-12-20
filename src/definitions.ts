import Metric from "./metric";
import Vehicle from "./vehicle";

/**
 * The structure of a vehicle definition file.
 */
export interface VehicleDefinition {
  //id?: string,
  name?: string,
  getStatus?: (metrics: Map<string, Metric>) => VehicleStatus,
  topics?: TopicDefinition[];
}

interface VehicleStatus {
  moving: boolean;
}

/**
 * Represents a specific CAN frame type with its id. This includes its  
 * measureable values (metrics).
 */
export interface TopicDefinition {
  id: number;
  name?: string;
  metrics?: MetricDefinition[];
}

export interface MetricDefinition {
  id: string,
  suffix?: string,
  defaultValues?: number[]

  /**
   * The minimum time in milliseconds allowed between setting the value of
   * the metric. This will therefore reduce the amount of messages being sent
   * through the websocket.
   * 
   * Be careful with this property as sometimes .setValue() will be completely
   * ignored. This property should only be used on metrics which are having
   * their value set very often.
   */
  cooldown?: number,

  timeout?: number;

  /**
   * The number of decimal places to round the metric value to.
   */
  precision?: number;

  /**
   * For metric definitions that derive their values from CAN messages.
   * This method takes in a CAN message buffer and returns the corresponding 
   * value.
   */
  process?: (data: Buffer, vehicle: Vehicle) => number[],

  onChange?: (values: number[], vehicle: Vehicle) => void,

  /**
   * If the metric should be logged to the console whenever its value changes.
   */
  log?: boolean,

  /**
   * The maximum number of history values that can be kept in memory simultaneously. 
   * This applies to each value in the metric individually. 
   * The default value is 0 (no history is kept).
   */
  maxHistory?: number

  //name: string,
  //convert?: (value: number) => Uint8Array | Uint16Array,
  //instance?: MetricInstance;
}


/**
 * This is for metric definitions that derive their values from CAN messages. This
 * version includes a 'process' method, which takes in the CAN message buffer
 * and returns the corresponding value.
 * 
 * This will only work with metrics that are defined in the vehicle definition
 * file, as the CAN message id is defined in the parent 'topic' object.
 */
/*
export interface MetricCanDefinition extends MetricDefinition {
  process: (buffer: Buffer) => number,
}
*/

/*
export interface Metric {
  id: string,
}

export interface CanMetric extends Metric {
  //name: string,
  //log?: boolean,
  suffix?: string,
  interval?: number,
  process?: (buffer: Buffer) => number,
  convert?: (value: number) => Uint8Array | Uint16Array,
  //instance?: MetricInstance;
}
*/

/*
export class MetricInstance {
  public value: number = 0;
  
  public setValue(value: number) {
    // Round to max of 2 decimal places.
    value = Math.round((value + Number.EPSILON) * 100) / 100;

    this.value = value;
  }
}
*/

export interface MetricState {
  value: number;
}