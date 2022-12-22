import * as path from "path";
import * as fs from "fs";
import * as readline from "readline";
import logger from "./util/logger";
import Metric from "./metric";
import Vehicle from "./vehicle";

const MAX_LOADED_KEYFRAMES = 150;
const WRITE_BUFFER_SIZE = 100;

export default class TripManager {
  public rFile?: RecordingFile;
  public recording: boolean;
  public playing: boolean;

  public playbackTimer?: NodeJS.Timer;
  public playbackSpeed: number;

  private lastUpdateTime: number;
  
  constructor() {
    this.recording = false;
    this.playing = false;
    this.playbackSpeed = 1;
  }

  public async startTrip(vehicle: Vehicle) {
    if (!vehicle.app.config.record || this.rFile) return;
    
    const timeMs = Date.now();
    await this.setFilePath(vehicle.app.paths.recordings, `${timeMs}.log`);

    const metricsArray = Array.from(vehicle.metrics.values());
    const metricsHeader = metricsArray.map(m => m.definition.id).join(",");

    this.rFile.write(`${timeMs}\n${metricsHeader}\n`);
    this.recording = true;
    this.playing = false;

    // Add an entry for every metric so they start on the correct state.
    vehicle.metrics.forEach(metric => {
      this.addEntry(metric);
    });
  }

  public async setFilePath(directoryPath: string, fileName: string) {
    const fullPath = path.resolve(directoryPath, fileName);
    logger.info("trip", `File set to ${fileName}`);
    
    // If a file is already loaded then close any streams and set the file
    // property to null.
    if (this.rFile) this.endTrip();

    await fs.promises.mkdir(directoryPath, {recursive: true});
    this.rFile = new RecordingFile(fullPath);
  }

  public addEntry(metric: Metric) {
    if (this.rFile && this.recording) {
      const timeOffset = Date.now() - this.rFile.startTime;
      this.rFile.write(`${timeOffset} ${metric.index} ${metric.state}\n`);
    }
  }

  public async startPlayback(vehicle: Vehicle, timePosition?: number) {
    if (!this.rFile) return;

    this.stopPlayback();
    this.playing = true;

    if (timePosition != null) {
      this.rFile.timePosition = timePosition;
    }

    await this.rFile.loadKeyframes(vehicle);
    await this.updatePlayback(vehicle);
  }

  private async updatePlayback(vehicle: Vehicle) {
    if (this.lastUpdateTime) {
      const deltaTime = Date.now() - this.lastUpdateTime;
      this.rFile.timePosition += deltaTime * this.playbackSpeed;
    }

    await this.rFile.processKeyframes(vehicle);
    this.lastUpdateTime = Date.now();

    // We use timeout instead of interval to eliminate the possibility of
    // updatePlayback being called before it has finished processing from
    // the previous loop. Instead, we only set the timeout again once this
    // function has finished processing. 
    
    // This will most likely cause more variation in the amount of time between
    // updates, but this isn't an issue because we use deltaTime for increasing
    // the time position.
    this.playbackTimer = setTimeout(() => {
      this.updatePlayback(vehicle);
    }, 50);
  }

  public stopPlayback() {
    if (this.playbackTimer) {
      clearTimeout(this.playbackTimer);
    }
    this.lastUpdateTime = null;
    this.playing = false;
  }

  public endTrip() {
    this.recording = false;
    this.stopPlayback();

    if (this.rFile) {
      this.rFile.close();
      this.rFile = null;
    }
  }
}

class RecordingFile {
  public path: string;

  public startTime: number;
  public timePosition: number;

  private wStream?: fs.WriteStream;
  private keyframes?: RecordingKeyframe[];

  /**
   * This buffer is used to decrease the rate of file writes for hopefully
   * a better SD card life.
   */
  private wBuffer: string;

  constructor(path: string) {
    this.path = path;
    this.startTime = Date.now();
    this.wBuffer = "";
    this.timePosition = 0;
  }

  /**
   * Reads the file and parses the content to get the next chunk of keyframes.
   */
  public async loadKeyframes(vehicle: Vehicle): Promise<void> {
    return new Promise((resolve) => {
      this.keyframes = [];

      const lineReader = readline.createInterface({
        input: fs.createReadStream(this.path),
      });
      
      let i = 0;
      let metricIds: string[] = [];
      let latestMetricData: number[][] = [];
  
      lineReader.on("line", (line) => {
        if (i == 0) {
          this.startTime = parseInt(line);
        } else if (i == 1) {
          metricIds = line.split(",");
        } else {
          if (this.keyframes.length >= MAX_LOADED_KEYFRAMES) return;

          const segments = line.split(" ");
          const timeOffset = parseInt(segments[0]);
          
          const metricIndex = parseInt(segments[1]);
          
          const data = segments[2].split(",").map(e => parseFloat(e));
          
          if (timeOffset >= this.timePosition) {
            this.keyframes.push({
              timeOffset: timeOffset,
              metricId: metricIds[metricIndex],
              data: data
            });
          } else {
            latestMetricData[metricIndex] = data;
          }
        }
        i++;
      });

      lineReader.on("close", () => {
        // If we didn't get any more keyframes then go back to the start (loop).
        if (this.keyframes.length == 0) {
          this.timePosition = 0;
        }
        for (let i = 0; i < latestMetricData.length; i++) {
          const id = metricIds[i];
          const data = latestMetricData[i];
          const metric = vehicle.metrics.get(id);
          if (metric) metric.setState(data, true);
        }
        resolve();
      });
    });
  }

  public async processKeyframes(vehicle: Vehicle) {
    for (let i = 0; i < this.keyframes.length; i++) {
      const keyframe = this.keyframes[i];
     
      if (this.timePosition >= keyframe.timeOffset) {
        const metric = vehicle.metrics.get(keyframe.metricId);
        if (metric) metric.setState(keyframe.data, true);

        // Remove the keyframe from the array and decrement i as everything to
        // the right has been shifted down by one index.
        this.keyframes.splice(i, 1);
        i--;
      }
    }
    
    // If we've ran out of loaded keyframes then load the next set.
    if (this.keyframes.length == 0) {
      await this.loadKeyframes(vehicle);
    }
  }

  public write(data: string) {
    this.wBuffer += data;
    
    // If buffer size exceeds 100 chars (100 bytes) then write buffer to file.
    if (this.wBuffer.length >= WRITE_BUFFER_SIZE) {
      this.writeBuffer();
    }
  }

  private writeBuffer() {
    if (!this.wStream) {
      this.wStream = fs.createWriteStream(this.path, {flags: "a"});
    }

    this.wStream.write(this.wBuffer);
    this.wBuffer = "";
  }

  public close() {
    if (this.wStream) {
      this.writeBuffer();
      this.wStream.close();
    }
  }
}

interface RecordingKeyframe {
  timeOffset: number;
  metricId: string;
  data: number[];
}