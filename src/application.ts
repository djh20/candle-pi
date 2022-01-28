import * as path from "path";
import express from 'express';
import { Server as HttpServer } from "http";
import { WebSocketServer, WebSocket } from "ws";

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
  
  private subscriptions: Subscription[];

  constructor(config: Config) {
    this.config = config;
    
    this.paths = {
      root: path.resolve(__dirname, "../"),
      definitions: path.resolve(__dirname, "../definitions"),
      recordings: path.resolve(__dirname, "../storage/recordings"),
      web: path.resolve(__dirname, "../web"),
    };

    this.subscriptions = [];
    this.expressApp = express();
    this.httpServer = new HttpServer(this.expressApp);
    this.wsServer = new WebSocketServer({server: this.httpServer, path: "/ws"})
    this.vehicle = new Vehicle(this);
  }

  /**
   * Loads the definition file for the vehicle and starts the web server.
   */
  public async start() {
    // Resolve path to definition file set in config.
    const definitionPath = 
      path.resolve(this.paths.definitions, this.config.definition + ".js");
    
    // Load the definition file using require and assign its id because that's
    // not included by default in the file itself.
    const definition: VehicleDefinition = require(definitionPath);
    //definition.id = this.config.definition;
    
    await this.vehicle.loadDefinition(definition);
    this.vehicle.connect(this.config.interface);

    this.vehicle.on("data", (data: any) => {
      this.subscriptions.forEach((sub) => {
        if (sub.topic == "metrics") {
          sub.socket.send(data);
        }
      });
    });

    this.wsServer.on("connection", (ws) => {
      logger.info("ws", "New connection!");
      const metricsKeys = Array.from(this.vehicle.metrics.keys());
      const metricsValues = Array.from(this.vehicle.metrics.values());

      ws.on("message", (data) => {
        const msg: WebSocketMessage = JSON.parse(data.toString());
        if (msg.event == "subscribe") {
          this.subscriptions.push({
            socket: ws,
            topic: msg.topic
          });

          if (msg.topic == "metrics") {
            // Send array of metric IDs to the client.
            ws.send(JSON.stringify(metricsKeys));

            metricsValues.forEach((metric) => {
              ws.send(metric.data);
            });
          }
        } else if (msg.event == "command") {
          this.runCommand(msg.command);
        }
      });

      ws.on("close", () => {
        // Filter the subscriptions array and only keep subs that belong to
        // other sockets.
        this.subscriptions = this.subscriptions.filter(s => s.socket != ws);
      });
    });
    
    // Serve files in the 'web' directory.
    this.expressApp.use(express.static(this.paths.web));

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

  private async runCommand(command: string) {
    try {
      const split = command.split(' ');
      const topic = split[0];
      const args = split.slice(1);
      if (topic == "trip") {
        if (args[0] == "name") {
          await this.vehicle.tripManager.setFilePath(this.paths.recordings, args[1] + '.log');

        } else if (args[0] == "end") {
          this.vehicle.tripManager.endTrip();

        } else if (args[0] == "playback") {
          if (args[1] == "start") {
            // Convert seconds to ms
            const time = parseInt(args[2]) * 1000;
            await this.vehicle.tripManager.startPlayback(this.vehicle, time);
          } else if (args[1] == "stop") {
            this.vehicle.tripManager.stopPlayback();

          } else if (args[1] == "log") {
            const timePosition = this.vehicle.tripManager.rFile.timePosition;
            logger.info('trip', `Playback is at ${timePosition}ms`);
          }
        }
      } else if (topic == "metric") {
        if (args[0] == "set") {
          const metric = this.vehicle.metrics.get(args[1]);
          const value = parseFloat(args[2]);
          if (metric) metric.setValue(value);
        }
      }
    } catch(err) {
      console.error(err);
    }
  }
}

type WebSocketMessage = {
  event: string;
  topic?: string;
  command?: string;
}

export interface Config {
  port?: number;
  definition?: string;
  interface?: string;
  record?: boolean;

  gps: {
    enabled: boolean;
    port: string;
  }
}

export interface Paths {
  root: string;
  definitions: string;
  recordings: string;
  web: string;
}

interface Subscription {
  socket: WebSocket;
  topic: string;
}