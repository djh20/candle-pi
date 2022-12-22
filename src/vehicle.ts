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

    // Listen for whenever the metric's state changes.
    metric.on("changed", (state: number[]) => {
      if (metric.definition.log) {
        logger.info("vehicle", `${metric.definition.id}: ${state}`)
      }
      
      if (!this.tripManager.playing) {
        if (metric.definition.onChange) {
          metric.definition.onChange(state, this);
        }

        for (let otherMetric of this.metrics.values()) {
          let dependencies = otherMetric.definition.dependencies;
  
          if (!dependencies) continue;
          if (!dependencies.includes(metric.definition.id)) continue;
  
          otherMetric.setState(
            otherMetric.definition.process(null, this, otherMetric.state)
          );
        }
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
      if (metricDef.process) {
        metric.setState(metricDef.process(frame.data, this, metric.state));
      }
    });
  }

  /**
   * Sets the definition for the vehicle and registers each metric.
   * @param definition The vehicle definition to use.
   */
  public async loadDefinition(definition: VehicleDefinition) {
    logger.info("vehicle", `Loading definition: ${definition.name} ...`);
    
    this.metrics.clear();

    for (const topicDef of definition.topics) {
      for (const metricDef of topicDef.metrics) {
        this.registerMetric( new Metric(metricDef) );
      }
    }
    
    if (definition.extraMetrics) {
      for (const metricDef of definition.extraMetrics) {
        this.registerMetric( new Metric(metricDef) );
      }
    }

    if (this.app.config.gps && this.app.config.gps.enabled) {
      this.gpsManager = new GpsManager();
      
      const lockedMetric = new Metric({id: "gps_locked"});
      const distanceMetric = new Metric({id: "gps_distance"});
      const positionMetric = new Metric({
        id: "gps_position",
        defaultState: [0, 0],
        precision: 6
      });

      this.registerMetric(lockedMetric);
      this.registerMetric(distanceMetric);
      this.registerMetric(positionMetric);

      let connected = await this.gpsManager.connect(this.app.config.gps.port);
      if (connected) {
        this.gpsManager.on("lock", (locked: boolean) => {
          lockedMetric.setState([locked ? 1 : 0]);
        });

        this.gpsManager.on("move", (lat: number, lng: number, distance: number) => {
          const status = this.definition.getStatus(this.metrics);
          if (status.moving) {
            const totalDistance: number = distanceMetric.state[0] + distance;
            distanceMetric.setState([totalDistance]);
          }
          positionMetric.setState([lat, lng]);
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