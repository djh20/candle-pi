import * as socketcan from "socketcan";
import { EventEmitter } from "events";
import { VehicleDefinition } from "./definitions";
import Metric from "./metric";
import logger from "./util/logger";
import Application from "./application";
import GpsManager from "./gps";

export default class Vehicle extends EventEmitter {
  public definition: VehicleDefinition;
  public metrics: Map<string, Metric>;
  
  // Socketcan doesn't have type definitions so we set channel to 'any' type.
  // Probably could automatically generate the .d.ts file, but idk how :(
  private channel: any;

  private app: Application;
  private gpsManager?: GpsManager;

  constructor(app: Application) {
    super();
    this.app = app;
    this.metrics = new Map<string, Metric>();
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
    metric.on("changed", (value) => {
      if (metric.definition.log) {
        logger.info("vehicle", `${metric.definition.id}: ${value}`)
      }

      // Send metric data through websocket.
      this.emit("data", metric.data);
    });

    logger.info("vehicle", `Registered metric: ${metric.definition.id}`)
  }

  private onMessage(frame: CanFrame) {
    const topicDef = this.definition.topics.find(t => t.id == frame.id);
    if (!topicDef) return;

    topicDef.metrics.forEach(metricDef => {
      const metric = this.metrics.get(metricDef.id);
      metric.setValue( metricDef.process(frame.data, this.metrics) );
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
      
      const lockedMetric = new Metric({id:"gps_locked"});
      const distanceMetric = new Metric({id:"gps_trip_distance"});
      //const latMetric = new Metric({id:"gps_lat"});
      //const lonMetric = new Metric({id:"gps_lon"});

      let connected = await this.gpsManager.connect(this.app.config.gps.port);
      if (connected) {
        this.gpsManager.on("lock", (locked: boolean) => {
          lockedMetric.setValue(locked ? 1 : 0);
        });

        this.gpsManager.on("move", (lat, lon, deltaDistance) => {
          const info = this.definition.getInfo(this.metrics);
          if (info.moving) {
            distanceMetric.setValue(distanceMetric.value + deltaDistance);
          }
        });

        this.gpsManager.listen();
      }
    }

    /*
    // Example of registering extra metrics.
    const gpsLock = new Metric({id:"gps_lock"});
    this.registerMetric(gpsLock);
    //gpsLock.setValue(1);
    this.registerMetric( new Metric({id:"gps_trip_distance"}) );
    this.registerMetric( new Metric({id:"gps_lat"}) );
    this.registerMetric( new Metric({id:"gps_lon"}) );
    */
    
    this.definition = definition;
  }
}

type CanFrame = {
  id: number,
  data: Buffer
}