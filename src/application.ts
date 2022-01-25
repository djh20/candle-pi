import * as path from "path";
import express from 'express';
import { Server as HttpServer } from "http";
import { WebSocketServer } from "ws";
//import { promises as fs } from "fs";

import { VehicleDefinition } from "./definitions";
import Vehicle from "./vehicle";
import logger from "./util/logger";

export default class Application {
  public httpServer: HttpServer;
  public wsServer: WebSocketServer;
  public expressApp: express.Application;
  public vehicle: Vehicle;
  public config: Config;
  public paths: Paths;

  constructor(config: Config) {
    this.config = config;
    
    this.paths = {
      root: path.resolve(__dirname, "../"),
      definitions: path.resolve(__dirname, "../definitions"),
    };

    // Todo: Implement express for api.
    this.expressApp = express();
    this.httpServer = new HttpServer(this.expressApp);
    this.wsServer = new WebSocketServer({server: this.httpServer, path: "/ws"})
    this.vehicle = new Vehicle();
  }

  /**
   * Loads the definition file for the vehicle and starts the web server.
   */
  public start() {
    // Resolve path to definition file set in config.
    const definitionPath = 
      path.resolve(this.paths.definitions, this.config.definition + ".js");
    
    // Load the definition file using require and assign its id because that's
    // not included by default in the file itself.
    const definition: VehicleDefinition = require(definitionPath);
    //definition.id = this.config.definition;
    
    this.vehicle.setDefinition(definition);
    this.vehicle.connect(this.config.interface);

    this.vehicle.on("data", (data: any) => {
      this.wsServer.clients.forEach((client) => {
        client.send(data);
      });
    });

    this.wsServer.on("connection", (ws) => {
      logger.info("ws", "New connection!");
      const keys = Array.from(this.vehicle.metrics.keys());
      const values = Array.from(this.vehicle.metrics.values());

      // Send array of metric IDs to the client.
      ws.send(JSON.stringify(keys));

      // Send each metric value to the client.
      values.forEach((metric) => {
        ws.send(metric.data);
      });
    });

    this.expressApp.get('/api/log', (req, res) => {
      res.send(logger.history);
    });

    this.expressApp.get('/api/vehicle/definition', (req, res) => {
      res.send(this.vehicle.definition);
    });

    this.expressApp.get('/api/vehicle/metrics', (req, res) => {
      let data = {};
      this.vehicle.metrics.forEach((metric) => {
        data[metric.definition.id] = metric.value;
      });
      res.send(data);
    });

    this.expressApp.get('/api/vehicle/metrics/:id/set/:value', (req, res) => {
      const metric = this.vehicle.metrics.get(req.params.id);
      if (metric) {
        try {
          const value = parseInt(req.params.value);
          metric.setValue(value);
          return res.sendStatus(200);
        } catch {}
      }
      res.sendStatus(400);
    });

    this.httpServer.listen(this.config.port, () => {
      logger.info("http", `Server listening on port ${this.config.port}`);
    });
  }
  /*
  public sendMetrics(metrics: Metric[], sockets: WebSocket[]) {
    metrics.forEach((metric) => {
      const data = JSON.stringify([metric.]);
      sockets.forEach((socket) => {
        
          socket.send();
        
      });
    });
  }
  */
}

export interface Config {
  port?: number;
  definition?: string;
  interface?: string;
}

export interface Paths {
  root: string;
  definitions: string;
}