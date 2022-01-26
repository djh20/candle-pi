import { EventEmitter } from "events";
import GPS from "gps";
import SerialPort, { parsers } from "serialport";
import logger from "./util/logger";

export default class GpsManager extends EventEmitter {
  public connected: boolean;
  public locked: boolean;

  private lastLat?: number;
  private lastLon?: number;

  private gps: GPS;
  private socket: SerialPort;
  
  constructor() {
    super();
    this.gps = new GPS();
    this.connected = false;
    this.locked = false;
  }

  public connect(port: string): Promise<boolean> {
    return new Promise((resolve) => {
      let socket = new SerialPort(port, {baudRate: 9600}, (err) => {
        if (!err) {
          logger.info('gps', "Connected!");
          this.connected = true;
          resolve(true);
        } else {
          logger.warn('gps', "Failed to connect!");
          this.connected = false;
          resolve(false);
        }
      });

      this.socket = socket;
    });
  }

  public listen() {
    let parser = this.socket.pipe(new parsers.Readline({ delimiter: '\r\n' }));

    parser.on("data", data => {
      try {
        this.gps.update(data);
      } catch (err) {
        logger.warn("gps", "Error while parsing data, ignoring...");
      };
    });

    setInterval(() => this.update(), 3000);
    this.update();
  }

  public update() {
    let lat = this.gps.state.lat;
    let lon = this.gps.state.lon;

    this.locked = lat != null && lon != null;

    this.emit("lock", this.locked);

    if (!this.locked) return;
    if (lat == this.lastLat && lon == this.lastLon) return;

    let distance = GPS.Distance(
      this.lastLat, 
      this.lastLon,
      lat,
      lon
    ) * 1000; // convert from km to m
    
    // Round to max of 2 decimal places
    distance = Math.round((distance + Number.EPSILON) * 100) / 100;

    logger.info("gps", `Moved ${distance}m`);

    // to try and correct for gps wandering and glitching.
    // this isn't a very good way of doing it, it should probably be changed.
    if (distance <= 0.3 || distance >= 1000) return;

    this.emit("move", lat, lon, distance);

    this.lastLat = lat;
    this.lastLon = lon;
  }
}

type GpsPosition = {
  lat: number;
  lon: number;
}