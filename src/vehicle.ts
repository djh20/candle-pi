import * as socketcan from "socketcan";
import { EventEmitter } from "events";
import { VehicleDefinition } from "./definitions";
import Metric from "./metric";
import logger from "./util/logger";
import Application from "./application";
import GpsManager from "./gps";
import TripManager from "./trip";

export default class Vehicle extends EventEmitter {
  public app: Application;
  public definition: VehicleDefinition;
  public metrics: Map<string, Metric>;
  public tripManager: TripManager;
  
  // Socketcan doesn't have type definitions so we set channel to 'any' type.
  // Probably could automatically generate the .d.ts file, but idk how :(
  private channel: any;

  private gpsManager?: GpsManager;

  constructor(app: Application) {
    super();
    this.app = app;
    this.metrics = new Map<string, Metric>();
    this.tripManager = new TripManager();
  }

  public connect(channel: string) {
    try {
      // Connect to the CAN interface.
      this.channel = socketcan.createRawChannel(channel, false, null);
      logger.info("can", `Connected to ${channel}`);
    } catch (err) {
      logger.warn("can", `Failed to connect to ${channel}`);
    }
    
    if (this.channel) {
      // Start listening for CAN frames.
      this.channel.addListener("onMessage", (frame) => this.onMessage(frame));
      this.channel.start();
      /*
      setInterval(() => {
        console.log();
        this.metrics.forEach((metric, id) => {
          if (metric.definition.log) console.log(`${id}: ${metric.value}`);
        });
      }, 1000);
      */
    }
  }

  public registerMetric(metric: Metric) {
    metric.index = this.metrics.size;
    this.metrics.set(metric.definition.id, metric);

    // Listen for whenever the metric value changes.
    metric.on("changed", (values: number[]) => {
      if (metric.definition.log) {
        logger.info("vehicle", `${metric.definition.id}: ${values}`)
      }
      
      if (metric.definition.onChange && !this.tripManager.playing) {
        metric.definition.onChange(values, this);
      }
      
      this.tripManager.addEntry(metric);

      // Send metric data through websocket.
      this.emit("data", "metrics", metric.jsonData);
    });

    logger.info("vehicle", `Registered metric: ${metric.definition.id}`)
  }

  private onMessage(frame: CanFrame) {
    const topicDef = this.definition.topics.find(t => t.id == frame.id);
    if (!topicDef) return;

    topicDef.metrics.forEach(metricDef => {
      const metric = this.metrics.get(metricDef.id);
      metric.update(metricDef.process(frame.data, this, metric.values));
      //logger.info("can", `${metricDef.id}: ${metric.value}`);
      //metric.instance.setValue( metric.process(frame.data) );
    });
  }

  /**
   * Sets the definition for the vehicle and assigns a new instance for
   * each metric.
   * @param definition The vehicle definition to use.
   */
  public async loadDefinition(definition: VehicleDefinition) {
    // Assign a metric instance to each metric. This instance stores the
    // current value and handles changing it.
    // This also means that the definition can be reloaded by just assigning
    // new instances, as no other values are modified.

    logger.info("vehicle", `Loading definition: ${definition.name} ...`);
    
    this.metrics.clear();

    for (const topicDef of definition.topics) {
      for (const metricDef of topicDef.metrics) {
        this.registerMetric( new Metric(metricDef) );
      }
    }

    if (this.app.config.gps && this.app.config.gps.enabled) {
      this.gpsManager = new GpsManager();
      
      const lockedMetric = new Metric({id: "gps_locked"});
      const distanceMetric = new Metric({id: "gps_trip_distance"});
      const positionMetric = new Metric({
        id: "gps_position",
        defaultValues: [0, 0]
      });

      this.registerMetric(lockedMetric);
      this.registerMetric(distanceMetric);
      this.registerMetric(positionMetric);

      let connected = await this.gpsManager.connect(this.app.config.gps.port);
      if (connected) {
        this.gpsManager.on("lock", (locked: boolean) => {
          lockedMetric.update([locked ? 1 : 0]);
        });

        this.gpsManager.on("move", (lat: number, lng: number, distance: number) => {
          const status = this.definition.getStatus(this.metrics);
          if (status.moving) {
            const totalDistance: number = distanceMetric.values[0] + distance;
            distanceMetric.update([totalDistance]);
          }
          positionMetric.update([lat, lng]);
        });

        this.gpsManager.listen();
      }
    }
    
    this.definition = definition;
  }
}

type CanFrame = {
  id: number,
  data: Buffer
}